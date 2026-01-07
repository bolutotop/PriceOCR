'use server';

import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs/promises';
import os from 'os';
import sharp from 'sharp';
import { correctCigaretteName } from '@/lib/corrector';

export type ParsedItem = {
  originalName: string;
  name: string;
  price: number; // -1 代表 "//"
  confidence: string;
  isCorrected: boolean;
  cropDataUri?: string;
};

type OcrResult = {
  success: boolean;
  parsedData?: ParsedItem[];
  error?: string;
};

const ENGINE_DIR = path.join(process.cwd(), 'ocr-engine');
const ENGINE_EXE = path.join(ENGINE_DIR, 'run.sh');

type TempMatch = {
  data: ParsedItem;
  bounds: { left: number; top: number };
};

export async function scanImageLocal(formData: FormData): Promise<OcrResult> {
  const file = formData.get('file') as File;
  if (!file) return { success: false, error: '无文件' };

  const tempId = Date.now().toString();
  const tempDir = os.tmpdir();
  const rawPath = path.join(tempDir, `raw_${tempId}.png`);
  const processedPath = path.join(tempDir, `proc_${tempId}.png`);

  try {
    const fileBuffer = Buffer.from(await file.arrayBuffer());
    await fs.writeFile(rawPath, fileBuffer);

    // 图像处理
    await sharp(rawPath)
      .resize(3500, null, { fit: 'inside', withoutEnlargement: false }) 
      .grayscale()
      .sharpen({ sigma: 1.5, m1: 0, m2: 20 })
      .toFile(processedPath);

    const metadata = await sharp(processedPath).metadata();
    const procWidth = metadata.width || 1000;
    const procHeight = metadata.height || 1000;

    console.log('[OCR] 图像处理完毕，开始识别...');

    const jsonResult = await runPaddleOcrCpp(processedPath);
    if (jsonResult.code !== 100) throw new Error(`引擎返回码 ${jsonResult.code}`);

    const rawItems = jsonResult.data;
    const tempMatches: TempMatch[] = [];

    // Box 工具
    type Box = { 
      text: string; 
      left: number; right: number; top: number; bottom: number; 
      centerY: number; 
      id: number;
    };

    const getBounds = (item: any, idx: number): Box => {
      const box = item.box;
      const left = Math.round(Math.min(box[0][0], box[3][0]));
      const right = Math.round(Math.max(box[1][0], box[2][0]));
      const top = Math.round(Math.min(box[0][1], box[1][1]));
      const bottom = Math.round(Math.max(box[2][1], box[3][1]));
      return {
        // 预处理文本
        text: item.text.replace(/[¥,。:：_]/g, '').replace(/[\│\|]/g, '/').trim(),
        left, right, top, bottom,
        centerY: (top + bottom) / 2,
        id: idx
      };
    };

    // 宽松的烟名判断
    const isChineseName = (str: string) => {
      const chineseCount = (str.match(/[\u4e00-\u9fa5]/g) || []).length;
      if (chineseCount >= 2) return true;
      if (chineseCount >= 1 && str.length >= 3) return true;
      return false;
    };

    const isPrice = (str: string) => {
      if (/^\d+(\.\d+)?$/.test(str)) return true;
      const clean = str.replace(/\s+/g, '');
      return clean.includes('//') || clean === '/';
    };

    const parsePrice = (str: string): number => {
      const clean = str.replace(/\s+/g, '');
      if (clean.includes('//') || clean === '/') return -1;
      return parseFloat(str);
    };

    // 2. 数据分类
    const potentialNames: Box[] = [];
    const potentialPrices: Box[] = [];
    const usedIndices = new Set<number>(); 

    for (let i = 0; i < rawItems.length; i++) {
      const item = rawItems[i];
      const box = getBounds(item, i);

      // 【核心修复】 单行拆分逻辑大改
      // 旧逻辑：/([^\d\/]+.*?)\s*(\d+...)/ -> \s* 允许无空格，导致 1916 被切
      // 新逻辑：必须有空格 \s+ 才能拆分！除非是 //
      // 解释：
      // ^(.+?)     -> 名字部分 (非贪婪，尽量短)
      // \s+        -> 必须有至少一个空格！(这是防止切断 "新中支1916" 的关键)
      // (...)      -> 价格部分 (数字 OR //)
      // $          -> 结束
      const splitRegex = /^(.+?)\s+(\d+(\.\d+)?|\/\/|\/+\s*\/+)$/;
      
      const mixMatch = box.text.match(splitRegex);
      
      if (mixMatch) {
         const possibleName = mixMatch[1].trim();
         const possiblePriceStr = mixMatch[2];
         
         // 拆分成功，校验名字
         if (isChineseName(possibleName)) {
            await addMatch(
              possibleName, 
              parsePrice(possiblePriceStr), 
              box, 
              processedPath, 
              tempMatches, 
              procWidth, 
              procHeight
            );
            usedIndices.add(i);
            continue;
         }
      }

      // 如果没被拆分（比如 "新中支1916" 没空格），它就会流到这里
      if (isPrice(box.text)) {
        potentialPrices.push(box);
      } else if (isChineseName(box.text)) {
        // "新中支1916" 含有3个汉字，符合条件，进入名字候选池
        potentialNames.push(box);
      }
    }

    // 3. 几何匹配 (保持 V5.2 逻辑)
    for (const name of potentialNames) {
      if (usedIndices.has(name.id)) continue;
      let bestPrice: Box | null = null;
      let minDistance = 999999; 

      for (const price of potentialPrices) {
        if (usedIndices.has(price.id)) continue;
        if (price.left <= name.left) continue; 
        if (Math.abs(price.centerY - name.centerY) > 20) continue;

        const distance = price.left - name.right;
        if (distance < -20 || distance > 280) continue;

        if (distance < minDistance) {
          minDistance = distance;
          bestPrice = price;
        }
      }

      if (bestPrice) {
        usedIndices.add(bestPrice.id);
        const unionBounds = {
          left: name.left,
          right: bestPrice.right,
          top: Math.min(name.top, bestPrice.top),
          bottom: Math.max(name.bottom, bestPrice.bottom),
        };

        await addMatch(
          name.text, 
          parsePrice(bestPrice.text), 
          unionBounds, 
          processedPath, 
          tempMatches, 
          procWidth, 
          procHeight
        );
      }
    }

    // 4. 智能分栏排序
    tempMatches.sort((a, b) => a.bounds.left - b.bounds.left);
    const columns: TempMatch[][] = [];
    let currentColumn: TempMatch[] = [];
    let lastX = -999;
    const COLUMN_THRESHOLD = 200;

    for (const match of tempMatches) {
      if (currentColumn.length === 0) {
        currentColumn.push(match);
        lastX = match.bounds.left;
      } else {
        if (match.bounds.left - lastX > COLUMN_THRESHOLD) {
          columns.push(currentColumn);
          currentColumn = [match];
          lastX = match.bounds.left; 
        } else {
          currentColumn.push(match);
        }
      }
    }
    if (currentColumn.length > 0) columns.push(currentColumn);

    const sortedParsedData: ParsedItem[] = [];
    for (const col of columns) {
      col.sort((a, b) => a.bounds.top - b.bounds.top);
      col.forEach(m => sortedParsedData.push(m.data));
    }

    await fs.unlink(rawPath).catch(()=>{});
    await fs.unlink(processedPath).catch(()=>{});

    console.log(`[OCR] 处理完成 (V5.3): ${sortedParsedData.length} 条数据`);
    return { success: true, parsedData: sortedParsedData };

  } catch (error: any) {
    console.error('[OCR Error]', error);
    await fs.unlink(rawPath).catch(()=>{});
    await fs.unlink(processedPath).catch(()=>{});
    return { success: false, error: error.message };
  }
}

async function addMatch(
  rawName: string, 
  price: number, 
  bounds: any, 
  imagePath: string, 
  list: TempMatch[], 
  imgWidth: number,
  imgHeight: number
) {
  if (price !== -1 && (price > 5000 || price < 5)) return; 
  if (rawName.length < 2) return;

  const correction = correctCigaretteName(rawName);
  
  let cropLeft = Math.floor(bounds.left);
  let cropTop = Math.floor(bounds.top);
  let cropRight = Math.ceil(bounds.right);
  let cropBottom = Math.ceil(bounds.bottom);

  cropLeft = Math.max(0, cropLeft);
  cropTop = Math.max(0, cropTop);
  cropRight = Math.min(imgWidth, cropRight);
  cropBottom = Math.min(imgHeight, cropBottom);

  const finalWidth = cropRight - cropLeft;
  const finalHeight = cropBottom - cropTop;

  let cropDataUri = undefined;
  if (finalWidth > 0 && finalHeight > 0) {
    try {
      const cropBuffer = await sharp(imagePath)
        .extract({ left: cropLeft, top: cropTop, width: finalWidth, height: finalHeight })
        .toBuffer();
      cropDataUri = `data:image/png;base64,${cropBuffer.toString('base64')}`;
    } catch (e) {}
  }

  list.push({
    data: {
      originalName: rawName,
      name: correction.corrected,
      price: price,
      confidence: correction.confidence,
      isCorrected: correction.isModified,
      cropDataUri: cropDataUri 
    },
    bounds: { left: bounds.left, top: bounds.top }
  });
}

function runPaddleOcrCpp(imagePath: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const child = spawn(ENGINE_EXE, { cwd: ENGINE_DIR, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdoutBuffer = '';
    let isResolved = false;
    child.stdout.on('data', (chunk) => {
      stdoutBuffer += chunk.toString();
      const lines = stdoutBuffer.split('\n');
      stdoutBuffer = lines.pop() || ''; 
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('{') && trimmed.includes('"code":')) {
          try {
            const result = JSON.parse(trimmed);
            if (!isResolved) { isResolved = true; resolve(result); child.kill(); }
          } catch (e) {}
        }
      }
    });
    child.on('error', (err) => { if (!isResolved) reject(err); });
    child.stdin.write(JSON.stringify({ image_path: imagePath }) + '\n');
    setTimeout(() => { if (!isResolved) { isResolved = true; child.kill(); reject(new Error('OCR Timeout')); } }, 60000);
  });
}
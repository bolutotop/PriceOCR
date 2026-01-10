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
  price: number;
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

// 临时对象结构，用于后续并发生成截图
type PendingItem = {
  rawName: string;
  price: number;
  bounds: { left: number; top: number; right: number; bottom: number };
  tempMatchObj: { data: ParsedItem; bounds: { left: number; top: number } };
};

export async function scanImageLocal(formData: FormData): Promise<OcrResult> {
  const file = formData.get('file') as File;
  if (!file) return { success: false, error: '无文件' };

  const tempId = Date.now().toString();
  const tempDir = os.tmpdir();
  // 优化点 1: 不再定义 rawPath，直接内存处理原始流
  const processedPath = path.join(tempDir, `proc_${tempId}.png`);

  try {
    const fileBuffer = Buffer.from(await file.arrayBuffer());

    // 优化点 1: 直接读取 Buffer，减少一次磁盘写入和读取
    await sharp(fileBuffer)
      .resize(3500, null, { fit: 'inside', withoutEnlargement: false })
      .grayscale()
      .sharpen({ sigma: 1.5, m1: 0, m2: 20 })
      .toFile(processedPath); // OCR 引擎必须读文件，所以这一步无法省去

    // 获取处理后的元数据（用于后续边界检查）
    const metadata = await sharp(processedPath).metadata();
    const procWidth = metadata.width || 1000;
    const procHeight = metadata.height || 1000;

    // 调用 C++ 引擎
    const jsonResult = await runPaddleOcrCpp(processedPath);
    if (jsonResult.code !== 100) throw new Error(`引擎返回码 ${jsonResult.code}`);

    const rawItems = jsonResult.data;
    
    // --- 数据准备阶段 ---
    // 这里的逻辑保持 V5.3 的几何算法不变，但是我们将结果存入 pending 队列，而不是直接 await addMatch
    const pendingItems: PendingItem[] = [];
    
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
        text: item.text.replace(/[¥,。:：_]/g, '').replace(/[\│\|]/g, '/').trim(),
        left, right, top, bottom,
        centerY: (top + bottom) / 2,
        id: idx
      };
    };

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

    const potentialNames: Box[] = [];
    const potentialPrices: Box[] = [];
    const usedIndices = new Set<number>(); 

    // 第一轮：分类与拆分
    for (let i = 0; i < rawItems.length; i++) {
      const item = rawItems[i];
      const box = getBounds(item, i);

      // 单行拆分逻辑
      const splitRegex = /^(.+?)\s+(\d+(\.\d+)?|\/\/|\/+\s*\/+)$/;
      const mixMatch = box.text.match(splitRegex);
      
      if (mixMatch) {
         const possibleName = mixMatch[1].trim();
         const possiblePriceStr = mixMatch[2];
         if (isChineseName(possibleName)) {
            // 存入待处理队列
            prepareMatch(possibleName, parsePrice(possiblePriceStr), box, pendingItems);
            usedIndices.add(i);
            continue;
         }
      }

      if (isPrice(box.text)) {
        potentialPrices.push(box);
      } else if (isChineseName(box.text)) {
        potentialNames.push(box);
      }
    }

    // 第二轮：几何匹配
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
        prepareMatch(name.text, parsePrice(bestPrice.text), unionBounds, pendingItems);
      }
    }

    // 优化点 2: 并发处理所有截图 (Promise.all)
    // 这将把串行 IO 变成并行，极大提升速度
    const finalMatches = await Promise.all(
      pendingItems.map(async (item) => {
        item.tempMatchObj.data.cropDataUri = await generateCrop(
          processedPath, 
          item.bounds, 
          procWidth, 
          procHeight
        );
        return item.tempMatchObj;
      })
    );

    // 智能分栏排序 (逻辑不变)
    finalMatches.sort((a, b) => a.bounds.left - b.bounds.left);
    const columns: typeof finalMatches[] = [];
    let currentColumn: typeof finalMatches = [];
    let lastX = -999;
    const COLUMN_THRESHOLD = 200;

    for (const match of finalMatches) {
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

    // 清理临时文件
    await fs.unlink(processedPath).catch(()=>{});
    
    return { success: true, parsedData: sortedParsedData };

  } catch (error: any) {
    console.error('[OCR Error]', error);
    // 确保清理
    await fs.unlink(processedPath).catch(()=>{});
    return { success: false, error: error.message };
  }
}

// 辅助函数：准备数据，但不执行 IO
function prepareMatch(rawName: string, price: number, bounds: any, list: PendingItem[]) {
  if (price !== -1 && (price > 5000 || price < 5)) return; 
  if (rawName.length < 2) return;
  const correction = correctCigaretteName(rawName);

  list.push({
    rawName,
    price,
    bounds: {
      left: Math.floor(bounds.left),
      top: Math.floor(bounds.top),
      right: Math.ceil(bounds.right),
      bottom: Math.ceil(bounds.bottom)
    },
    tempMatchObj: {
      data: {
        originalName: rawName,
        name: correction.corrected,
        price: price,
        confidence: correction.confidence,
        isCorrected: correction.isModified,
        cropDataUri: undefined // 稍后填充
      },
      bounds: { left: bounds.left, top: bounds.top }
    }
  });
}

// 优化点 3: 独立的高效截图函数 (转为 JPEG)
async function generateCrop(imagePath: string, bounds: any, imgWidth: number, imgHeight: number): Promise<string | undefined> {
  let cropLeft = Math.max(0, bounds.left);
  let cropTop = Math.max(0, bounds.top);
  let cropRight = Math.min(imgWidth, bounds.right);
  let cropBottom = Math.min(imgHeight, bounds.bottom);
  
  const finalWidth = cropRight - cropLeft;
  const finalHeight = cropBottom - cropTop;

  if (finalWidth <= 0 || finalHeight <= 0) return undefined;

  try {
    const cropBuffer = await sharp(imagePath)
      .extract({ left: cropLeft, top: cropTop, width: finalWidth, height: finalHeight })
      .jpeg({ quality: 80 }) // 重点：改用 JPEG 压缩，体积减少 60%
      .toBuffer();
    return `data:image/jpeg;base64,${cropBuffer.toString('base64')}`;
  } catch (e) {
    return undefined;
  }
}

// 保持不变
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
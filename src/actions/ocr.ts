'use server';

import path from 'path';
import fs from 'fs/promises';
import os from 'os';
import sharp from 'sharp';

import { runAliyunOcr } from './ocr-engine-aliyun';
import { runTencentOcr } from './ocr-engine-tencent';

export type ParsedItem = {
  originalName: string;
  name: string;
  price: number;
  confidence: string;
  isCorrected: boolean;
  cropDataUri?: string;
  _left?: number;
  _top?: number;
};

type OcrResult = {
  success: boolean;
  parsedData?: ParsedItem[];
  error?: string;
};

type MatchedPair = {
  rawName: string;
  price: number;
  unionBounds: { left: number; top: number; right: number; bottom: number };
};

export async function scanImageLocal(formData: FormData): Promise<OcrResult> {
  const file = formData.get('file') as File | null;
  const imageUrl = formData.get('imageUrl') as string | null;
  const engine = (formData.get('engine') as string) || 'tencent';

  if (!file && !imageUrl) return { success: false, error: '未接收到图片或链接' };

  const tempId = Date.now().toString();
  const tempDir = os.tmpdir();
  const originalPath = path.join(tempDir, `orig_${tempId}.jpg`); 

  try {
    let fileBuffer: Buffer;
    if (imageUrl) {
      const fetchRes = await fetch(imageUrl);
      if (!fetchRes.ok) throw new Error('无法下载指定的网络图片');
      fileBuffer = Buffer.from(await fetchRes.arrayBuffer());
    } else if (file) {
      fileBuffer = Buffer.from(await file.arrayBuffer());
    } else {
      throw new Error('无效的输入');
    }

    // 绝对原图机制：不做任何修改
    await fs.writeFile(originalPath, fileBuffer);

    const metadata = await sharp(fileBuffer).metadata();
    const origWidth = metadata.width || 1000;
    const origHeight = metadata.height || 1000;

    const sourcePayload = {
      type: imageUrl ? 'url' as const : 'file' as const,
      payload: imageUrl || originalPath
    };

    let subImage;

    if (engine === 'tencent') {
       console.log("-> [OCR] 正在调度腾讯云 OCR 引擎 (水平顺序识别模式)...");
       subImage = await runTencentOcr(sourcePayload);
    } else {
       console.log("-> [OCR] 正在调度阿里云 OCR 引擎 (水平顺序识别模式)...");
       subImage = await runAliyunOcr(sourcePayload);
    }

    const matchedPairs: MatchedPair[] = [];

    // 属性判断：是否为纯数字或断货标记 //
    const isPrice = (str: string) => {
      const clean = str.replace(/[¥,元\s]/g, '');
      return /^\s*(\d+(\.\d+)?|\/\/|\/+\s*\/+)\s*$/.test(clean);
    };

    const parsePrice = (str: string): number => {
      const clean = str.replace(/[¥,元\s]/g, '');
      if (clean.includes('//') || clean === '/') return -1;
      return parseFloat(clean) || -1; 
    };

    if (subImage.blockInfo && subImage.blockInfo.blockDetails) {
      const blocks = subImage.blockInfo.blockDetails;
      
      // 1. 提取标准化物理块
      let extractedBlocks = blocks.map((b: any, index: number) => {
        const pts = b.blockPoints || [];
        const xs = pts.map((p: any) => p.x !== undefined ? p.x : (p.X || 0));
        const ys = pts.map((p: any) => p.y !== undefined ? p.y : (p.Y || 0));
        
        const xMin = Math.round(Math.min(...xs));
        const xMax = Math.round(Math.max(...xs));
        const yMin = Math.round(Math.min(...ys));
        const yMax = Math.round(Math.max(...ys));
        
        const xCenter = (xMin + xMax) / 2;
        const yCenter = (yMin + yMax) / 2;
        const height = yMax - yMin;
        
        const text = (b.blockContent || "").replace(/[¥,。:：_]/g, '').replace(/[\│\|]/g, '/').trim();

        return { id: index, text, xMin, xMax, yMin, yMax, xCenter, yCenter, height, used: false };
      }).filter((b: any) => b.text !== "");

      const H_avg = extractedBlocks.reduce((sum: number, b: any) => sum + b.height, 0) / (extractedBlocks.length || 1);
      const DELTA_Y = H_avg * 0.6; // 同行高度容差

      // =====================================================================
      // 2. 严格的二维降维排序 (修复上一版的 TimSort 崩溃 Bug)
      // =====================================================================
      // 第一步：全局按 Y 轴严格排序
      extractedBlocks.sort((a: any, b: any) => a.yCenter - b.yCenter);

      const rows: typeof extractedBlocks[] = [];
      let currentRow: typeof extractedBlocks = [];

      for (const block of extractedBlocks) {
        if (currentRow.length === 0) {
          currentRow.push(block);
        } else {
          const lastBlock = currentRow[currentRow.length - 1];
          if (block.yCenter - lastBlock.yCenter <= DELTA_Y) {
            currentRow.push(block);
          } else {
            rows.push(currentRow);
            currentRow = [block];
          }
        }
      }
      if (currentRow.length > 0) rows.push(currentRow);

      // 第二步：每一行内部严格按 X 轴排序，然后摊平成一维数组
      // 这保证了从左到右、从上到下的顺序绝对正确，绝不会错乱！
      extractedBlocks = rows.map(row => row.sort((a: any, b: any) => a.xMin - b.xMin)).flat();

      // =====================================================================
      // 2.5 修复水平断裂：将太近的同类文本合并 (如 "黄鹤楼" 和 "软包")
      // =====================================================================
      for (let i = 0; i < extractedBlocks.length - 1; i++) {
        const curr = extractedBlocks[i];
        if (curr.used || isPrice(curr.text)) continue;

        const next = extractedBlocks[i + 1];
        if (next.used || isPrice(next.text)) continue; // 如果下一个是价格，留给后续去配对

        // 如果紧挨着的两个都是文本，且在同一行，间距很小，直接拼起来
        if (Math.abs(curr.yCenter - next.yCenter) <= DELTA_Y) {
          const gapX = next.xMin - curr.xMax;
          if (gapX > -H_avg && gapX < H_avg * 2.5) { 
            curr.text += " " + next.text;
            curr.xMax = Math.max(curr.xMax, next.xMax);
            curr.yMin = Math.min(curr.yMin, next.yMin);
            curr.yMax = Math.max(curr.yMax, next.yMax);
            curr.yCenter = (curr.yMin + curr.yMax) / 2;
            next.used = true;
            i--; // 继续检查是否有第三块相连
          }
        }
      }
      extractedBlocks = extractedBlocks.filter((b: any) => !b.used);

      // =====================================================================
      // 3. 水平顺序配对 (Sequential Next-Neighbor Pairing)
      // =====================================================================
      const MAX_X_DISTANCE = origWidth * 0.35; // 最大寻找距离

      for (let i = 0; i < extractedBlocks.length; i++) {
        const curr = extractedBlocks[i];
        if (curr.used) continue;

        // OCR 自带的品名价格连体情况
        let mixMatch = curr.text.match(/^(.+?)\s+(\d+(\.\d+)?|\/\/|\/+\s*\/+)$/);
        if (!mixMatch) mixMatch = curr.text.match(/^(.+?[\u4e00-\u9fa5A-Za-z])(\d+(\.\d+)?|\/\/|\/+\s*\/+)$/);

        if (mixMatch) {
          matchedPairs.push({
            rawName: mixMatch[1].trim(),
            price: parsePrice(mixMatch[2]),
            unionBounds: { left: curr.xMin, right: curr.xMax, top: curr.yMin, bottom: curr.yMax } 
          });
          curr.used = true;
          continue;
        }

        if (!isPrice(curr.text)) {
          // 当前是名字，只需往后看 1 到 2 个兄弟节点
          let foundPrice = false;
          
          for (let step = 1; step <= 2; step++) {
            const nextIdx = i + step;
            if (nextIdx >= extractedBlocks.length) break;
            const next = extractedBlocks[nextIdx];
            if (next.used) continue;

            // 只要高度跨行了，立刻停止（名字不能去找下一行的价格）
            if (Math.abs(next.yCenter - curr.yCenter) > DELTA_Y) break;

            if (isPrice(next.text)) {
              const distanceX = next.xMin - curr.xMax;
              // 价格必须在名字右侧，且不能跨越半张图
              if (distanceX < MAX_X_DISTANCE && curr.xMin < next.xCenter) {
                matchedPairs.push({
                  rawName: curr.text,
                  price: parsePrice(next.text),
                  unionBounds: {
                    left: Math.min(curr.xMin, next.xMin),
                    top: Math.min(curr.yMin, next.yMin),
                    right: Math.max(curr.xMax, next.xMax),
                    bottom: Math.max(curr.yMax, next.yMax)
                  }
                });
                curr.used = true;
                next.used = true;
                foundPrice = true;
                break;
              }
            } else {
              // 遇到另一个名字，说明当前名字没有价格（空缺），立刻打断去认领下个名字
              break;
            }
          }

          if (!foundPrice) {
            matchedPairs.push({
              rawName: curr.text,
              price: -1, 
              unionBounds: { left: curr.xMin, right: curr.xMax, top: curr.yMin, bottom: curr.yMax }
            });
            curr.used = true;
          }
        } else {
          // 孤立的价格
          matchedPairs.push({
            rawName: "【孤立数字】",
            price: parsePrice(curr.text),
            unionBounds: { left: curr.xMin, right: curr.xMax, top: curr.yMin, bottom: curr.yMax }
          });
          curr.used = true;
        }
      }
    }

    // =====================================================================
    // 4. 切图与最终展示排版
    // =====================================================================
    const finalItems = await Promise.all(
      matchedPairs.map(async (pair) => {
        const cropDataUri = await generateCrop(originalPath, pair.unionBounds, origWidth, origHeight);
        return {
          originalName: pair.rawName,
          name: pair.rawName, 
          price: pair.price,
          confidence: '1.0', 
          isCorrected: false, 
          cropDataUri: cropDataUri,
          _left: pair.unionBounds.left,
          _top: pair.unionBounds.top
        };
      })
    );

    let validItems = finalItems;

    // 前端展示时的防错位全局列聚类
    validItems.sort((a, b) => (a._left || 0) - (b._left || 0));
    const columns: typeof validItems[] = [];
    const COL_TOLERANCE = origWidth * 0.08; 

    for (const item of validItems) {
      let placed = false;
      for (const col of columns) {
        const colAnchorX = col[0]._left || 0;
        if (Math.abs((item._left || 0) - colAnchorX) < COL_TOLERANCE) {
          col.push(item);
          placed = true;
          break;
        }
      }
      if (!placed) columns.push([item]);
    }

    columns.sort((a, b) => (a[0]._left || 0) - (b[0]._left || 0));
    
    const sortedData: ParsedItem[] = [];
    for (const col of columns) {
      col.sort((a, b) => (a._top || 0) - (b._top || 0));
      col.forEach(item => {
        const { _left, _top, ...rest } = item; 
        sortedData.push(rest as ParsedItem);
      });
    }

    await fs.unlink(originalPath).catch(()=>{});
    return { success: true, parsedData: sortedData };

  } catch (error: any) {
    console.error('[OCR Error]', error);
    await fs.unlink(originalPath).catch(()=>{});
    return { success: false, error: error.message };
  }
}

async function generateCrop(imagePath: string, bounds: any, imgWidth: number, imgHeight: number): Promise<string | undefined> {
  const PADDING = Math.round(imgWidth * 0.005); 
  
  const cropLeft = Math.max(0, bounds.left - PADDING);
  const cropTop = Math.max(0, bounds.top - PADDING);
  const cropRight = Math.min(imgWidth, bounds.right + PADDING); 
  const cropBottom = Math.min(imgHeight, bounds.bottom + PADDING);
  
  const finalWidth = cropRight - cropLeft;
  const finalHeight = cropBottom - cropTop;

  if (finalWidth <= 0 || finalHeight <= 0 || isNaN(finalWidth) || isNaN(finalHeight)) {
     return undefined;
  }

  try {
    const cropBuffer = await sharp(imagePath)
      .extract({ left: cropLeft, top: cropTop, width: finalWidth, height: finalHeight })
      .jpeg({ quality: 85 }) 
      .toBuffer();
    return `data:image/jpeg;base64,${cropBuffer.toString('base64')}`;
  } catch (e: any) {
    console.log(`[OCR 切图异常]`, bounds, e.message);
    return undefined;
  }
}
'use server';

import path from 'path';
import fs from 'fs/promises';
import os from 'os';
import sharp from 'sharp';

// 引入分离出去的云厂商引擎
import { runAliyunOcr } from './ocr-engine-aliyun';
import { runTencentOcr } from './ocr-engine-tencent';

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

type MatchedPair = {
  rawName: string;
  price: number;
  unionBounds: { left: number; top: number; right: number; bottom: number };
  rawPoints?: any; 
};

export async function scanImageLocal(formData: FormData): Promise<OcrResult> {
  const file = formData.get('file') as File | null;
  const imageUrl = formData.get('imageUrl') as string | null;
  // 🚨 接收前端传来的引擎选择，默认为 aliyun
  const engine = (formData.get('engine') as string) || 'aliyun';

  if (!file && !imageUrl) return { success: false, error: '未接收到图片或链接' };

  const tempId = Date.now().toString();
  const tempDir = os.tmpdir();
  const processedPath = path.join(tempDir, `proc_${tempId}.jpg`); 

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

    // 图像预处理 (保留原本的逻辑)
    await sharp(fileBuffer)
      .rotate() 
      .resize(3500, null, { fit: 'inside', withoutEnlargement: false })
      .grayscale()
      .sharpen({ sigma: 1.5, m1: 0, m2: 20 })
      .jpeg({ quality: 80 }) 
      .toFile(processedPath);

    const metadata = await sharp(processedPath).metadata();
    const procWidth = metadata.width || 1000;
    const procHeight = metadata.height || 1000;

    const sourcePayload = {
      type: imageUrl ? 'url' as const : 'file' as const,
      payload: imageUrl || processedPath
    };

    let subImage;

    // 🚨 根据前端选择分发请求
    if (engine === 'tencent') {
       console.log("-> 正在调度腾讯云 OCR 引擎...");
       subImage = await runTencentOcr(sourcePayload);
    } else {
       console.log("-> 正在调度阿里云 OCR 引擎...");
       subImage = await runAliyunOcr(sourcePayload);
    }

    const matchedPairs: MatchedPair[] = [];

    const isChineseName = (str: string) => {
      const chineseCount = (str.match(/[\u4e00-\u9fa5]/g) || []).length;
      return chineseCount >= 2 || (chineseCount >= 1 && str.length >= 3);
    };
    const isPrice = (str: string) => {
      const clean = str.replace(/[¥,元\s]/g, '');
      if (/^\d+(\.\d+)?$/.test(clean)) return true;
      return clean.includes('//') || clean === '/';
    };
    const parsePrice = (str: string): number => {
      const clean = str.replace(/[¥,元\s]/g, '');
      if (clean.includes('//') || clean === '/') return -1;
      return parseFloat(clean) || 0;
    };
    
    const getBoundsFromPoints = (pts: any[]) => {
      if (!pts || pts.length === 0) return { left: 0, right: 0, top: 0, bottom: 0 };
      const getX = (p: any) => p.x !== undefined ? p.x : (p.X !== undefined ? p.X : 0);
      const getY = (p: any) => p.y !== undefined ? p.y : (p.Y !== undefined ? p.Y : 0);
      
      const xs = pts.map(getX);
      const ys = pts.map(getY);
      
      return {
        left: Math.round(Math.min(...xs)),
        right: Math.round(Math.max(...xs)),
        top: Math.round(Math.min(...ys)),
        bottom: Math.round(Math.max(...ys)),
      };
    };

    // --- 算法核心逻辑，完全保持原样 ---
    if (subImage.tableInfo && subImage.tableInfo.tableDetails && subImage.tableInfo.tableDetails.length > 0) {
      const cells = subImage.tableInfo.tableDetails[0].cellDetails || [];

      const rows: { [r: number]: any[] } = {};
      for (const cell of cells) {
        const r = cell.rowStart;
        if (!rows[r]) rows[r] = [];
        rows[r].push(cell);
      }

      for (const r of Object.keys(rows).map(Number).sort((a,b)=>a-b)) {
        const rowCells = rows[r].sort((a: any, b: any) => a.columnStart - b.columnStart);
        
        let currentNameCell: any = null;
        for (const cell of rowCells) {
          const text = (cell.cellContent || "").replace(/[¥,。:：_]/g, '').replace(/[\│\|]/g, '/').trim();
          if (!text) continue;

          if (isChineseName(text)) {
            currentNameCell = { 
              text, 
              bounds: getBoundsFromPoints(cell.cellPoints),
              rawPoints: cell.cellPoints
            };
          } 
          else if (isPrice(text) && currentNameCell) {
            const priceBounds = getBoundsFromPoints(cell.cellPoints);
            const unionBounds = {
              left: Math.min(currentNameCell.bounds.left, priceBounds.left),
              top: Math.min(currentNameCell.bounds.top, priceBounds.top),
              right: Math.max(currentNameCell.bounds.right, priceBounds.right),
              bottom: Math.max(currentNameCell.bounds.bottom, priceBounds.bottom),
            };

            matchedPairs.push({
              rawName: currentNameCell.text,
              price: parsePrice(text),
              unionBounds: unionBounds 
            });
            currentNameCell = null; 
          }
        }
      }
    } 
    else if (subImage.blockInfo && subImage.blockInfo.blockDetails) {
      const blocks = subImage.blockInfo.blockDetails;
      
      const potentialNames: any[] = [];
      const potentialPrices: any[] = [];
      
      blocks.forEach((b: any, i: number) => {
        const bounds = getBoundsFromPoints(b.blockPoints);
        const text = (b.blockContent || "").replace(/[¥,。:：_]/g, '').replace(/[\│\|]/g, '/').trim();
        const item = { id: i, text, ...bounds, centerY: (bounds.top + bounds.bottom) / 2 };

        const mixMatch = text.match(/^(.+?)\s+(\d+(\.\d+)?|\/\/|\/+\s*\/+)$/);
        if (mixMatch && isChineseName(mixMatch[1].trim())) {
          matchedPairs.push({ rawName: mixMatch[1].trim(), price: parsePrice(mixMatch[2]), unionBounds: bounds });
        } else if (isPrice(text)) {
          potentialPrices.push(item);
        } else if (isChineseName(text)) {
          potentialNames.push(item);
        }
      });

      for (const name of potentialNames) {
        let bestPrice: any = null;
        let minDistance = 9999; 
        for (const price of potentialPrices) {
          if (price.left <= name.left || Math.abs(price.centerY - name.centerY) > 25) continue;
          const distance = price.left - name.right;
          if (distance > -30 && distance < 350 && distance < minDistance) {
            minDistance = distance;
            bestPrice = price;
          }
        }
        if (bestPrice) {
          const unionBounds = {
            left: Math.min(name.left, bestPrice.left),
            top: Math.min(name.top, bestPrice.top),
            right: Math.max(name.right, bestPrice.right),
            bottom: Math.max(name.bottom, bestPrice.bottom),
          };

          matchedPairs.push({ rawName: name.text, price: parsePrice(bestPrice.text), unionBounds: unionBounds });
          bestPrice.left = -9999; 
        }
      }
    }

    const finalItems = await Promise.all(
      matchedPairs.map(async (pair) => {
        const cropDataUri = await generateCrop(processedPath, pair.unionBounds, procWidth, procHeight);
        
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

    const validItems = finalItems.filter(i => (i.price === -1 || (i.price >= 5 && i.price <= 5000)));

    validItems.sort((a, b) => a._left - b._left);
    const columns: typeof validItems[] = [];
    let currentColumn: typeof validItems = [];
    let lastX = -999;
    
    for (const item of validItems) {
      if (currentColumn.length === 0 || item._left - lastX <= 250) {
        currentColumn.push(item);
      } else {
        columns.push(currentColumn);
        currentColumn = [item];
      }
      lastX = item._left;
    }
    if (currentColumn.length > 0) columns.push(currentColumn);

    const sortedData: ParsedItem[] = [];
    for (const col of columns) {
      col.sort((a, b) => a._top - b._top);
      col.forEach(item => {
        const { _left, _top, ...rest } = item; 
        sortedData.push(rest);
      });
    }

    await fs.unlink(processedPath).catch(()=>{});
    return { success: true, parsedData: sortedData };

  } catch (error: any) {
    console.error('[OCR Error]', error);
    await fs.unlink(processedPath).catch(()=>{});
    return { success: false, error: error.message };
  }
}

async function generateCrop(imagePath: string, bounds: any, imgWidth: number, imgHeight: number): Promise<string | undefined> {
  let PADDING = 15; 
  let cropLeft = Math.max(0, bounds.left - PADDING);
  let cropTop = Math.max(0, bounds.top - PADDING);
  let cropRight = Math.min(imgWidth, bounds.right + PADDING); 
  let cropBottom = Math.min(imgHeight, bounds.bottom + PADDING);
  
  const finalWidth = cropRight - cropLeft;
  const finalHeight = cropBottom - cropTop;

  if (finalWidth <= 0 || finalHeight <= 0 || isNaN(finalWidth) || isNaN(finalHeight)) {
     return undefined;
  }

  try {
    const cropBuffer = await sharp(imagePath)
      .extract({ left: cropLeft, top: cropTop, width: finalWidth, height: finalHeight })
      .jpeg({ quality: 80 })
      .toBuffer();
    return `data:image/jpeg;base64,${cropBuffer.toString('base64')}`;
  } catch (e: any) {
    console.log(`[OCR 切图异常]`, bounds, e.message);
    return undefined;
  }
}
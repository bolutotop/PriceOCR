'use server';

import path from 'path';
import fs from 'fs/promises';
import os from 'os';
import sharp from 'sharp';

import { runTencentGeneralOcr } from './ocr-engine-tencent-general';

// 复用 ParsedItem 类型（与 ocr.ts 完全一致，保持前端兼容）
export type ParsedItem = {
  originalName: string;
  name: string;
  price: number;
  confidence: string;
  isCorrected: boolean;
  cropDataUri?: string;
  _left?: number;
  _top?: number;
  _bounds?: { left: number; top: number; right: number; bottom: number };
  _hasStockout?: boolean; // 已配到断货符，不需要补充价格
};

type OcrResult = {
  success: boolean;
  parsedData?: ParsedItem[];
  error?: string;
};

// ============================================================
// 核心：颜色过滤预处理
// 策略：先用黑红阈值建立 mask → 膨胀扩展保护区域 → mask 内保留原始像素，mask 外抹白
// 这样压缩导致的黑红文字边缘杂色不会被过滤掉，保留完整笔画
// ============================================================
async function filterColors(inputPath: string, outputPath: string): Promise<void> {
  const image = sharp(inputPath);
  const { width, height } = await image.metadata();
  if (!width || !height) throw new Error("无法读取图片尺寸");

  const { data, info } = await image
    .raw()
    .ensureAlpha()
    .toBuffer({ resolveWithObject: true });

  const pixels = Buffer.from(data);
  const w = info.width;
  const h = info.height;
  const totalPixels = w * h;

  // 第一步：建立黑红 mask（1=黑红像素，0=其他）
  const mask = new Uint8Array(totalPixels);
  for (let i = 0; i < totalPixels; i++) {
    const offset = i * 4;
    const r = pixels[offset], g = pixels[offset + 1], b = pixels[offset + 2];
    if (isBlackPixel(r, g, b) || isRedPixel(r, g, b)) {
      mask[i] = 1;
    }
  }

  // 第二步：膨胀 mask（向四周扩展 DILATE_R 个像素，保护文字边缘）
  const DILATE_R = 2;
  const dilated = new Uint8Array(totalPixels);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (mask[y * w + x] === 1) {
        // 将周围 DILATE_R 范围内的像素都标记为保护区域
        const yStart = Math.max(0, y - DILATE_R);
        const yEnd = Math.min(h - 1, y + DILATE_R);
        const xStart = Math.max(0, x - DILATE_R);
        const xEnd = Math.min(w - 1, x + DILATE_R);
        for (let dy = yStart; dy <= yEnd; dy++) {
          for (let dx = xStart; dx <= xEnd; dx++) {
            dilated[dy * w + dx] = 1;
          }
        }
      }
    }
  }

  // 第三步：mask 外的像素抹白，mask 内保留原始像素
  for (let i = 0; i < totalPixels; i++) {
    if (dilated[i] === 0) {
      const offset = i * 4;
      pixels[offset] = 255;
      pixels[offset + 1] = 255;
      pixels[offset + 2] = 255;
      pixels[offset + 3] = 255;
    }
  }

  await sharp(pixels, {
    raw: { width: w, height: h, channels: 4 }
  })
    .jpeg({ quality: 90 })
    .toFile(outputPath);
}

/**
 * 判断像素是否为"黑色系"
 * 考虑压缩导致的颜色偏移，阈值设为宽松
 * 黑色/深灰：R、G、B 都低于阈值
 */
function isBlackPixel(r: number, g: number, b: number): boolean {
  // 深灰 / 黑色：所有通道都较暗（放宽到 120，保留更多深灰色文字）
  if (r < 120 && g < 120 && b < 120) return true;
  // 中灰色：亮度较低且各通道差异不大（避免过滤掉灰色价格数字）
  const avg = (r + g + b) / 3;
  if (avg < 140 && Math.abs(r - g) < 30 && Math.abs(g - b) < 30 && Math.abs(r - b) < 30) return true;
  return false;
}

/**
 * 判断像素是否为"红色系"
 * 红色特征：R 通道明显高于 G 和 B
 * 考虑 JPEG 压缩后的偏移，用比率+绝对值双重判定
 */
function isRedPixel(r: number, g: number, b: number): boolean {
  // 红色要求（放宽）：
  // 1. R 通道足够高（> 100）
  // 2. R 显著大于 G 和 B（至少多 35）
  // 3. G 和 B 都不能太高（< 170），排除浅粉/白色
  if (r > 100 && r - g > 35 && r - b > 35 && g < 170 && b < 170) {
    return true;
  }
  // 补充：暗红色（压缩后可能变暗）
  if (r > 60 && r > g * 1.5 && r > b * 1.5 && g < 120 && b < 120) {
    return true;
  }
  // 补充：偏橙/棕红色（部分截图中价格数字是橙色系）
  if (r > 140 && r - b > 50 && g < r * 0.8 && b < r * 0.5) {
    return true;
  }
  return false;
}

// ============================================================
// 噪声过滤：过滤掉备注、注释、表头等非品名文本
// ============================================================
const NOISE_PATTERNS = [
  /刀割/,
  /扣\d+/,
  /请注意/,
  /高档烟/,
  /老货/,
  /按.*扣/,
  /徽商/,
  /公司/,
  /退回/,
  /处理/,
  /电话/,
  /日期/,
  /发票/,
  /行情/,
  /中烟/,
  /有货请/,
  /备注/,
  /合计/,
  /总计/,
  /!!!|！！/,
  /^\d{4}年/,
  /^\d{1,2}月\d{1,2}/,
  /^序号$/,
  /^品名$/,
  /^价格$/,
  /^名称$/,
  /收\d+%/,
  /发半/,
  /发货/,
  /每天/,
  /下午/,
  /上午/,
  /结算/,
  /冷订单/,
  /订单/,
  /超过/,
  /前的/,
  /系列/,
  /烟刀/,
  /批条/,
  /注意/,
  /中高档/,
  /200以/,
  /300以/,
  /500以/,
  /800以/,
  /中高/,
  /新版/,
];

function isNoiseText(text: string): boolean {
  const t = text.trim();
  if (t.length > 15) return true;  // 超过15字大概率是备注
  for (const pat of NOISE_PATTERNS) {
    if (pat.test(t)) return true;
  }
  return false;
}

/** 判断文本是否像品名（至少包含2个汉字） */
function isNameText(text: string): boolean {
  const hanzi = text.match(/[\u4e00-\u9fa5]/g);
  return !!hanzi && hanzi.length >= 2 && text.length >= 2;
}

// ============================================================
// 切图函数（在原图上切，不在颜色过滤后的图上切）
// ============================================================
async function generateCrop(
  imagePath: string,
  bounds: { left: number; top: number; right: number; bottom: number },
  imgWidth: number,
  imgHeight: number
): Promise<string | undefined> {
  // 字典已有精确的 name+price rect，只需小 padding
  const PAD_H = 3;
  const PAD_V = 2;

  const cropLeft = Math.max(0, bounds.left - PAD_H);
  const cropTop = Math.max(0, bounds.top - PAD_V);
  const cropRight = Math.min(imgWidth, bounds.right + PAD_H);
  const cropBottom = Math.min(imgHeight, bounds.bottom + PAD_V);

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
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    console.log(`[截图解析 切图异常]`, bounds, message);
    return undefined;
  }
}

// ============================================================
// 解析辅助函数
// ============================================================
type TextBlock = {
  text: string;
  xMin: number; xMax: number;
  yMin: number; yMax: number;
  yCenter: number; height: number; width: number;
};

type TencentTextDetection = {
  DetectedText?: string;
  Polygon?: Array<{ X?: number; Y?: number }>;
};

function parseTd(td: TencentTextDetection): TextBlock | null {
  const text = (td.DetectedText || '').trim();
  if (!text) return null;
  const polygon = td.Polygon || [];
  if (polygon.length < 4) return null;
  const xs = polygon.map((p) => p.X ?? 0);
  const ys = polygon.map((p) => p.Y ?? 0);
  const xMin = Math.min(...xs), xMax = Math.max(...xs);
  const yMin = Math.min(...ys), yMax = Math.max(...ys);
  return { text, xMin, xMax, yMin, yMax, yCenter: (yMin + yMax) / 2, height: yMax - yMin, width: xMax - xMin };
}

function isPriceText(text: string): boolean {
  const c = text.replace(/[,，\s]/g, '').replace(/[.!?。！？]+$/, '');
  if (/^\d+\.?\d*$/.test(c)) { const n = parseFloat(c); return n >= 10 && n <= 9999; }
  if (/^[\/\\|｜]{1,}$/.test(c)) return true;
  if (/^[\/\\|｜lI1]{1,3}$/.test(c) && c.length <= 2) return true;
  return false;
}

function parsePrice(text: string): number {
  const c = text.replace(/[,，\s]/g, '').replace(/[.!?。！？]+$/, '');
  if (/^[\/\\|｜]{1,}$/.test(c)) return -1;
  if (/^[\/\\|｜lI1]{1,3}$/.test(c) && c.length <= 2) return -1;
  const n = parseFloat(c);
  if (!isNaN(n) && /^\d+(\.\d+)?$/.test(c)) { if (n === 1 || n === 11) return -1; if (n >= 10 && n <= 9999) return n; }
  return -1;
}

type DictEntry = {
  name: { x: number; y: number; width: number; height: number };
  price: { x: number; y: number; width: number; height: number } | null;
  value: number;
};

// ============================================================
// 主入口：截图解析 Server Action
// 完整流程：颜色过滤 → 全图OCR定列边界 → 按列切片OCR → 配对品名价格 → 保存字典 → 输出
// ============================================================
export async function scanScreenshot(formData: FormData): Promise<OcrResult> {
  const file = formData.get('file') as File | null;
  const imageUrl = formData.get('imageUrl') as string | null;

  if (!file && !imageUrl) {
    return { success: false, error: '未提供图片文件或 URL' };
  }

  const tmpDir = os.tmpdir();
  const ts = Date.now();
  const originalPath = path.join(tmpDir, `screenshot_orig_${ts}.jpg`);
  const filteredPath = path.join(tmpDir, `screenshot_filtered_${ts}.jpg`);
  const projectRoot = path.resolve(process.cwd());

  try {
    if (file) {
      await fs.writeFile(originalPath, Buffer.from(await file.arrayBuffer()));
    } else if (imageUrl) {
      await fs.writeFile(originalPath, Buffer.from(await (await fetch(imageUrl)).arrayBuffer()));
    }

    // ========== 步骤 1：颜色过滤 ==========
    console.log('[截图解析] 步骤1: 颜色过滤...');
    await filterColors(originalPath, filteredPath);

    // 调试：保存过滤后全图
    const debugFilteredPath = path.join(projectRoot, `debug_filtered_full.jpg`);
    await fs.copyFile(filteredPath, debugFilteredPath);
    console.log(`[截图解析 调试] 过滤后全图已保存: ${debugFilteredPath}`);

    // ========== 步骤 2：全图 OCR 过滤图，确定列边界 ==========
    console.log('[截图解析] 步骤2: 全图 OCR 定列边界...');
    const filteredResp = await runTencentGeneralOcr({ type: 'file', payload: filteredPath });
    const nameBlocks: TextBlock[] = [];
    const fullOcrBlocks: TextBlock[] = [];
    for (const td of (filteredResp.TextDetections || [])) {
      const b = parseTd(td);
      if (!b) continue;
      fullOcrBlocks.push(b);
      if (isNameText(b.text) && !isNoiseText(b.text)) nameBlocks.push(b);
    }

    if (nameBlocks.length === 0) {
      return { success: false, error: 'OCR 未识别到任何品名' };
    }

    const { width: imgW, height: imgH } = await sharp(filteredPath).metadata();
    if (!imgW || !imgH) throw new Error('无法读取图片尺寸');

    // 按品名左边界 xMin 聚类成列。
    // 截图表格是固定的「品名列 + 右侧价格列」重复排版，使用 xCenter 会被品名长度拉偏，
    // 容易把中间 2~3 组粘成超宽切片；xMin 更稳定。
    const H_avg = nameBlocks.reduce((s, b) => s + b.height, 0) / nameBlocks.length;
    const X_CLUSTER_TOL = Math.max(55, H_avg * 5);
    const MIN_COL_ROWS = Math.min(5, Math.max(2, Math.floor(nameBlocks.length * 0.015)));
    const sortedByLeft = [...nameBlocks].sort((a, b) => a.xMin - b.xMin);
    const rawColGroups: TextBlock[][] = [];
    let currentGroup: TextBlock[] = [];

    for (const b of sortedByLeft) {
      if (currentGroup.length === 0) {
        currentGroup.push(b);
        continue;
      }
      const anchorX = currentGroup.reduce((s, item) => s + item.xMin, 0) / currentGroup.length;
      if (Math.abs(b.xMin - anchorX) <= X_CLUSTER_TOL) {
        currentGroup.push(b);
      } else {
        rawColGroups.push(currentGroup);
        currentGroup = [b];
      }
    }
    if (currentGroup.length > 0) rawColGroups.push(currentGroup);

    let colGroups = rawColGroups
      .filter(g => g.length >= MIN_COL_ROWS)
      .map(g => g.sort((a, b) => a.yCenter - b.yCenter));
    if (colGroups.length === 0) colGroups = [nameBlocks];

    const quantile = (values: number[], p: number): number => {
      const sorted = [...values].sort((a, b) => a - b);
      const idx = Math.max(0, Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p)));
      return sorted[idx];
    };
    const robustLeft = (group: TextBlock[]) => quantile(group.map(b => b.xMin), 0.12);
    colGroups.sort((a, b) => robustLeft(a) - robustLeft(b));

    // 计算列切片边界：每列只包含本组品名与其右侧价格，右边界不跨入下一组品名。
    const colBounds: { left: number; right: number }[] = [];
    const ROW_THRESH = H_avg * 1.2;
    const priceBlocks = fullOcrBlocks.filter(b => isPriceText(b.text));

    for (let i = 0; i < colGroups.length; i++) {
      const group = colGroups[i];
      const nameLeft = robustLeft(group);
      const nameRight = Math.max(...group.map(b => b.xMax));
      const nextNameLeft = i < colGroups.length - 1 ? robustLeft(colGroups[i + 1]) : imgW;
      let priceRight = nameRight;

      for (const nameBlock of group) {
        for (const priceBlock of priceBlocks) {
          if (Math.abs(priceBlock.yCenter - nameBlock.yCenter) > ROW_THRESH) continue;
          if (priceBlock.xMin < nameBlock.xMax - H_avg * 0.3) continue;
          if (priceBlock.xMin >= nextNameLeft - H_avg * 0.5) continue;
          if (priceBlock.xMin - nameBlock.xMax > Math.min(imgW * 0.18, nextNameLeft - nameBlock.xMax)) continue;
          priceRight = Math.max(priceRight, priceBlock.xMax);
        }
      }

      const left = Math.max(0, Math.floor(nameLeft - H_avg * 0.5));
      const rightLimit = i < colGroups.length - 1 ? nextNameLeft - H_avg * 0.5 : imgW;
      const expectedRight = Math.max(priceRight + H_avg * 1.2, nameRight + H_avg * 4);
      let right = Math.min(imgW, Math.ceil(Math.min(rightLimit, expectedRight)));
      if (right <= left + H_avg * 6) {
        right = Math.min(imgW, Math.ceil(Math.min(rightLimit, left + Math.max(H_avg * 10, 160))));
      }
      colBounds.push({ left, right });
    }

    // 调整相邻列的重叠：确保列之间不重叠
    for (let i = 0; i < colBounds.length - 1; i++) {
      if (colBounds[i].right > colBounds[i + 1].left) {
        const mid = Math.round((colBounds[i].right + colBounds[i + 1].left) / 2);
        colBounds[i].right = mid;
        colBounds[i + 1].left = mid;
      }
    }
    console.log(`[截图解析] xMin聚类阈值=${X_CLUSTER_TOL.toFixed(0)}px, 最小行数=${MIN_COL_ROWS}, 发现 ${colBounds.length} 列`);

    // 调试：在过滤图上画列分割线
    {
      const { data: rawPx, info: rawInfo } = await sharp(filteredPath)
        .ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      const px = Buffer.from(rawPx);
      const rw = rawInfo.width, rh = rawInfo.height;
      for (const cb of colBounds) {
        // 画左边界红线
        for (let y = 0; y < rh; y++) {
          if (cb.left > 0 && cb.left < rw) {
            const off = (y * rw + cb.left) * 4;
            px[off] = 255; px[off + 1] = 0; px[off + 2] = 0; px[off + 3] = 255;
          }
          // 画右边界蓝线
          if (cb.right > 0 && cb.right < rw) {
            const off = (y * rw + cb.right - 1) * 4;
            px[off] = 0; px[off + 1] = 0; px[off + 2] = 255; px[off + 3] = 255;
          }
        }
      }
      const debugColsPath = path.join(projectRoot, `debug_col_bounds.jpg`);
      await sharp(px, { raw: { width: rw, height: rh, channels: 4 } })
        .jpeg({ quality: 90 }).toFile(debugColsPath);
      console.log(`[截图解析 调试] 列边界标注图已保存: ${debugColsPath}`);
      console.log(`[截图解析 调试] 列边界: ${colBounds.map((c, i) => `列${i}=[${c.left},${c.right}]`).join(' ')}`);
    }

    // ========== 步骤 3：按列切片放大 OCR ==========
    console.log('[截图解析] 步骤3: 按列切片放大 OCR...');
    const SCALE = 3;
    type Entry = { name: string; value: number; nameBbox: { x: number; y: number; width: number; height: number }; priceBbox: { x: number; y: number; width: number; height: number } };
    const allEntries: Entry[] = [];

    for (let ci = 0; ci < colBounds.length; ci++) {
      const left = Math.max(0, colBounds[ci].left);
      const right = Math.min(imgW, colBounds[ci].right);
      const w = right - left;
      if (w <= 0) continue;

      const colBuf = await sharp(filteredPath)
        .extract({ left, top: 0, width: w, height: imgH })
        .resize(w * SCALE, imgH * SCALE, { kernel: 'lanczos3' })
        .jpeg({ quality: 95 })
        .toBuffer();

      // 调试：保存列切片中间图
      const debugSlicePath = path.join(projectRoot, `debug_col_slice_${ci}.jpg`);
      await fs.writeFile(debugSlicePath, colBuf);
      console.log(`[截图解析 调试] 列切片 ${ci} 已保存: ${debugSlicePath} (原图 x=${left}~${right}, 放大${SCALE}x)`);

      const resp = await runTencentGeneralOcr({ type: 'buffer', payload: colBuf.toString('base64') });
      const blocks: TextBlock[] = [];
      for (const td of (resp.TextDetections || [])) {
        const b = parseTd(td);
        if (!b) continue;
        // 坐标换算回原图
        blocks.push({ ...b, xMin: b.xMin / SCALE + left, xMax: b.xMax / SCALE + left, yMin: b.yMin / SCALE, yMax: b.yMax / SCALE, yCenter: b.yCenter / SCALE, height: b.height / SCALE, width: b.width / SCALE });
      }

      // 合并全图 OCR 中同列范围内的文本块（补充列切片可能漏识的）
      for (const fb of fullOcrBlocks) {
        if (fb.xMin < left || fb.xMin >= right) continue;
        const dup = blocks.some(b => Math.abs(b.yCenter - fb.yCenter) < 8 && Math.abs(b.xMin - fb.xMin) < 20);
        if (!dup) blocks.push(fb);
      }

      // 按 Y 聚类成行
      blocks.sort((a, b) => a.yCenter - b.yCenter);
      if (blocks.length === 0) continue;
      const medianH = quantile(blocks.map(b => b.height), 0.5);
      const DY = Math.max(6, medianH * 0.65);
      const rows: TextBlock[][] = [];
      let cr: TextBlock[] = [blocks[0]];
      for (let i = 1; i < blocks.length; i++) {
        const rayc = cr.reduce((s, b) => s + b.yCenter, 0) / cr.length;
        if (Math.abs(blocks[i].yCenter - rayc) <= DY) cr.push(blocks[i]);
        else { rows.push(cr); cr = [blocks[i]]; }
      }
      rows.push(cr);

      // 行内配对品名+价格：不能只按 x 顺序找下一个价格。
      // 若相邻两行被 OCR 合成同一 row，x 排序会变成「名1、名2、价1、价2」，导致名2 抢价1。
      // 因此每个品名改为在右侧价格中按 y 最近优先匹配。
      for (const row of rows) {
        row.sort((a, b) => a.yCenter - b.yCenter || a.xMin - b.xMin);
        const classified = row.map(b => ({ ...b, isPrice: isPriceText(b.text), isName: isNameText(b.text) && !isNoiseText(b.text) && b.text.length <= 15 && !/^\d+(\.\d+)?$/.test(b.text) }));
        const usedPrice = new Set<number>();
        const rowTol = Math.max(8, medianH * 0.95);
        for (let i = 0; i < classified.length; i++) {
          const curr = classified[i];
          if (!curr.isName) continue;
          let priceBlock: typeof classified[0] | null = null;
          let priceIdx = -1;
          let bestScore = Number.POSITIVE_INFINITY;
          for (let j = 0; j < classified.length; j++) {
            if (usedPrice.has(j)) continue;
            const cand = classified[j];
            if (!cand.isPrice) continue;
            if (cand.xMin < curr.xMax - medianH * 0.3) continue;
            const dy = Math.abs(cand.yCenter - curr.yCenter);
            if (dy > rowTol) continue;
            const dx = Math.max(0, cand.xMin - curr.xMax);
            const score = dy * 100 + dx;
            if (score < bestScore) {
              bestScore = score;
              priceBlock = cand;
              priceIdx = j;
            }
          }
          if (priceIdx >= 0) usedPrice.add(priceIdx);
          if (!priceBlock) continue;
          const price = parsePrice(priceBlock.text);
          allEntries.push({
            name: curr.text, value: price,
            nameBbox: { x: Math.round(curr.xMin), y: Math.round(curr.yMin), width: Math.round(curr.width), height: Math.round(curr.height) },
            priceBbox: { x: Math.round(priceBlock.xMin), y: Math.round(priceBlock.yMin), width: Math.round(priceBlock.width), height: Math.round(priceBlock.height) },
          });
        }
      }
      console.log(`  列${ci + 1}: ${resp.TextDetections?.length ?? 0} 块`);
    }

    console.log(`[截图解析] 配对 ${allEntries.length} 条`);

    // ========== 步骤 4：去重 + 列排序 ==========
    allEntries.sort((a, b) => a.nameBbox.y - b.nameBbox.y);
    const deduped: Entry[] = [];
    const seen = new Set<string>();
    for (const e of allEntries) {
      if (!seen.has(e.name)) { seen.add(e.name); deduped.push(e); }
    }

    // 列排序
    const COL_GAP = 100;
    deduped.sort((a, b) => a.nameBbox.x - b.nameBbox.x);
    const sortedCols: Entry[][] = [];
    let curCol: Entry[] = [deduped[0]];
    for (let i = 1; i < deduped.length; i++) {
      const avg = curCol.reduce((s, c) => s + c.nameBbox.x, 0) / curCol.length;
      if (Math.abs(deduped[i].nameBbox.x - avg) <= COL_GAP) curCol.push(deduped[i]);
      else { sortedCols.push(curCol); curCol = [deduped[i]]; }
    }
    if (curCol.length) sortedCols.push(curCol);
    const sorted: Entry[] = [];
    for (const col of sortedCols) { col.sort((a, b) => a.nameBbox.y - b.nameBbox.y); sorted.push(...col); }

    console.log(`[截图解析] 去重后 ${sorted.length} 条, ${sortedCols.length} 列`);

    // ========== 步骤 5：保存字典 ==========
    const dict: Record<string, DictEntry> = {};
    for (const e of sorted) {
      dict[e.name] = { name: e.nameBbox, price: e.priceBbox, value: e.value };
    }
    const dictPath = path.join(projectRoot, 'public', 'price_dict.json');
    await fs.writeFile(dictPath, JSON.stringify(dict, null, 2), 'utf-8');
    console.log(`[截图解析] 字典已保存: ${sorted.length} 条 → ${dictPath}`);

    // ========== 步骤 6：按字典顺序输出 + 切图 ==========
    const { width: origW, height: origH } = await sharp(originalPath).metadata();
    const results: ParsedItem[] = [];

    for (const e of sorted) {
      const nr = e.nameBbox;
      const pr = e.priceBbox;
      const bounds = {
        left: nr.x,
        top: Math.min(nr.y, pr.y),
        right: pr.x + pr.width,
        bottom: Math.max(nr.y + nr.height, pr.y + pr.height),
      };

      let cropDataUri: string | undefined;
      if (origW && origH) {
        cropDataUri = await generateCrop(originalPath, bounds, origW, origH);
      }

      results.push({
        originalName: e.name,
        name: e.name,
        price: e.value,
        confidence: '1.0',
        isCorrected: false,
        cropDataUri,
      });
    }

    console.log(`[截图解析] 输出 ${results.length} 条`);

    await fs.unlink(originalPath).catch(() => {});
    await fs.unlink(filteredPath).catch(() => {});

    return { success: true, parsedData: results };

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[截图解析 Error]', error);
    await fs.unlink(originalPath).catch(() => {});
    await fs.unlink(filteredPath).catch(() => {});
    return { success: false, error: message };
  }
}

// 对参考价格表图做 OCR，生成品名-价格字典 JSON
// 策略：先全图 OCR 确定列边界，再按列切片放大 OCR 提高识别率
// 使用方式：node src/scripts/build-dict.js <图片路径>
const fs = require('fs');
const path = require('path');

// 手动加载 .env.local
const envPath = path.resolve(__dirname, '../../.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx > 0) {
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim();
      if (!process.env[key]) process.env[key] = val;
    }
  }
}

const sharp = require('sharp');
const tencentcloud = require('tencentcloud-sdk-nodejs');
const OcrClient = tencentcloud.ocr.v20181119.Client;

// ============================================================
// 颜色过滤：只保留黑色和红色像素，其余变白
// ============================================================
function isBlackPixel(r, g, b) {
  if (r < 120 && g < 120 && b < 120) return true;
  const avg = (r + g + b) / 3;
  if (avg < 140 && Math.abs(r - g) < 30 && Math.abs(g - b) < 30 && Math.abs(r - b) < 30) return true;
  return false;
}

function isRedPixel(r, g, b) {
  if (r > 100 && r - g > 35 && r - b > 35 && g < 170 && b < 170) return true;
  if (r > 60 && r > g * 1.5 && r > b * 1.5 && g < 120 && b < 120) return true;
  if (r > 140 && r - b > 50 && g < r * 0.8 && b < r * 0.5) return true;
  return false;
}

async function filterColors(inputPath, outputPath) {
  const image = sharp(inputPath);
  const { data, info } = await image.raw().ensureAlpha().toBuffer({ resolveWithObject: true });
  const pixels = Buffer.from(data);
  const w = info.width, h = info.height;
  const totalPixels = w * h;

  // 第一步：建立黑红 mask
  const mask = new Uint8Array(totalPixels);
  for (let i = 0; i < totalPixels; i++) {
    const offset = i * 4;
    const r = pixels[offset], g = pixels[offset + 1], b = pixels[offset + 2];
    if (isBlackPixel(r, g, b) || isRedPixel(r, g, b)) mask[i] = 1;
  }

  // 第二步：膨胀 mask（保护文字边缘压缩杂色）
  const DILATE_R = 2;
  const dilated = new Uint8Array(totalPixels);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (mask[y * w + x] === 1) {
        const yS = Math.max(0, y - DILATE_R), yE = Math.min(h - 1, y + DILATE_R);
        const xS = Math.max(0, x - DILATE_R), xE = Math.min(w - 1, x + DILATE_R);
        for (let dy = yS; dy <= yE; dy++)
          for (let dx = xS; dx <= xE; dx++)
            dilated[dy * w + dx] = 1;
      }
    }
  }

  // 第三步：mask 外抹白，mask 内保留原始像素
  for (let i = 0; i < totalPixels; i++) {
    if (dilated[i] === 0) {
      const offset = i * 4;
      pixels[offset] = 255; pixels[offset + 1] = 255; pixels[offset + 2] = 255; pixels[offset + 3] = 255;
    }
  }

  await sharp(pixels, { raw: { width: w, height: h, channels: 4 } })
    .jpeg({ quality: 90 })
    .toFile(outputPath);
}

// ============================================================
// 解析辅助函数
// ============================================================
const isPrice = (t) => {
  const c = t.replace(/[,，\s]/g, '').replace(/[.!?。！？]+$/, '');
  if (/^\d+\.?\d*$/.test(c)) { const n = parseFloat(c); return n >= 10 && n <= 9999; }
  if (/^[\/\\|｜]{1,}$/.test(c)) return true;
  if (/^[\/\\|｜lI1]{1,3}$/.test(c) && c.length <= 2) return true;
  return false;
};
const isName = (t) => { const m = t.match(/[\u4e00-\u9fa5]/g); return m && m.length >= 2 && t.length >= 2; };
const parseP = (t) => {
  let c = t.replace(/[,，\s]/g, '').replace(/[.!?。！？]+$/, '');
  if (/^[\/\\|｜]{1,}$/.test(c)) return -1;
  if (/^[\/\\|｜lI1]{1,3}$/.test(c) && c.length <= 2) return -1;
  const n = parseFloat(c);
  if (!isNaN(n) && /^\d+(\.\d+)?$/.test(c)) { if (n === 1 || n === 11) return -1; if (n >= 10 && n <= 9999) return n; }
  return -1;
};
const parseTd = (td) => {
  const text = (td.DetectedText || '').trim();
  if (!text) return null;
  const polygon = td.Polygon || [];
  if (polygon.length < 4) return null;
  const xs = polygon.map(p => p.X || 0);
  const ys = polygon.map(p => p.Y || 0);
  const xMin = Math.min(...xs), xMax = Math.max(...xs);
  const yMin = Math.min(...ys), yMax = Math.max(...ys);
  return { text, xMin, xMax, yMin, yMax, yCenter: (yMin + yMax) / 2, height: yMax - yMin, width: xMax - xMin };
};

async function main() {
  const imgPath = process.argv[2];
  if (!imgPath) {
    console.error('Usage: node build-dict.js <image-path>');
    process.exit(1);
  }

  const outDir = path.dirname(imgPath);
  const filteredPath = path.join(outDir, 'dict_filtered.jpg');

  // 步骤1：颜色过滤预处理
  console.log('步骤1: 颜色过滤（只保留黑色和红色像素）...');
  await filterColors(imgPath, filteredPath);

  // 腾讯云 OCR 客户端
  const client = new OcrClient({
    credential: { secretId: process.env.TENCENT_SECRET_ID, secretKey: process.env.TENCENT_SECRET_KEY },
    region: 'ap-hongkong',
    profile: { httpProfile: { endpoint: 'ocr.ap-hongkong.tencentcloudapi.com', reqTimeout: 60000 } },
  });

  // 步骤2：全图 OCR（过滤图），确定列边界
  console.log('步骤2: 全图 OCR 过滤图，确定列边界...');
  const filteredBuf = fs.readFileSync(filteredPath);
  const filteredResp = await client.GeneralAccurateOCR({ ImageBase64: filteredBuf.toString('base64') });
  fs.writeFileSync(path.join(outDir, 'dict_ocr_raw.json'), JSON.stringify(filteredResp, null, 2), 'utf8');

  const filteredBlocks = [];
  const fullOcrBlocks = []; // 全图 OCR 所有文本块（含价格），用于后续合并
  for (const td of (filteredResp.TextDetections || [])) {
    const b = parseTd(td);
    if (!b) continue;
    fullOcrBlocks.push(b);
    if (isName(b.text)) filteredBlocks.push(b);
  }

  // 按 X 聚类成列：用品名块 xMin 的间隙分析
  filteredBlocks.sort((a, b) => a.xMin - b.xMin);
  // 计算相邻品名块 xMin 的间隙，取较大的间隙作为列分界
  const gaps = [];
  for (let i = 1; i < filteredBlocks.length; i++) {
    gaps.push({ idx: i, gap: filteredBlocks[i].xMin - filteredBlocks[i - 1].xMin });
  }
  gaps.sort((a, b) => b.gap - a.gap);
  // 取前 N-1 个最大间隙（N 为预期列数），间隙至少 > 150px 才算列分界
  const splitIndices = [];
  for (const g of gaps) {
    if (g.gap < 150) break;
    splitIndices.push(g.idx);
  }
  splitIndices.sort((a, b) => a - b);

  const colGroups = [];
  let start = 0;
  for (const si of splitIndices) {
    colGroups.push(filteredBlocks.slice(start, si));
    start = si;
  }
  colGroups.push(filteredBlocks.slice(start));
  console.log(`发现 ${colGroups.length} 列 (间隙分界: ${splitIndices.length} 个)`);

  // 计算列的切片边界（nameX_min ~ 下一列 nameX_min，或图右边界）
  const imgMeta = await sharp(imgPath).metadata();
  const imgW = imgMeta.width, imgH = imgMeta.height;
  const colBounds = [];
  for (let i = 0; i < colGroups.length; i++) {
    const minX = Math.min(...colGroups[i].map(b => b.xMin));
    const left = i === 0 ? 0 : colBounds[i - 1].right;
    const right = i < colGroups.length - 1
      ? Math.round((Math.max(...colGroups[i].map(b => b.xMax)) + Math.min(...colGroups[i + 1].map(b => b.xMin))) / 2)
      : imgW;
    colBounds.push({ left, right });
    console.log(`  列${i + 1}: x=[${left}, ${right}], 宽${right - left}px, ${colGroups[i].length}个品名块`);
  }

  // 步骤3：按列切片放大 OCR（过滤图，去掉背景和非黑非红标记）
  console.log('\n步骤3: 按列切片放大 OCR（过滤图）...');
  const SCALE = 3;
  const allEntries = [];

  for (let ci = 0; ci < colBounds.length; ci++) {
    const col = colBounds[ci];
    const left = Math.max(0, col.left);
    const right = Math.min(imgW, col.right);
    const w = right - left;

    console.log(`\n  列${ci + 1}: 切片 x=[${left},${right}]`);

    const colBuf = await sharp(filteredPath)
      .extract({ left, top: 0, width: w, height: imgH })
      .resize(w * SCALE, imgH * SCALE, { kernel: 'lanczos3' })
      .jpeg({ quality: 95 })
      .toBuffer();

    const resp = await client.GeneralAccurateOCR({ ImageBase64: colBuf.toString('base64') });
    const tds = resp.TextDetections || [];
    console.log(`    OCR: ${tds.length} 块`);

    // 解析文本块，坐标换算回原图
    const blocks = [];
    for (const td of tds) {
      const b = parseTd(td);
      if (!b) continue;
      blocks.push({
        ...b,
        xMin: b.xMin / SCALE + left,
        xMax: b.xMax / SCALE + left,
        yMin: b.yMin / SCALE,
        yMax: b.yMax / SCALE,
        yCenter: b.yCenter / SCALE,
        height: b.height / SCALE,
        width: b.width / SCALE,
      });
    }

    // 合并全图 OCR 中同列范围内的文本块（补充列切片可能漏识的）
    for (const fb of fullOcrBlocks) {
      if (fb.xMin < left || fb.xMin >= right) continue;
      // 检查是否已有同位置的块（yCenter 和 xMin 都接近）
      const dup = blocks.some(b => Math.abs(b.yCenter - fb.yCenter) < 8 && Math.abs(b.xMin - fb.xMin) < 20);
      if (!dup) {
        blocks.push(fb);
      }
    }

    // 按 Y 聚类成行
    blocks.sort((a, b) => a.yCenter - b.yCenter);
    if (blocks.length === 0) continue;
    const Havg = blocks.reduce((s, b) => s + b.height, 0) / blocks.length;
    const DY = Math.max(Havg * 1.0, 8);
    const rows = [];
    let cr = [blocks[0]];
    for (let i = 1; i < blocks.length; i++) {
      const rayc = cr.reduce((s, b) => s + b.yCenter, 0) / cr.length;
      if (Math.abs(blocks[i].yCenter - rayc) <= DY) {
        cr.push(blocks[i]);
      } else {
        rows.push(cr);
        cr = [blocks[i]];
      }
    }
    rows.push(cr);

    // 行内配对品名+价格
    for (const row of rows) {
      row.sort((a, b) => a.xMin - b.xMin);
      const classified = row.map(b => ({
        ...b,
        isPrice: isPrice(b.text),
        isName: isName(b.text) && b.text.length <= 15 && !/^\d+(\.\d+)?$/.test(b.text),
      }));

      const usedPrice = new Set();
      for (let i = 0; i < classified.length; i++) {
        const curr = classified[i];
        if (!curr.isName) continue;

        let priceBlock = null;
        let priceIdx = -1;
        for (let j = i + 1; j < classified.length; j++) {
          if (usedPrice.has(j)) continue;
          if (classified[j].isPrice) { priceBlock = classified[j]; priceIdx = j; break; }
          if (classified[j].isName) break;
        }
        if (priceIdx >= 0) usedPrice.add(priceIdx);
        const price = priceBlock ? parseP(priceBlock.text) : -1;
        if (price <= 0) continue;

        const nameBbox = { x: Math.round(curr.xMin), y: Math.round(curr.yMin), width: Math.round(curr.width), height: Math.round(curr.height) };
        const priceBbox = { x: Math.round(priceBlock.xMin), y: Math.round(priceBlock.yMin), width: Math.round(priceBlock.width), height: Math.round(priceBlock.height) };
        allEntries.push({ name: curr.text, value: price, nameBbox, priceBbox });
        console.log(`    ${curr.text} → ${price}`);
      }
    }
  }

  console.log(`\n配对总计: ${allEntries.length} 条`);

  // 去重：同名保留 y 较小的
  allEntries.sort((a, b) => a.nameBbox.y - b.nameBbox.y);
  const deduped = [];
  const seen = new Set();
  for (const e of allEntries) {
    if (!seen.has(e.name)) {
      seen.add(e.name);
      deduped.push(e);
    } else {
      console.log(`  去重: "${e.name}" (y=${e.nameBbox.y})`);
    }
  }
  console.log(`去重后: ${deduped.length} 条`);

  // 按列排序：列从左到右，列内从上到下
  const COL_GAP = 100;
  deduped.sort((a, b) => a.nameBbox.x - b.nameBbox.x);
  const columns = [];
  let curCol = [deduped[0]];
  for (let i = 1; i < deduped.length; i++) {
    const colAvgX = curCol.reduce((s, c) => s + c.nameBbox.x, 0) / curCol.length;
    if (Math.abs(deduped[i].nameBbox.x - colAvgX) <= COL_GAP) {
      curCol.push(deduped[i]);
    } else {
      columns.push(curCol);
      curCol = [deduped[i]];
    }
  }
  columns.push(curCol);

  const sorted = [];
  for (const col of columns) {
    col.sort((a, b) => a.nameBbox.y - b.nameBbox.y);
    sorted.push(...col);
  }

  // 构建字典
  const dict = {};
  for (const e of sorted) {
    dict[e.name] = {
      name: e.nameBbox,
      price: e.priceBbox,
      value: e.value,
    };
  }

  // 保存
  const dictPath = path.join(outDir, 'price_dict.json');
  fs.writeFileSync(dictPath, JSON.stringify(dict, null, 2), 'utf8');
  console.log(`\n字典生成完成：${Object.keys(dict).length} 条，保存到 ${dictPath}`);

  // 同步到 public 目录
  const publicDictPath = path.join(__dirname, '../../public/price_dict.json');
  fs.copyFileSync(dictPath, publicDictPath);
  console.log(`已同步到 ${publicDictPath}`);
}

main().catch(e => { console.error(e); process.exit(1); });

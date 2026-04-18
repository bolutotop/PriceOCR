'use server';

import path from 'path';
import fs from 'fs/promises';
import os from 'os';
import sharp from 'sharp';

import { runAliyunOcr } from './ocr-engine-aliyun';
import { runTencentOcr } from './ocr-engine-tencent';
import { correctCigaretteName } from '@/lib/corrector';

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
  rawName: string;              // OCR 原始识别的名字（未经纠错）
  correctedName?: string;       // 字典纠错后的标准名字（若命中）
  isCorrected?: boolean;        // 是否与 OCR 原文不同
  dictHit?: boolean;            // 是否通过字典锚点确认
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

    // 诊断：如果设置了关键字，把涉及该关键字的块的匹配轨迹收集起来
    const DBG_KW = ((globalThis as any).__OCR_DEBUG_KEYWORD__ as string | undefined) || '';
    const dbgTraceLog: string[] = [];
    (globalThis as any).__OCR_DBG_TRACE__ = dbgTraceLog;
    const dbgHit = (t: string | undefined): boolean => !!(DBG_KW && t && t.includes(DBG_KW));

    // 属性判断：是否为纯数字或断货标记 //
    // 扩展：
    //   1) 覆盖 OCR 常见断货符误识（||、÷、::、\\、全角｜｜、III 等）
    //   2) 识别 "141." / "660点" / "141点烫" 这种"数字尾部被污染"的价格 token
    const priceLikeRe = /^\s*(\d+(\.\d+)?|\/\/+|\/+\s*\/+|\|{2,}|｜{2,}|I{2,}|[Il]{2,}|÷+|:{2,}|\\{2,})\s*$/;
    // 污染价格：数字 + 少量汉字/标点后缀，当价格解析
    const dirtyPriceRe = /^\s*(\d+(?:\.\d+)?)(?:\.|\s)?(?:点烫?|点码)?\s*$/;

    const isPrice = (str: string) => {
      const clean = str.replace(/[¥,元\s]/g, '');
      if (priceLikeRe.test(clean)) return true;
      if (dirtyPriceRe.test(clean) && /\d/.test(clean)) return true;
      return false;
    };

    const parsePrice = (str: string): number => {
      const clean = str.replace(/[¥,元\s]/g, '');
      // 任何看似"断货符"的字符组合，都归一为 -1（缺货）
      if (/^(\/+|\|{2,}|｜{2,}|I{2,}|[Il]{2,}|÷+|:{2,}|\\{2,})$/.test(clean)) return -1;
      // 污染价格：从 "660点" / "141." 抠出数字部分
      const dm = clean.match(/^(\d+(?:\.\d+)?)/);
      if (dm) return parseFloat(dm[1]) || -1;
      return -1;
    };

    // 非价格标记 block（如单字的 "停" / "?" / "/" 等）：它们不参与配对，
    // 但在切图时会作为"右侧状态格"一起框进来，便于人工核对。
    const nonPriceMarkers: { xMin: number; xMax: number; yMin: number; yMax: number; text: string }[] = [];

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

        // 倾斜行基线：若引擎层已经保留了 polygon 四顶点（_leftY/_rightY），
        // 用它们更准；否则降级用包围盒中心 y。
        // 这是"cam 组倾斜图"能否正确同行配对的关键字段。
        const leftY = (b as any)._leftY !== undefined ? (b as any)._leftY : yCenter;
        const rightY = (b as any)._rightY !== undefined ? (b as any)._rightY : yCenter;

        return {
          id: index,
          text,
          xMin, xMax, yMin, yMax,
          xCenter, yCenter, height,
          leftY, rightY,
          used: false
        };
      }).filter((b: any) => b.text !== "");

      // 表格上方的"日期/注释/表头"噪声过滤：
      //   - 整体 Y 最小的 ~5% 范围内，若文本含 年|月|日|注|退回|必读|须知 关键词，丢弃
      //   - 整体 Y 最大的 ~3% 范围内（页脚）同理
      //   - 另外：分区表头（"XX中烟"）、超长告知语（含 "请提前沟通" / "行情到" 等）全图丢弃
      if (extractedBlocks.length > 10) {
        const ys = extractedBlocks.map((b: any) => b.yCenter).sort((a: number, b: number) => a - b);
        const topY = ys[Math.floor(ys.length * 0.05)];
        const botY = ys[Math.floor(ys.length * 0.97)];
        const noiseRe = /(年|月|日|注[：:\s]|退回|必读|须知|不收|以上|要点码)/;
        // 分区表头：湖南中烟 / 贵州中烟 / 广西中烟 / 进口中烟 ... 固定尾缀 "中烟"
        const sectionHeaderRe = /^[\u4e00-\u9fa5]{1,4}中烟$/;
        // 长段落告知：包含常见行情注释关键词
        const longNoticeRe = /(请提前沟通|行情到|发单按|老货不收|不收退回|第二天|下午\d+点|上午\d+点|请咨位|请咨询|详细了解日期|按标准减钱|去货不要了|行情减|以下减|以上减|元[;；]|减\d+元|扣钱|明细和价格|请写好|请! ?请!|交由我们|中华系列只收|刀割码)/;
        extractedBlocks = extractedBlocks.filter((b: any) => {
          if (b.yCenter <= topY && noiseRe.test(b.text)) return false;
          if (b.yCenter >= botY && noiseRe.test(b.text)) return false;
          // 绝对顶部 3% 区域：无条件丢弃（页眉、店名、表头等非品名文字）
          // 正常品名表格的内容不会出现在图片最顶端，这里的文字几乎都是噪声。
          if (b.yCenter < origHeight * 0.03) return false;
          // 绝对底部 2% 区域：同理丢弃（页脚）
          if (b.yCenter > origHeight * 0.98) return false;
          // 单字符的问号/停/斜杠当名字会干扰配对，也丢弃；
          // 但先保留几何信息，后续用于把"右侧非数字格"一起框进切图里
          if (/^[?？\/\\停]$/.test(b.text)) {
            nonPriceMarkers.push({ xMin: b.xMin, xMax: b.xMax, yMin: b.yMin, yMax: b.yMax, text: b.text });
            return false;
          }
          // 分区表头全图丢弃
          if (sectionHeaderRe.test(b.text)) return false;
          // 长注释全图丢弃
          if (longNoticeRe.test(b.text)) return false;
          // "点烫" 单独成块或残留前缀，一律丢弃
          if (/^点烫$/.test(b.text)) return false;
          // 单个汉字片段（"透"、"广"、"烟" 等）——  不可能是完整品名，丢弃
          if (/^[\u4e00-\u9fa5]$/.test(b.text)) return false;
          return true;
        });
      }

      const H_avg = extractedBlocks.reduce((sum: number, b: any) => sum + b.height, 0) / (extractedBlocks.length || 1);
      const DELTA_Y = H_avg * 0.6; // 同行高度容差（基础）
      // 倾斜容差：cam 组倾斜图中，同一行左右两端 y 差可以接近一个字高。
      // 用它做"行基线"对齐，比单纯比较 yCenter 更宽容。
      // 但必须小于"相邻两行的 y 间距"，否则会吃到邻行数据。
      // 实测表明相邻两行 y 中心差约 1.1-1.4 倍字高，故这里设 0.75 较稳。
      const DELTA_Y_TILT = H_avg * 0.75;

      // 诊断暴露 H_avg，便于 /api/ocr-debug 追查"看似同行却被错配"的问题
      (globalThis as any).__OCR_H_AVG__ = H_avg;

      /**
       * 判断两个块是否"在同一行"。
       * 策略：
       *   1) 先用 yCenter 差快速判定（< DELTA_Y）；
       *   2) 若 yCenter 差较大（可能是倾斜），再用"a 在 b 的 x 位置上的预计 y"做二次判定
       *      —— 用 b 的左右端 y（leftY/rightY）做线性插值，得到 b 行在 a.xCenter 处的 y，
       *      与 a.yCenter 做容差比较。容差用 DELTA_Y_TILT（默认 0.75 字高）。
       *   3) 附加硬约束：|a.yCenter - b.yCenter| 不得超过 1.2 倍字高，
       *      避免跨 1 个完整邻行。
       * 这样既能接住正射文档（doc 组），又能接住倾斜拍照（cam 组），
       * 同时不会把"上/下一行"当成同一行。
       */
      const sameRow = (a: any, b: any): boolean => {
        const yDiff = Math.abs(a.yCenter - b.yCenter);
        // 硬约束：跨 1.2 个字高以上绝对不认为同行
        if (yDiff > H_avg * 1.2) return false;
        if (yDiff <= DELTA_Y) return true;

        // 用 b 行的基线在 a.xCenter 处的插值 y 再判一次（需要 b 有倾斜）
        // 若 b 本身是水平块（leftY≈rightY），跳过本判，避免把邻行吃成"插值命中"
        const bTilt = Math.abs((b.rightY ?? b.yCenter) - (b.leftY ?? b.yCenter));
        if (bTilt >= H_avg * 0.25) {
          const bXL = b.xMin, bXR = b.xMax;
          const bW = Math.max(1, bXR - bXL);
          const t = Math.max(-0.3, Math.min(1.3, (a.xCenter - bXL) / bW));
          const interpY = b.leftY + (b.rightY - b.leftY) * t;
          if (Math.abs(a.yCenter - interpY) <= DELTA_Y_TILT) return true;
        }
        // 对称再判一次（只在 a 也倾斜时）
        const aTilt = Math.abs((a.rightY ?? a.yCenter) - (a.leftY ?? a.yCenter));
        if (aTilt >= H_avg * 0.25) {
          const aXL = a.xMin, aXR = a.xMax;
          const aW = Math.max(1, aXR - aXL);
          const t2 = Math.max(-0.3, Math.min(1.3, (b.xCenter - aXL) / aW));
          const interpY2 = a.leftY + (a.rightY - a.leftY) * t2;
          if (Math.abs(b.yCenter - interpY2) <= DELTA_Y_TILT) return true;
        }
        return false;
      };

      // 诊断：把 "黑逸品喜" 在 3.A/3.B 的遇到情况记下
      // 注：dbgHit / dbgTraceLog 已在 action 顶层定义，这里无需再声明



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

      // 诊断：打印 y=300~330 行的所有 block
      const dbgRowBlocks = extractedBlocks.filter((b: any) => b.yCenter >= 300 && b.yCenter <= 330);
      if (dbgRowBlocks.length > 0) {
        console.log(`[诊断 y=300~330] 共 ${dbgRowBlocks.length} 个 block:`);
        for (const b of dbgRowBlocks) {
          const globalIdx = extractedBlocks.indexOf(b);
          console.log(`  idx=${globalIdx} "${b.text}"(y=${b.yCenter.toFixed(0)},x=${b.xMin}..${b.xMax})`);
        }
      }
      // 诊断：打印 y=955~985 行的所有 block（3克细95南京行）
      const dbgRow2 = extractedBlocks.filter((b: any) => b.yCenter >= 955 && b.yCenter <= 985);
      if (dbgRow2.length > 0) {
        console.log(`[诊断 y=955~985] 共 ${dbgRow2.length} 个 block:`);
        for (const b of dbgRow2) {
          const globalIdx = extractedBlocks.indexOf(b);
          console.log(`  idx=${globalIdx} "${b.text}"(y=${b.yCenter.toFixed(0)},x=${b.xMin}..${b.xMax})`);
        }
      }


      // =====================================================================
      // 2.5 修复水平断裂：将太近的同类文本合并 (如 "黄鹤楼" 和 "软包")
      //     注意：价格列之间间距很小，合并策略必须足够保守，否则会把旁边一列的
      //     品名也并进来，导致真价格配不上。
      // =====================================================================
      // =====================================================================
      // 2.5 修复水平断裂：将太近的同类文本合并 (如 "商鼎" 和 "新版"、"黄鹤楼" 和 "软包")
      //     策略：不再只看 extractedBlocks[i+1]（因为聚类错误会导致同行 block 在
      //     全局索引上非相邻），而是**全局搜索 curr 右侧最近的同行文本 block**
      //     进行合并判定。
      //     注意：价格列之间间距很小，合并策略必须足够保守，否则会把旁边一列的
      //     品名也并进来，导致真价格配不上。
      //     安全约束：
      //       a) 目标块不是价格（否则留给后续配对）；
      //       b) 合并后若文本出现"汉字+数字+汉字"模式（如"银休闲禾1165细圣出山"），
      //          说明跨列了，立即回滚并停止合并。
      //       c) gap 必须 < H_avg * 0.6（保持原有严格性，避免误合相邻列）。
      // =====================================================================
      // 检测"品名+价格+品名"跨列粘连的正则：汉字结尾 + 3~4位数字 + 汉字开头
      const crossColumnRe = /[\u4e00-\u9fa5A-Za-z]\d{2,5}[\u4e00-\u9fa5]/;

      for (let i = 0; i < extractedBlocks.length; i++) {
        const curr = extractedBlocks[i];
        if (curr.used || isPrice(curr.text)) continue;

        // 全局扫描 curr 右侧最近的同行文本 block（不限制 idx 相邻）
        let bestJ = -1;
        let bestGap = Infinity;
        for (let j = 0; j < extractedBlocks.length; j++) {
          if (j === i) continue;
          const nb = extractedBlocks[j];
          if (nb.used || isPrice(nb.text)) continue;
          if (Math.abs(nb.yCenter - curr.yCenter) > DELTA_Y) continue;
          const gapX = nb.xMin - curr.xMax;
          if (gapX <= -H_avg || gapX >= H_avg * 0.6) continue; // 过远或严重重叠都跳过
          if (gapX < 0) continue; // 只合并在右侧
          if (gapX < bestGap) { bestGap = gapX; bestJ = j; }
        }

        if (bestJ !== -1) {
          const next = extractedBlocks[bestJ];
          const mergedText = curr.text + next.text;
          // 安全检查：合并后出现"汉字+数字+汉字"说明跨列了，不合并
          if (crossColumnRe.test(mergedText)) continue;

          curr.text = mergedText;
          curr.xMax = Math.max(curr.xMax, next.xMax);
          curr.yMin = Math.min(curr.yMin, next.yMin);
          curr.yMax = Math.max(curr.yMax, next.yMax);
          curr.yCenter = (curr.yMin + curr.yMax) / 2;
          next.used = true;
          i--; // 继续检查是否有第三块相连
        }
      }
      extractedBlocks = extractedBlocks.filter((b: any) => !b.used);

      // =====================================================================
      // 2.8 字典锚点扫描：对每个非价格 block，用 correctCigaretteName 判定
      //     是否为"字典确认品名"。命中的会挂上 dictName / dictCorrected。
      //     这是后续配对的强锚点：命中字典的名字优先配对，且不会被其它噪声干扰。
      // =====================================================================
      let dictHits = 0;
      for (const b of extractedBlocks) {
        if (isPrice(b.text)) continue;
        // 如果是 "名字+数字" 粘连形式（如 "合1906喜147"），先把名字部分剥出来喂字典
        let nameOnly = b.text;
        const mix = nameOnly.match(/^(.+?[\u4e00-\u9fa5A-Za-z])(\d+(?:\.\d+)?|\/\/+|\/+\s*\/+)$/);
        if (mix) nameOnly = mix[1].trim();

        const res = correctCigaretteName(nameOnly);
        if (res.confidence === 'high' || res.confidence === 'medium') {
          b.dictName = res.corrected;
          b.dictCorrected = res.isModified;
          b.dictConfidence = res.confidence;
          b.nameOnly = nameOnly; // 保存纯名字，供 mixMatch 用
          dictHits++;
        }
      }
      console.log(`[OCR 字典] 扫描 ${extractedBlocks.filter((b:any)=>!isPrice(b.text)).length} 个非价格块，字典命中 ${dictHits} 条`);

      // =====================================================================
      // 3. 水平顺序配对 (Sequential Next-Neighbor Pairing)
      // =====================================================================
      // 最大寻找距离：一张 10 列表每列约 10% 宽，用 18% 足以覆盖"名字→价格"，
      // 同时阻止跨越两列以上的错配
      const MAX_X_DISTANCE = origWidth * 0.18;

      // ---------------------------------------------------------------
      // 3.A 字典优先配对：每个字典命中的 block 都去同一行右侧找最近的价格
      //     这一阶段允许跳过中间的非字典文本（它们可能是噪声），但不跨行
      // ---------------------------------------------------------------
      for (let i = 0; i < extractedBlocks.length; i++) {
        const curr = extractedBlocks[i];
        if (curr.used) continue;
        if (!curr.dictName) continue; // 只处理字典命中的

        // 若 curr 自身就是"名字+价格"连体，先切开
        const mixRe = /^(.+?[\u4e00-\u9fa5A-Za-z\)\]])(\d+(?:\.\d+)?|\/\/+|\/+\s*\/+)$/;
        const mix = curr.text.match(mixRe);
        if (mix && curr.nameOnly && mix[1].trim() === curr.nameOnly) {
          matchedPairs.push({
            rawName: curr.nameOnly,
            correctedName: curr.dictName,
            isCorrected: curr.dictCorrected,
            dictHit: true,
            price: parsePrice(mix[2]),
            unionBounds: { left: curr.xMin, right: curr.xMax, top: curr.yMin, bottom: curr.yMax }
          });
          curr.used = true;
          continue;
        }

        // 向右扫描同一行，最多跳过 5 个中间块，找第一个价格
        //   - 同行判定使用 sameRow（兼容倾斜 cam 图）
        //   - 遇到下一个"字典锚点"不再立刻 break：如果它在 MAX_X_DISTANCE 之内
        //     说明可能是 OCR 把下一列的品名粘在了当前行尾端，而价格可能还在它之后。
        //     仅在 "x 已越过 MAX_X_DISTANCE" 或 "明显跨行" 时才 break。
        let priceBlock: any = null;
        for (let j = i + 1; j < Math.min(extractedBlocks.length, i + 8); j++) {
          const nx = extractedBlocks[j];
          if (nx.used) continue;
          if (!sameRow(nx, curr)) break;                          // 跨行，停止
          if (nx.xMin - curr.xMax > MAX_X_DISTANCE) break;        // 太远，停止
          if (isPrice(nx.text)) { priceBlock = nx; break; }
          // 不再因"遇到字典锚点"主动 break，继续找
        }

        if (priceBlock) {
          const priceParsed = parsePrice(priceBlock.text);
          // 诊断：追踪谁抢了哪个价格（重点关注 971 等 missing 案例）
          if (priceParsed === 971 || priceParsed === 131.5 || (curr.yCenter >= 180 && curr.yCenter <= 240) || (curr.yCenter >= 900 && curr.yCenter <= 930)) {
            console.log(`[3.A 诊断] "${curr.text}"(y=${curr.yCenter.toFixed(0)},x=${curr.xMin}..${curr.xMax}) 抢到价格 "${priceBlock.text}"=${priceParsed} (y=${priceBlock.yCenter.toFixed(0)},x=${priceBlock.xMin}..${priceBlock.xMax})`);
          }
          matchedPairs.push({
            rawName: curr.text,
            correctedName: curr.dictName,
            isCorrected: curr.dictCorrected,
            dictHit: true,
            price: priceParsed,
            unionBounds: {
              left: Math.min(curr.xMin, priceBlock.xMin),
              top: Math.min(curr.yMin, priceBlock.yMin),
              right: Math.max(curr.xMax, priceBlock.xMax),
              bottom: Math.max(curr.yMax, priceBlock.yMax)
            }
          });
          curr.used = true;
          priceBlock.used = true;
        } else {
          // 字典命中但没价格（断货），保留条目但 price=-1
          if ((curr.yCenter >= 180 && curr.yCenter <= 240) || (curr.yCenter >= 900 && curr.yCenter <= 930)) {
            console.log(`[3.A 诊断] "${curr.text}"(y=${curr.yCenter.toFixed(0)},x=${curr.xMin}..${curr.xMax}) 未找到右侧价格`);
          }
          matchedPairs.push({
            rawName: curr.text,
            correctedName: curr.dictName,
            isCorrected: curr.dictCorrected,
            dictHit: true,
            price: -1,
            unionBounds: { left: curr.xMin, right: curr.xMax, top: curr.yMin, bottom: curr.yMax }
          });
          curr.used = true;
        }
      }

      // ---------------------------------------------------------------
      // 3.B 几何兜底配对：对字典未命中的 block 走原来的水平配对流程
      // ---------------------------------------------------------------
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
          // 当前是名字，往后看 1 到 3 个兄弟节点（cam 图倾斜时，中间可能插入小文本）
          let foundPrice = false;
          // 动态 curr 信息：若遇到短修饰词（如"新版"/"点码"/"礼盒"）吸并进来，
          // 会更新 mergedName / mergedXMax，让后续 step 的距离判定基于"合并后的 curr"。
          let mergedName = curr.text;
          let mergedXMax = curr.xMax;
          let mergedXMin = curr.xMin;
          let mergedYMin = curr.yMin;
          let mergedYMax = curr.yMax;
          const mergedChildren: any[] = [];  // 记录被吸并的短块，成功配对时一并 used

          if (dbgHit(curr.text)) dbgTraceLog.push(`[3.B] curr="${curr.text}" y=${curr.yCenter.toFixed(1)} x=[${curr.xMin}..${curr.xMax}]  dictName=${curr.dictName || 'none'}`);

          // 临时诊断：合至尊/商鼎所在行
          const isDbgRow = (curr.yCenter >= 900 && curr.yCenter <= 930) || (curr.yCenter >= 300 && curr.yCenter <= 340);
          if (isDbgRow) {
            console.log(`[3.B 逐步] curr="${curr.text}"(y=${curr.yCenter.toFixed(0)},x=${curr.xMin}..${curr.xMax},used=${curr.used},isPrice=${isPrice(curr.text)}) i=${i} len=${extractedBlocks.length}`);
            // 额外诊断：看看 i+1 ~ i+5 的 block 情况
            for (let k = 1; k <= 5; k++) {
              const nb = extractedBlocks[i + k];
              if (!nb) { console.log(`    预览 i+${k}: 越界`); break; }
              console.log(`    预览 i+${k}="${nb.text}"(y=${nb.yCenter.toFixed(0)},x=${nb.xMin}..${nb.xMax},used=${nb.used})`);
            }
          }

          for (let step = 1; step <= 4; step++) {
            if (isDbgRow) console.log(`  [进入] step=${step}`);
            const nextIdx = i + step;
            if (nextIdx >= extractedBlocks.length) {
              if (isDbgRow) console.log(`  [break] nextIdx=${nextIdx} >= len`);
              break;
            }
            const next = extractedBlocks[nextIdx];
            if (next.used) {
              if (isDbgRow) console.log(`  step=${step} next="${next.text}" used=true 跳过`);
              continue;
            }

            // 使用行基线判定（抗倾斜）
            const sr = sameRow(next, curr);
            if (dbgHit(curr.text)) dbgTraceLog.push(`  step=${step} next="${next.text}" y=${next.yCenter.toFixed(1)} x=[${next.xMin}..${next.xMax}]  sameRow=${sr}  isPrice=${isPrice(next.text)}`);
            if (isDbgRow) console.log(`  step=${step} next="${next.text}"(y=${next.yCenter.toFixed(0)},x=${next.xMin}..${next.xMax},used=${next.used}) sameRow=${sr} isPrice=${isPrice(next.text)}`);
            if (!sr) {
              if (isDbgRow) console.log(`  [break] !sr`);
              break;
            }

            if (isPrice(next.text)) {
              const distanceX = next.xMin - mergedXMax;
              // 价格必须在名字右侧，且不能跨越半张图
              if (distanceX < MAX_X_DISTANCE && mergedXMin < next.xCenter) {
                if (dbgHit(curr.text)) dbgTraceLog.push(`  -> MATCHED "${next.text}"`);
                const parsedP = parsePrice(next.text);
                if (parsedP === 971 || parsedP === 131.5 || parsedP === 163.2 || (curr.yCenter >= 180 && curr.yCenter <= 240) || (curr.yCenter >= 900 && curr.yCenter <= 930) || (curr.yCenter >= 300 && curr.yCenter <= 330)) {
                  console.log(`[3.B 诊断] "${mergedName}"(y=${curr.yCenter.toFixed(0)}) 抢到价格 "${next.text}"=${parsedP} (y=${next.yCenter.toFixed(0)})`);
                }
                matchedPairs.push({
                  rawName: mergedName,
                  price: parsedP,
                  unionBounds: {
                    left: Math.min(mergedXMin, next.xMin),
                    top: Math.min(mergedYMin, next.yMin),
                    right: Math.max(mergedXMax, next.xMax),
                    bottom: Math.max(mergedYMax, next.yMax)
                  }
                });
                curr.used = true;
                next.used = true;
                for (const child of mergedChildren) child.used = true;
                foundPrice = true;
                break;
              }
            } else {
              // 遇到另一个名字：判断是否为"短修饰词"（如"新版"、"点码"、"礼盒"），
              // 如果是，把它合并进当前品名继续往后找价格；否则 break。
              //   吸并条件：
              //     a) 文本纯汉字/字母（不含特殊符号），且长度 <= 2 字；
              //     b) x 距离当前 mergedXMax 不超过 2 倍字高；
              //     c) 不是字典命中的独立品名（字典品名优先独立存在）。
              const h = Math.max(12, curr.yMax - curr.yMin);
              const gapX = next.xMin - mergedXMax;
              const isShortModifier =
                /^[\u4e00-\u9fa5A-Za-z]{1,2}$/.test(next.text) &&
                gapX >= 0 && gapX <= h * 2 &&
                !next.dictName;
              if (isShortModifier) {
                if (isDbgRow) console.log(`  step=${step} 吸并短修饰词 "${next.text}" 进 mergedName`);
                mergedName += next.text;
                mergedXMax = Math.max(mergedXMax, next.xMax);
                mergedXMin = Math.min(mergedXMin, next.xMin);
                mergedYMin = Math.min(mergedYMin, next.yMin);
                mergedYMax = Math.max(mergedYMax, next.yMax);
                mergedChildren.push(next);
                // 继续循环（不 break），去找价格
                continue;
              }
              // 不是短修饰词 → 真的另一个品名，打断
              break;
            }
          }

          // 兜底：3.B 基于 i+1..i+4 的 sibling 扫描，可能因为聚类失败漏掉了
          // 真正同行的价格 block（如 extractedBlocks 里 y=317 行的 block 被打散到
          // 非连续 idx）。这里再做一次"全局扫描同行最近价格"的兜底。
          //
          // y 容差必须严格（0.6 × 行高），避免 y 稍近但不同行的品名错抢价格。
          // 例："白王者荣耀"(y=160) 不应抢 "合黑芙王"(y=186) 同行的 "274.5"(y=178)，
          //    因为 y 差 18 > 0.6 × 14 ≈ 8.4，超出严格同行容差。
          if (!foundPrice) {
            const H_row = Math.max(12, curr.yMax - curr.yMin);
            const yTolStrict = H_row * 0.6;
            let bestJ = -1;
            let bestScore = Infinity;
            let bestDy = Infinity;
            let bestDx = Infinity;
            for (let j = 0; j < extractedBlocks.length; j++) {
              if (j === i) continue;
              const nb = extractedBlocks[j];
              if (nb.used) continue;
              if (!isPrice(nb.text)) continue;
              const dy = Math.abs(nb.yCenter - curr.yCenter);
              if (dy > yTolStrict) continue;
              if (nb.xMin < mergedXMax - H_row * 0.3) continue; // 必须在右侧
              const dx = nb.xMin - mergedXMax;
              if (dx > MAX_X_DISTANCE) continue;
              // 评分：y 差权重远大于 x 差
              const score = dy * 10 + dx * 0.1;
              if (score < bestScore) { bestScore = score; bestJ = j; bestDy = dy; bestDx = dx; }
            }
            // 安全守卫：在 curr 和候选价格之间，**不能有未 used 的其它品名块**。
            // 否则说明 curr 和候选价格之间还隔着一个品名，这个价格大概率属于那个品名。
            // 例："329软中"(y=385,x=285..346) 与 "1310"(y=390,x=407..441) 之间如果还有
            //    另一个品名块，说明 1310 属于中间那个品名，不该被 329软中 抢走。
            if (bestJ !== -1) {
              const priceBlock = extractedBlocks[bestJ];
              let hasInterveningName = false;
              for (let k = 0; k < extractedBlocks.length; k++) {
                if (k === i || k === bestJ) continue;
                const ob = extractedBlocks[k];
                if (ob.used) continue;
                if (isPrice(ob.text)) continue;
                // y 是否在 curr y 附近（严格同行）
                if (Math.abs(ob.yCenter - curr.yCenter) > yTolStrict) continue;
                // 是否在 curr 和 priceBlock 之间（x 方向）
                if (ob.xMin > mergedXMax && ob.xMax < priceBlock.xMin) {
                  hasInterveningName = true;
                  break;
                }
              }
              if (hasInterveningName) {
                if (isDbgRow) console.log(`  [3.B 全局兜底] curr="${mergedName}" 放弃：中间有其它品名块`);
                bestJ = -1;
              }
            }
            if (bestJ !== -1) {
              const nb = extractedBlocks[bestJ];
              const parsedP = parsePrice(nb.text);
              if (isDbgRow) console.log(`  [3.B 全局兜底] curr="${mergedName}" 找到同行价格 "${nb.text}"=${parsedP} dy=${bestDy.toFixed(0)} dx=${bestDx.toFixed(0)}`);
              console.log(`[3.B 全局兜底] "${mergedName}"(y=${curr.yCenter.toFixed(0)}) 抢到价格 "${nb.text}"=${parsedP} (y=${nb.yCenter.toFixed(0)},dy=${bestDy.toFixed(0)},dx=${bestDx.toFixed(0)})`);
              matchedPairs.push({
                rawName: mergedName,
                price: parsedP,
                unionBounds: {
                  left: Math.min(mergedXMin, nb.xMin),
                  top: Math.min(mergedYMin, nb.yMin),
                  right: Math.max(mergedXMax, nb.xMax),
                  bottom: Math.max(mergedYMax, nb.yMax)
                }
              });
              curr.used = true;
              nb.used = true;
              for (const child of mergedChildren) child.used = true;
              foundPrice = true;
            }
          }

          if (!foundPrice) {
            matchedPairs.push({
              rawName: mergedName,
              price: -1,
              unionBounds: { left: mergedXMin, right: mergedXMax, top: mergedYMin, bottom: mergedYMax }
            });
            curr.used = true;
            for (const child of mergedChildren) child.used = true;
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

    // 诊断：检查 3.A/3.B 之后，971 被谁认领了
    {
      const got971 = matchedPairs.filter(p => p.price === 971);
      if (got971.length > 0) {
        console.log(`[诊断] price=971 被 ${got971.length} 条认领: ${got971.map(p => `"${p.rawName}"(y=${Math.round((p.unionBounds.top+p.unionBounds.bottom)/2)})`).join(', ')}`);
      } else {
        console.log(`[诊断] price=971 未出现在任何 matchedPair 中（OCR 可能没识别出 971 或拼进了别的块）`);
      }
    }

    // =====================================================================
    // 3.5 列锚点兜底：把"未配上价格的名字"与"孤立数字"基于列坐标配对
    // 场景：密集表格中名字和价格 Polygon 被 OCR 错位时，
    //       水平顺序配对会失败，但这些数字会落在固定的"价格列"上。
    // 做法：
    //   a) 收集所有孤立数字（【孤立数字】）的 xCenter，做 1D 聚类得到"价格列"锚点
    //   b) 对每个 price === -1 的名字项，找它右侧**最近的列锚点**，并只在
    //      该锚点附近（±COL_RADIUS）去认领孤立数字；严禁跨列去找更远的数字
    //   c) 命中则合并进该名字项，移除对应的孤立数字项
    //   d) 合并 unionBounds 时限制总宽度，防止切片横跨多列
    // =====================================================================
    {
      const H_avg_pairs = matchedPairs.reduce((s, p) => s + (p.unionBounds.bottom - p.unionBounds.top), 0)
        / (matchedPairs.length || 1);
      // 同行 y 容差：必须小于"相邻两行的 y 间距"（约 1.1-1.4 字高）。
      // 策略：phase 0（严格）0.75 倍字高；phase 1（宽松）1.05 倍字高。
      // 宽松容差只用于 phase 1 兜底，第一轮仍以严格容差优先抢占，避免邻行互相偷价。
      const ROW_TOL_STRICT = H_avg_pairs * 0.75;
      const ROW_TOL_LOOSE = H_avg_pairs * 1.05;

      // a) 收集孤立数字的 xCenter
      const orphanIdxs: number[] = [];
      const orphanXc: number[] = [];
      matchedPairs.forEach((p, idx) => {
        if (p.rawName === '【孤立数字】') {
          orphanIdxs.push(idx);
          orphanXc.push((p.unionBounds.left + p.unionBounds.right) / 2);
        }
      });

      // 1D 聚类（阈值 = origWidth * 0.04），对每个簇维护累加均值
      // 之前的版本用"最后一点和新点平均"会被早期噪声带偏，改为累积均值。
      const sortedXc = [...orphanXc].sort((a, b) => a - b);
      const columnAnchors: number[] = [];
      const columnSum: number[] = [];
      const columnCnt: number[] = [];
      const CLUSTER_TOL = origWidth * 0.04;
      for (const x of sortedXc) {
        const lastIdx = columnAnchors.length - 1;
        if (lastIdx < 0 || Math.abs(x - columnAnchors[lastIdx]) > CLUSTER_TOL) {
          columnAnchors.push(x);
          columnSum.push(x);
          columnCnt.push(1);
        } else {
          columnSum[lastIdx] += x;
          columnCnt[lastIdx] += 1;
          columnAnchors[lastIdx] = columnSum[lastIdx] / columnCnt[lastIdx];
        }
      }

      // 列半径：相邻两个锚点间距的一半，用于判断一个数字是否"属于"该锚点
      // 若只有 1 列，则回退到一个保守常量
      let COL_RADIUS = origWidth * 0.05;
      if (columnAnchors.length >= 2) {
        let minGap = Number.POSITIVE_INFINITY;
        for (let i = 1; i < columnAnchors.length; i++) {
          minGap = Math.min(minGap, columnAnchors[i] - columnAnchors[i - 1]);
        }
        COL_RADIUS = minGap * 0.45; // 稍小于半距，避免进入邻列领域
      }

      // 单次配对的最大 union 宽度：不超过 (相邻列间距) * 1.6
      let MAX_UNION_W = origWidth * 0.25;
      if (columnAnchors.length >= 2) {
        let maxGap = 0;
        for (let i = 1; i < columnAnchors.length; i++) {
          maxGap = Math.max(maxGap, columnAnchors[i] - columnAnchors[i - 1]);
        }
        MAX_UNION_W = maxGap * 1.6;
      }

      const consumedOrphans = new Set<number>();

      // b) 遍历所有 price === -1 的名字项，去认领最近列锚点内的数字
      //    分两轮：第一轮严格（±COL_RADIUS），第二轮宽松（±LOOSE_RADIUS）
      const LOOSE_RADIUS = (columnAnchors.length >= 2)
        ? (columnAnchors[1] - columnAnchors[0]) * 0.9
        : origWidth * 0.09;

      for (const phase of [0, 1] as const) {
        const radius = phase === 0 ? COL_RADIUS : LOOSE_RADIUS;
        // phase 0 严格、phase 1 宽松；但宽松容差不能超过相邻行间距，否则会偷邻行
        const rowTol = phase === 0 ? ROW_TOL_STRICT : ROW_TOL_LOOSE;

        for (const pair of matchedPairs) {
          if (pair.price !== -1) continue;
          if (pair.rawName === '【孤立数字】') continue;

          const nameYc = (pair.unionBounds.top + pair.unionBounds.bottom) / 2;
          const nameRight = pair.unionBounds.right;
          const isDbg = dbgHit(pair.rawName);
          if (isDbg) dbgTraceLog.push(`[3.5 phase=${phase}] pair="${pair.rawName}" nameYc=${nameYc.toFixed(1)} nameRight=${nameRight} rowTol=${rowTol.toFixed(1)} radius=${radius.toFixed(1)} columns=[${columnAnchors.map(x => Math.round(x)).join(',')}] COL_RADIUS=${COL_RADIUS.toFixed(1)}`);

          // 找"名字右侧"所有可能的列锚点（距离由近到远，最多尝试 3 个）。
          // 锚点必须严格位于 nameRight 右边（至少 0.5 倍字高的 gap）
          // —— 避免名字右边界卡在一个品名列末尾时把该列误当成自己的价格列。
          const MIN_RIGHT_GAP = H_avg_pairs * 0.5;
          const candidateAnchors: number[] = [];
          const MAX_X_DIST_3P5 = origWidth * 0.22;
          for (const a of columnAnchors) {
            if (a >= nameRight + MIN_RIGHT_GAP && a - nameRight < MAX_X_DIST_3P5) {
              candidateAnchors.push(a);
              if (candidateAnchors.length >= 3) break;
            }
          }
          if (isDbg) dbgTraceLog.push(`  candidateAnchors=[${candidateAnchors.map(a => a.toFixed(1)).join(',')}]`);
          if (candidateAnchors.length === 0) continue;

          // 依次在每个候选锚点附近搜索孤立数字，取最先命中且最近的
          let bestIdx = -1;
          let bestDx = Number.POSITIVE_INFINITY;
          let bestAnchor = -1;
          for (const targetAnchor of candidateAnchors) {
            for (let k = 0; k < orphanIdxs.length; k++) {
              if (consumedOrphans.has(k)) continue;
              const op = matchedPairs[orphanIdxs[k]];
              const opYc = (op.unionBounds.top + op.unionBounds.bottom) / 2;
              const dy = Math.abs(opYc - nameYc);
              const dxAnchor = Math.abs(orphanXc[k] - targetAnchor);
              const rejReasons: string[] = [];
              if (dy > rowTol) rejReasons.push(`dy=${dy.toFixed(1)}>rowTol`);
              if (dxAnchor > radius) rejReasons.push(`dxAnchor=${dxAnchor.toFixed(1)}>radius`);
              if (orphanXc[k] <= nameRight - H_avg_pairs * 0.3) rejReasons.push(`notRight`);
              if (isDbg) dbgTraceLog.push(`  [anchor=${targetAnchor.toFixed(0)}] orphan#${k} price=${op.price} opYc=${opYc.toFixed(1)} opXc=${orphanXc[k].toFixed(1)} dy=${dy.toFixed(1)} dxAnchor=${dxAnchor.toFixed(1)} ${rejReasons.length ? 'REJ:'+rejReasons.join(',') : 'OK'}`);
              if (rejReasons.length > 0) continue;

              if (dxAnchor < bestDx) {
                bestDx = dxAnchor;
                bestIdx = k;
                bestAnchor = targetAnchor;
              }
            }
            // 一旦在"较近的"锚点找到匹配，就不继续尝试更远的锚点
            // 这避免把真正属于本列的价格传递给远列
            if (bestIdx !== -1) break;
          }

          if (bestIdx !== -1) {
            const op = matchedPairs[orphanIdxs[bestIdx]];
            const newLeft = Math.min(pair.unionBounds.left, op.unionBounds.left);
            const newRight = Math.max(pair.unionBounds.right, op.unionBounds.right);
            if (newRight - newLeft > MAX_UNION_W) {
              if (isDbg) dbgTraceLog.push(`  -> rejected by MAX_UNION_W (${(newRight-newLeft).toFixed(0)}>${MAX_UNION_W.toFixed(0)})`);
              continue;
            }
            if (isDbg) dbgTraceLog.push(`  -> CLAIMED orphan #${bestIdx} price=${op.price} dx=${bestDx.toFixed(1)} opYc=${((op.unionBounds.top+op.unionBounds.bottom)/2).toFixed(1)}`);
            pair.price = op.price;
            pair.unionBounds = {
              left: newLeft,
              top: Math.min(pair.unionBounds.top, op.unionBounds.top),
              right: newRight,
              bottom: Math.max(pair.unionBounds.bottom, op.unionBounds.bottom),
            };
            consumedOrphans.add(bestIdx);
          }
        }
      }

      // c) 移除被消耗的孤立数字
      if (consumedOrphans.size > 0) {
        const toRemove = new Set<number>();
        consumedOrphans.forEach(k => toRemove.add(orphanIdxs[k]));
        // 原地过滤
        const kept: typeof matchedPairs = [];
        for (let i = 0; i < matchedPairs.length; i++) {
          if (!toRemove.has(i)) kept.push(matchedPairs[i]);
        }
        matchedPairs.length = 0;
        matchedPairs.push(...kept);
      }
      console.log(`[OCR 兜底] 列锚点 = ${columnAnchors.map(x => Math.round(x)).join(', ')}  列半径=${Math.round(COL_RADIUS)}  最大union宽=${Math.round(MAX_UNION_W)}  消化 ${consumedOrphans.size} 个孤立数字`);
    }

    // =====================================================================
    // 3.6 字典命中专用兜底：对"字典锚定 + 仍然 price===-1"的条目，
    //     直接在名字右侧最近的孤立数字里抓一个认领。
    //     动机：字典命中是高置信度信号（这是一条真实品名），几何上"同行 + 最近"
    //     的孤立数字几乎不会错。它解决的典型场景是：
    //       - 最右一列的品名（如"中支天叶"）nameRight 离列锚点太近，
    //         被 3.5 的 MIN_RIGHT_GAP 过滤掉；
    //       - OCR 把品名的 polygon 往右延伸，导致 nameRight 反超价格 xMin，
    //         3.5 的"必须严格在右侧"判定失败；
    //       - 3.A 向右 8 个兄弟块内恰好被别列的块插入，sameRow 判负。
    //     三轮尝试：strict(0.75字高) → loose(1.2字高) → aggressive(1.8字高 + 允许 opXc<nameRight)
    //     aggressive 阶段只在前两轮都失败时启用，专门救"最右列 / polygon 重叠" 场景。
    //     诊断：本阶段会把所有 dictMissing 条目的过滤轨迹保存到
    //     globalThis.__OCR_DICT_SALVAGE_DIAG__，便于 /api/ocr-debug 读取。
    // =====================================================================
    console.log('[OCR] >>> 进入 3.6 字典命中兜底阶段 (build tag: dict-salvage-v2)');
    {
      const dictMissing = matchedPairs.filter(
        (p) => p.price === -1 && p.dictHit && p.rawName !== '【孤立数字】'
      );
      const hAvgPairs = matchedPairs.reduce(
        (s, p) => s + (p.unionBounds.bottom - p.unionBounds.top),
        0
      ) / (matchedPairs.length || 1);
      const MAX_DX = origWidth * 0.22;

      const orphanIdxs: number[] = [];
      matchedPairs.forEach((p, idx) => {
        if (p.rawName === '【孤立数字】') orphanIdxs.push(idx);
      });

      console.log(`[OCR 字典兜底] 待处理 ${dictMissing.length} 条字典锚定缺价格 / 可用孤立数字 ${orphanIdxs.length} 条`);

      const salvageDiag: any[] = [];
      const consumed = new Set<number>();
      let claimed = 0;

      for (const pair of dictMissing) {
        const nameYc = (pair.unionBounds.top + pair.unionBounds.bottom) / 2;
        const nameXc = (pair.unionBounds.left + pair.unionBounds.right) / 2;
        const nameLeft = pair.unionBounds.left;
        const nameRight = pair.unionBounds.right;

        // 两轮尝试：strict → loose
        let bestK = -1;
        let bestDx = Number.POSITIVE_INFINITY;
        let phaseHit: 'strict' | 'loose' | null = null;

        // 记录每个 orphan 的判定过程，便于回看"为什么没命中"
        const attempts: any[] = [];

        for (const phase of ['strict', 'loose', 'aggressive'] as const) {
          const ROW_TOL =
            phase === 'strict' ? hAvgPairs * 0.75 :
            phase === 'loose' ? hAvgPairs * 1.2 :
            hAvgPairs * 1.8;
          // aggressive 阶段：允许 orphan 中心落在 nameLeft 右边即可（不再强制 dx>0）
          const allowLeftOfCenter = phase === 'aggressive';

          for (let k = 0; k < orphanIdxs.length; k++) {
            if (consumed.has(k)) continue;
            const op = matchedPairs[orphanIdxs[k]];
            const opYc = (op.unionBounds.top + op.unionBounds.bottom) / 2;
            const opXc = (op.unionBounds.left + op.unionBounds.right) / 2;
            const dy = Math.abs(opYc - nameYc);
            const dx = opXc - nameXc;

            const rej: string[] = [];
            if (dy > ROW_TOL) rej.push(`dy=${dy.toFixed(1)}>${ROW_TOL.toFixed(1)}`);
            // 必须保证 orphan 中心在 nameLeft 右边至少半字高（避免吞掉左邻列的数字）
            if (opXc <= nameLeft + hAvgPairs * 0.5) rej.push(`opXc<=nameLeft+半字高`);
            if (!allowLeftOfCenter && dx <= 0) rej.push(`dx<=0(不在名字中心右侧)`);
            if (dx > MAX_DX) rej.push(`dx=${dx.toFixed(0)}>${MAX_DX.toFixed(0)}`);

            if (phase === 'strict') {
              attempts.push({
                k,
                price: op.price,
                opXc: Math.round(opXc),
                opYc: Math.round(opYc),
                dy: +dy.toFixed(1),
                dx: +dx.toFixed(1),
                rej: rej.length ? rej.join(',') : 'OK',
              });
            }

            if (rej.length > 0) continue;

            // aggressive 阶段：优先选 dx 绝对值小的（允许负但靠近名字中心）
            const score = Math.abs(dx);
            if (score < bestDx) {
              bestDx = score;
              bestK = k;
              phaseHit = phase;
            }
          }

          if (bestK !== -1) break; // 本阶段命中就不再尝试更激进的阶段
        }

        const diagEntry: any = {
          name: pair.rawName,
          nameXc: Math.round(nameXc),
          nameYc: Math.round(nameYc),
          nameLeft: Math.round(nameLeft),
          nameRight: Math.round(nameRight),
          attemptedOrphans: attempts.length,
          topAttempts: attempts
            .slice()
            .sort((a, b) => Math.abs(a.dx) + a.dy - (Math.abs(b.dx) + b.dy))
            .slice(0, 6),
          hit: null as any,
        };

        if (bestK !== -1) {
          const op = matchedPairs[orphanIdxs[bestK]];
          pair.price = op.price;
          pair.unionBounds = {
            left: Math.min(pair.unionBounds.left, op.unionBounds.left),
            top: Math.min(pair.unionBounds.top, op.unionBounds.top),
            right: Math.max(pair.unionBounds.right, op.unionBounds.right),
            bottom: Math.max(pair.unionBounds.bottom, op.unionBounds.bottom),
          };
          consumed.add(bestK);
          claimed++;
          diagEntry.hit = { k: bestK, price: op.price, phase: phaseHit, dx: +bestDx.toFixed(1) };
        }
        salvageDiag.push(diagEntry);
      }

      // 移除被认领的孤立数字
      if (consumed.size > 0) {
        const toRemove = new Set<number>();
        consumed.forEach((k) => toRemove.add(orphanIdxs[k]));
        const kept: typeof matchedPairs = [];
        for (let i = 0; i < matchedPairs.length; i++) {
          if (!toRemove.has(i)) kept.push(matchedPairs[i]);
        }
        matchedPairs.length = 0;
        matchedPairs.push(...kept);
      }

      console.log(`[OCR 字典兜底] 认领 ${claimed} 个孤立数字（共 ${dictMissing.length} 条字典锚定缺价格）`);
      // 暴露诊断信息给 /api/ocr-debug
      (globalThis as any).__OCR_DICT_SALVAGE_DIAG__ = salvageDiag;

      // 如果仍然有字典命中缺价格，把最接近的候选信息压缩打印，方便 dev.log 直接看
      const stillMissing = salvageDiag.filter((d) => !d.hit);
      if (stillMissing.length > 0) {
        const top = stillMissing.slice(0, 12).map((d) => {
          const a0 = d.topAttempts[0];
          return `${d.name}(xc=${d.nameXc},yc=${d.nameYc})→最近orphan:${a0 ? `dx=${a0.dx},dy=${a0.dy},price=${a0.price},rej=${a0.rej}` : '无'}`;
        });
        console.log(`[OCR 字典兜底·未救回] ${top.join(' | ')}`);

        // 终极诊断：对仍然 missing 的每条，打印 y±2.5 字高 内的全部 orphan（price + 坐标）
        // 这能直接回答"价格数字到底有没有被 OCR 识别出来"。
        // 注意：此时 consumed 的孤立数字已经从 matchedPairs 里移除了，这里需要
        // 走新的 allOrphansNow 扫描（而不是旧的 orphanIdxs 映射，避免索引失效）。
        const Y_BAND = hAvgPairs * 2.5;
        const allOrphansNow = matchedPairs
          .filter((p) => p.rawName === '【孤立数字】')
          .map((p) => ({
            price: p.price,
            xc: Math.round((p.unionBounds.left + p.unionBounds.right) / 2),
            yc: Math.round((p.unionBounds.top + p.unionBounds.bottom) / 2),
            xMin: Math.round(p.unionBounds.left),
            xMax: Math.round(p.unionBounds.right),
          }));
        for (const d of stillMissing.slice(0, 8)) {
          const near = allOrphansNow
            .filter((o) => Math.abs(o.yc - d.nameYc) <= Y_BAND)
            .sort((a, b) => Math.abs(a.yc - d.nameYc) - Math.abs(b.yc - d.nameYc));
          console.log(`  [同行orphan扫描] "${d.name}" yc=${d.nameYc}(±${Math.round(Y_BAND)}) → ${
            near.length === 0 ? '无' : near.slice(0, 6).map((o) => `price=${o.price}@xc=${o.xc},yc=${o.yc}`).join(' | ')
          }`);
        }
      }
    }

    // =====================================================================
    // 4. 切图与最终展示排版
    // =====================================================================
    {
      const total = matchedPairs.length;
      const missing = matchedPairs.filter(p => p.price === -1).length;
      const orphan = matchedPairs.filter(p => p.rawName === '【孤立数字】').length;
      const dictConfirmed = matchedPairs.filter(p => p.dictHit).length;
      const corrected = matchedPairs.filter(p => p.isCorrected).length;
      console.log(`[OCR 配对汇总] 总条目 ${total}  字典锚定 ${dictConfirmed}  自动纠错 ${corrected}  缺价格 ${missing}  残留孤立数字 ${orphan}`);
      if (missing > 0) {
        const missingNames = matchedPairs
          .filter(p => p.price === -1 && p.rawName !== '【孤立数字】')
          .map(p => `${p.rawName}${p.dictHit ? '[字典]' : ''}(x=${Math.round((p.unionBounds.left + p.unionBounds.right) / 2)},y=${Math.round((p.unionBounds.top + p.unionBounds.bottom) / 2)})`)
          .slice(0, 30);
        console.log(`[OCR 缺价格明细] ${missingNames.join(' | ')}`);
      }

      // 诊断：把所有 missing 的"邻近孤立数字候选"一次性导出到 globalThis，供调试路由读取
      // 对每个 missing 的 name，找：
      //   a) 它的 bounds；
      //   b) 全局所有 rawName='【孤立数字】' 的 pair 中，与它"满足几何可能同行"
      //      （y 差 < 2 * 字高 且 x 在名字右侧 < MAX_X_DISTANCE）的候选；
      //   c) 还附带所有 price !== -1 的 pair 里 y 同行（±1.5 字高）的名字项，
      //      用来判断"是不是邻行把我的价格偷走了"。
      const hAvg = (globalThis as any).__OCR_H_AVG__ || 22;
      const missingPairs = matchedPairs.filter(p => p.price === -1 && p.rawName !== '【孤立数字】');
      const orphanPairs = matchedPairs.filter(p => p.rawName === '【孤立数字】');
      const allMatchedByY = matchedPairs.map(p => ({
        name: p.rawName,
        price: p.price,
        yc: (p.unionBounds.top + p.unionBounds.bottom) / 2,
        xMin: p.unionBounds.left,
        xMax: p.unionBounds.right,
      }));
      const missingDump = missingPairs.map((p) => {
        const yc = (p.unionBounds.top + p.unionBounds.bottom) / 2;
        const xRight = p.unionBounds.right;
        const nearOrphan = orphanPairs
          .map((op) => ({
            price: op.price,
            yc: (op.unionBounds.top + op.unionBounds.bottom) / 2,
            xMin: op.unionBounds.left,
            xMax: op.unionBounds.right,
          }))
          .filter((o) => Math.abs(o.yc - yc) <= hAvg * 2.5 && o.xMin > xRight - hAvg && o.xMin - xRight < origWidth * 0.2)
          .sort((a, b) => Math.abs(a.yc - yc) - Math.abs(b.yc - yc));
        // 同行（±1.5 字高）已配对的名字 — 检查是否被它们"偷走"
        const sameRowNeighbors = allMatchedByY
          .filter((n) => n.name !== p.rawName && Math.abs(n.yc - yc) <= hAvg * 1.5)
          .sort((a, b) => a.xMin - b.xMin);
        return {
          name: p.rawName,
          dictHit: !!p.dictHit,
          bounds: p.unionBounds,
          yc: Math.round(yc),
          nearOrphan: nearOrphan.slice(0, 5),
          sameRowNeighbors: sameRowNeighbors.slice(0, 10),
        };
      });
      (globalThis as any).__OCR_MISSING_DUMP__ = missingDump;
    }

    // =====================================================================
    // 3.7 二次局部 OCR 补救：对字典命中但仍缺价格的条目，crop 出名字右侧区域
    //     单独做一次 OCR，尝试识别被主 OCR 遗漏的价格数字。
    //     典型案例：「中支天叶」右侧的 971 在全图 OCR 时完全未被识别到。
    //     策略：取名字 bounds 右侧 → 右侧 + origWidth*0.12 的区域，上下扩展半行高，
    //     crop 成小图后走同一引擎识别，提取纯数字。
    //     为避免额外延时，仅对字典锚定的 missing 条目做，且并行执行。
    // =====================================================================
    {
      const dictMissingForRetry = matchedPairs.filter(
        (p) => p.price === -1 && p.rawName !== '【孤立数字】'
      );
      if (dictMissingForRetry.length > 0 && dictMissingForRetry.length <= 15) {
        console.log(`[OCR 二次补救] 对 ${dictMissingForRetry.length} 条缺价格执行局部 OCR`);
        const hAvgRetry = matchedPairs.reduce(
          (s, p) => s + (p.unionBounds.bottom - p.unionBounds.top), 0
        ) / (matchedPairs.length || 1);
        const cropWidth = Math.round(origWidth * 0.12);
        const padY = Math.round(hAvgRetry * 0.3);

        const retryResults = await Promise.allSettled(
          dictMissingForRetry.map(async (pair) => {
            const cropLeft = Math.max(0, pair.unionBounds.right - 2);
            const cropTop = Math.max(0, pair.unionBounds.top - padY);
            const cropRight = Math.min(origWidth, pair.unionBounds.right + cropWidth);
            const cropBottom = Math.min(origHeight, pair.unionBounds.bottom + padY);
            const w = cropRight - cropLeft;
            const h = cropBottom - cropTop;
            if (w <= 5 || h <= 5) return null;

            try {
              const cropBuf = await sharp(originalPath)
                .extract({ left: cropLeft, top: cropTop, width: w, height: h })
                .jpeg({ quality: 90 })
                .toBuffer();

              // 写临时文件
              const tmpCrop = path.join(os.tmpdir(), `retry_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.jpg`);
              await fs.writeFile(tmpCrop, cropBuf);

              let subResult;
              if (engine === 'tencent') {
                subResult = await runTencentOcr({ type: 'file', payload: tmpCrop });
              } else {
                subResult = await runAliyunOcr({ type: 'file', payload: tmpCrop });
              }
              await fs.unlink(tmpCrop).catch(() => {});

              // 从二次 OCR 结果中提取纯数字
              const blocks = subResult?.blockInfo?.blockDetails || [];
              for (const b of blocks) {
                const txt = (b.blockContent || '').replace(/[¥,元\s]/g, '').trim();
                const m = txt.match(/^(\d+(?:\.\d+)?)$/);
                if (m) {
                  const val = parseFloat(m[1]);
                  if (val >= 1 && val <= 9999) {
                    console.log(`[OCR 二次补救] "${pair.rawName}" 局部 OCR 识别到价格 ${val}`);
                    return { pair, price: val, cropLeft, cropTop, cropRight, cropBottom };
                  }
                }
              }
              // 也尝试 blockContent 里含"名字+数字"的粘连
              for (const b of blocks) {
                const txt = (b.blockContent || '').trim();
                const m2 = txt.match(/(\d+(?:\.\d+)?)\s*$/);
                if (m2) {
                  const val = parseFloat(m2[1]);
                  if (val >= 10 && val <= 9999) {
                    console.log(`[OCR 二次补救] "${pair.rawName}" 局部 OCR 粘连提取价格 ${val}`);
                    return { pair, price: val, cropLeft, cropTop, cropRight, cropBottom };
                  }
                }
              }
              console.log(`[OCR 二次补救] "${pair.rawName}" 局部 OCR 未识别到数字, blocks=${blocks.map((b: any) => b.blockContent).join('|')}`);
              return null;
            } catch (e: any) {
              console.log(`[OCR 二次补救] "${pair.rawName}" 异常: ${e.message}`);
              return null;
            }
          })
        );

        let retryCount = 0;
        for (const r of retryResults) {
          if (r.status === 'fulfilled' && r.value) {
            const { pair, price, cropLeft, cropTop, cropRight, cropBottom } = r.value;
            pair.price = price;
            // 扩展 unionBounds 包含价格区域
            pair.unionBounds = {
              left: Math.min(pair.unionBounds.left, cropLeft),
              top: Math.min(pair.unionBounds.top, cropTop),
              right: Math.max(pair.unionBounds.right, cropRight),
              bottom: Math.max(pair.unionBounds.bottom, cropBottom),
            };
            retryCount++;
          }
        }
        console.log(`[OCR 二次补救] 成功补回 ${retryCount} 条价格`);
      }
    }

    // =====================================================================
    // 3.8 品名重复修正：对"同一品名重复出现"的条目，做局部 crop 二次 OCR，
    //     重新识别真实品名。应对场景：OCR 把多行不同品名（如"细蓝闪带王"）
    //     误识为同一文本（如"细支品悦王"），导致多行品名完全相同。
    //     策略：
    //       1. 找到出现次数 >= 2 的 rawName（只考虑字典命中的，避免误报）；
    //       2. 对每个重复实例的 unionBounds 左半部分（品名区域）做 crop + 二次 OCR；
    //       3. 若二次 OCR 返回的文本与原始 rawName 有显著差异（编辑距离 >= 2），
    //          用新识别的文本替换，并重新走字典纠错。
    //     仅对字典命中的条目做，避免对"孤立数字"等噪声项处理。
    //     控制代价：重复出现次数上限设为 6，超过不处理（避免大量无意义 OCR 调用）。
    // =====================================================================
    {
      const nameCount = new Map<string, number>();
      for (const p of matchedPairs) {
        if (p.rawName === '【孤立数字】') continue;
        if (!p.dictHit) continue;
        nameCount.set(p.rawName, (nameCount.get(p.rawName) || 0) + 1);
      }
      const duplicateNames = Array.from(nameCount.entries())
        .filter(([, cnt]) => cnt >= 2 && cnt <= 6)
        .map(([name]) => name);

      if (duplicateNames.length > 0) {
        console.log(`[OCR 品名重复修正] 发现重复品名 ${duplicateNames.length} 个: ${duplicateNames.join(', ')}`);

        // 收集所有重复实例（同一 rawName 的全部 pair）
        const duplicatePairs = matchedPairs.filter(
          (p) => duplicateNames.includes(p.rawName) && p.rawName !== '【孤立数字】'
        );

        // 对每个实例做品名区域 crop + 二次 OCR
        const nameRetryResults = await Promise.allSettled(
          duplicatePairs.map(async (pair) => {
            // 切品名区域：取 unionBounds 的左半部分（最多到中点 - 小偏移）
            const leftX = pair.unionBounds.left;
            const rightX = pair.unionBounds.right;
            const midX = (leftX + rightX) / 2;
            const boundsH = Math.max(12, pair.unionBounds.bottom - pair.unionBounds.top);
            // 向左多扩 1.5 倍字高，防止 OCR polygon 漏掉"95"/"细支"等前缀
            const PAD_LEFT_NAME = Math.round(boundsH * 1.5);
            const cropLeft = Math.max(0, leftX - PAD_LEFT_NAME);
            const cropTop = Math.max(0, pair.unionBounds.top - 2);
            // 品名区域：左侧到 midX（如果 price 占右半，通常右半是价格）
            // 为保险起见，往右多扩一点（品名可能占超过一半）
            const cropRight = Math.min(origWidth, Math.round(midX + (rightX - leftX) * 0.15));
            const cropBottom = Math.min(origHeight, pair.unionBounds.bottom + 2);
            const w = cropRight - cropLeft;
            const h = cropBottom - cropTop;
            if (w <= 10 || h <= 10) return null;

            try {
              const cropBuf = await sharp(originalPath)
                .extract({ left: cropLeft, top: cropTop, width: w, height: h })
                .jpeg({ quality: 95 })
                .toBuffer();
              const tmpCrop = path.join(os.tmpdir(), `name_retry_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.jpg`);
              await fs.writeFile(tmpCrop, cropBuf);

              let subResult;
              if (engine === 'tencent') {
                subResult = await runTencentOcr({ type: 'file', payload: tmpCrop });
              } else {
                subResult = await runAliyunOcr({ type: 'file', payload: tmpCrop });
              }
              await fs.unlink(tmpCrop).catch(() => {});

              // 从二次 OCR 结果里提取品名文本（取最长的非数字 block）
              const blocks = subResult?.blockInfo?.blockDetails || [];
              let bestName = '';
              for (const b of blocks) {
                const txt = (b.blockContent || '').trim();
                // 排除纯数字
                if (!txt || /^\d+(\.\d+)?$/.test(txt)) continue;
                // 取最长的汉字/字母文本
                if (txt.length > bestName.length && /[\u4e00-\u9fa5A-Za-z]/.test(txt)) {
                  bestName = txt;
                }
              }
              return { pair, newName: bestName };
            } catch (e: any) {
              console.log(`[OCR 品名重复修正] "${pair.rawName}" 异常: ${e.message}`);
              return null;
            }
          })
        );

        let fixedCount = 0;
        for (const r of nameRetryResults) {
          if (r.status !== 'fulfilled' || !r.value) continue;
          const { pair, newName } = r.value;
          if (!newName || newName === pair.rawName) continue;

          // 【已禁用字典纠错】完全相信二次 OCR 的原文
          const finalName = newName;

          // 安全守卫 1：新名字必须"不短于"原名字（避免 "95南京" 被截成 "南京"）
          //   —— 二次 OCR 的局部图若 crop 不完整，会丢失左侧前缀（如"95"/"细支"），
          //   造成误替换，所以只接受"至少和原名一样长"的替换。
          if (newName.length < pair.rawName.length) {
            console.log(`[OCR 品名重复修正] 拒绝替换："${pair.rawName}"(${pair.rawName.length}) > "${newName}"(${newName.length}) 新名过短，可能是 crop 丢前缀`);
            continue;
          }

          // 安全守卫 2：新名字若完全是原名字的后缀（如 "南京" 是 "95南京" 的后缀），
          //   说明只是前缀被截掉了，不替换。
          if (pair.rawName.endsWith(newName) && pair.rawName !== newName) {
            console.log(`[OCR 品名重复修正] 拒绝替换："${pair.rawName}" → "${newName}" 新名是原名后缀`);
            continue;
          }

          // 只有当新名字与原名字不同时才替换
          if (finalName !== pair.rawName && finalName !== pair.correctedName) {
            console.log(`[OCR 品名重复修正] "${pair.rawName}" → "${finalName}" (原始二次OCR: "${newName}")`);
            pair.rawName = newName;
            pair.correctedName = finalName;
            pair.isCorrected = false;
            fixedCount++;
          }
        }
        console.log(`[OCR 品名重复修正] 成功修正 ${fixedCount} 条品名`);
      }
    }

    // =====================================================================
    // 3.9 切图扩展：对"价格缺失"的 pair，把右侧同一行/同一列的那一格也框进切图。
    //     按优先级多层兜底：
    //       a)  非数字标记（如 "停"/"?"/"/" 这类状态字）
    //       a2) 未被认领的孤立数字（如 OCR 识别到了 971 但没配上）
    //       b)  同行其它已配对价格的 right 作为列锚参考
    //       c)  用已配对 pair 平均宽度硬扩一小段
    //     仅影响 unionBounds（切图范围），不影响 price/名字等字段。
    //     为防止阈值太严导致补不上，本阶段的 ROW_TOL 比 3.5 阶段宽松许多。
    // =====================================================================
    {
      const hAvgAll = matchedPairs.length > 0
        ? matchedPairs.reduce((s, p) => s + (p.unionBounds.bottom - p.unionBounds.top), 0) / matchedPairs.length
        : 22;
      // 补切图的容差放得很宽：上下约 1.4 字高。因为只是"把右边那格框进来"，错框到邻行影响小。
      const ROW_TOL = hAvgAll * 1.4;
      // 右侧寻找距离：放宽到 35%，覆盖中低分辨率图的长条排版
      const MAX_RIGHT_DIST = origWidth * 0.35;
      const consumedMarkers = new Set<number>();

      // 收集所有"有价格"的 pair 的几何
      const pricedRefs = matchedPairs
        .filter((p) => p.price !== -1 && p.rawName !== '【孤立数字】')
        .map((p) => ({
          yc: (p.unionBounds.top + p.unionBounds.bottom) / 2,
          left: p.unionBounds.left,
          right: p.unionBounds.right,
        }));

      const expandDiag: any[] = [];

      for (const pair of matchedPairs) {
        if (pair.price !== -1) continue;
        if (pair.rawName === '【孤立数字】') continue;

        const yc = (pair.unionBounds.top + pair.unionBounds.bottom) / 2;
        const xRight = pair.unionBounds.right;
        const oldBounds = { ...pair.unionBounds };
        const diag: any = {
          name: pair.rawName,
          yc: Math.round(yc),
          xRight,
          hit: null as string | null,
          detail: null as any,
        };

        // --- a) 非数字标记 ---
        let bestIdx = -1;
        let bestDx = Infinity;
        for (let k = 0; k < nonPriceMarkers.length; k++) {
          if (consumedMarkers.has(k)) continue;
          const m = nonPriceMarkers[k];
          const myc = (m.yMin + m.yMax) / 2;
          if (Math.abs(myc - yc) > ROW_TOL) continue;
          if (m.xMin < xRight) continue;
          const dx = m.xMin - xRight;
          if (dx > MAX_RIGHT_DIST) continue;
          if (dx < bestDx) { bestDx = dx; bestIdx = k; }
        }
        if (bestIdx !== -1) {
          const m = nonPriceMarkers[bestIdx];
          pair.unionBounds = {
            left: pair.unionBounds.left,
            top: Math.min(pair.unionBounds.top, m.yMin),
            right: Math.max(pair.unionBounds.right, m.xMax),
            bottom: Math.max(pair.unionBounds.bottom, m.yMax),
          };
          consumedMarkers.add(bestIdx);
          diag.hit = 'a-marker';
          diag.detail = { text: m.text, dx: Math.round(bestDx), xMax: m.xMax };
          expandDiag.push(diag);
          continue;
        }

        // --- a2) 未被认领的孤立数字 ---
        let bestOrphan: typeof matchedPairs[number] | null = null;
        let bestOrphanDx = Infinity;
        let orphanRejCount = 0;
        for (const op of matchedPairs) {
          if (op.rawName !== '【孤立数字】') continue;
          const opyc = (op.unionBounds.top + op.unionBounds.bottom) / 2;
          const dy = Math.abs(opyc - yc);
          if (dy > ROW_TOL) { orphanRejCount++; continue; }
          if (op.unionBounds.left < xRight) { orphanRejCount++; continue; }
          const dx = op.unionBounds.left - xRight;
          if (dx > MAX_RIGHT_DIST) { orphanRejCount++; continue; }
          if (dx < bestOrphanDx) { bestOrphanDx = dx; bestOrphan = op; }
        }
        if (bestOrphan) {
          pair.unionBounds = {
            left: pair.unionBounds.left,
            top: Math.min(pair.unionBounds.top, bestOrphan.unionBounds.top),
            right: Math.max(pair.unionBounds.right, bestOrphan.unionBounds.right),
            bottom: Math.max(pair.unionBounds.bottom, bestOrphan.unionBounds.bottom),
          };
          diag.hit = 'a2-orphan';
          diag.detail = { price: bestOrphan.price, dx: Math.round(bestOrphanDx) };
          expandDiag.push(diag);
          continue;
        }

        // --- b) 同行已配对价格的 right 作为参考 ---
        let targetRight = -1;
        for (const ref of pricedRefs) {
          if (Math.abs(ref.yc - yc) > hAvgAll * 1.5) continue;
          if (ref.right <= xRight) continue;
          if (targetRight === -1 || ref.right < targetRight) targetRight = ref.right;
        }

        let hitLabel = 'b-sameRow';
        if (targetRight === -1) {
          // --- c) 平均宽度硬扩 ---
          if (pricedRefs.length > 0) {
            const avgHalf = pricedRefs.reduce((s, r) => s + (r.right - r.left), 0) / pricedRefs.length / 2;
            targetRight = Math.min(origWidth - 1, xRight + Math.max(avgHalf, origWidth * 0.06));
            hitLabel = 'c-avgWidth';
          } else {
            targetRight = Math.min(origWidth - 1, xRight + origWidth * 0.08);
            hitLabel = 'c-fallback';
          }
        }

        // 限幅：仅对 b/c（没有具体目标块）生效，防止无限扩张。
        // 放宽到 55%，覆盖"名字本身很窄 + 价格列在右侧 40% 位置"的情况。
        const MAX_TOTAL_W = origWidth * 0.55;
        const newRight = Math.min(targetRight, pair.unionBounds.left + MAX_TOTAL_W);
        if (newRight > pair.unionBounds.right) {
          pair.unionBounds = {
            left: pair.unionBounds.left,
            top: pair.unionBounds.top,
            right: newRight,
            bottom: pair.unionBounds.bottom,
          };
          diag.hit = hitLabel;
          diag.detail = { targetRight: Math.round(targetRight), newRight: Math.round(newRight), orphanRej: orphanRejCount };
        } else {
          diag.hit = 'none';
          diag.detail = { reason: '所有扩展分支都没有产生更大的 right', orphanRej: orphanRejCount, oldBounds };
          console.warn(`[OCR 切图扩展] "${pair.rawName}" 未能扩展右侧 (yc=${Math.round(yc)}, xRight=${xRight})`);
        }
        expandDiag.push(diag);
      }

      if (expandDiag.length > 0) {
        console.log(`[OCR 切图扩展] 处理 ${expandDiag.length} 条缺价格行: ` +
          expandDiag.map((d) => `${d.name}→${d.hit}`).join(' | '));
        (globalThis as any).__OCR_EXPAND_DIAG__ = expandDiag;
      }
    }

    const finalItems = await Promise.all(
      matchedPairs.map(async (pair) => {
        const cropDataUri = await generateCrop(originalPath, pair.unionBounds, origWidth, origHeight);

        // 【已禁用字典纠错】完全相信 OCR 原文，直接用 rawName 作为最终展示名字
        // 注：pair.correctedName / pair.isCorrected 在配对阶段仍用于字典锚点判定，
        //     但这里不再参与最终展示，保证用户看到的是原始 OCR 文本。
        const finalName = pair.rawName;
        const isCorrected = false;
        // if (pair.correctedName) {
        //   finalName = pair.correctedName;
        // } else if (pair.rawName && pair.rawName !== '【孤立数字】') {
        //   const res = correctCigaretteName(pair.rawName);
        //   if (res.confidence === 'high' || res.confidence === 'medium') {
        //     finalName = res.corrected;
        //     isCorrected = res.isModified;
        //   }
        // }

        return {
          originalName: pair.rawName,
          name: finalName,
          price: pair.price,
          confidence: pair.dictHit ? '1.0' : '0.6',
          isCorrected,
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
  // 切图 padding：
  //   - 左侧：扩展较多（PAD_LEFT），因为 OCR polygon 经常漏掉品名前缀
  //     （如"细支"/"软"/"中支"等常被裁掉）；
  //   - 右侧：保守（PAD_RIGHT_SMALL），避免吞进相邻列；
  //   - 上下：稍扩一行高的一小部分，避免切到字形上下沿。
  const PAD_LEFT = Math.round(imgWidth * 0.025);   // ~2.5% 图宽
  const PAD_RIGHT = Math.round(imgWidth * 0.008);  // ~0.8% 图宽
  const boundsH = Math.max(8, bounds.bottom - bounds.top);
  const PAD_V = Math.round(boundsH * 0.2);         // ~20% 行高

  const cropLeft = Math.max(0, bounds.left - PAD_LEFT);
  const cropTop = Math.max(0, bounds.top - PAD_V);
  const cropRight = Math.min(imgWidth, bounds.right + PAD_RIGHT);
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
  } catch (e: any) {
    console.log(`[OCR 切图异常]`, bounds, e.message);
    return undefined;
  }
}
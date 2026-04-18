import * as tencentcloud from "tencentcloud-sdk-nodejs";
import fs from 'fs/promises';

const OcrClient = tencentcloud.ocr.v20181119.Client;

/**
 * 将 OCR 的"看起来像价格/断货符"的脏字符规范化。
 *
 * 我们在这里仅做"价格 token"级别的归一，避免错误替换到品名中的合法字符。
 * 所以归一只用于：
 *   1) 判断某行的"尾 token"是不是价格/断货；
 *   2) 在 splitNameAndPrice 时提取尾 token；
 * 它不会覆盖整段文本。
 */
const normalizePriceToken = (s: string): string => {
  return s
    // 全角字符替换
    .replace(/[：]/g, ':')
    .replace(/[，]/g, ',')
    .replace(/[／]/g, '/')
    // OCR 常把断货 "//" 识别为以下几种，统一归并成 "//"
    .replace(/^[\|｜│┃丨I l]{2,}$/, '//')
    .replace(/^[\\]{2,}$/, '//')
    .replace(/^÷+$/, '//')
    .replace(/^:{2,}$/, '//')
    .trim();
};

export async function runTencentOcr(source: { type: 'url' | 'file', payload: string }): Promise<any> {
  if (!process.env.TENCENT_SECRET_ID || !process.env.TENCENT_SECRET_KEY) {
    throw new Error("配置缺失: 未读取到腾讯云密钥，请检查 .env 文件");
  }

  // 走香港同城节点，保证速度
  const clientConfig = {
    credential: {
      secretId: process.env.TENCENT_SECRET_ID,
      secretKey: process.env.TENCENT_SECRET_KEY,
    },
    region: "ap-hongkong", 
    profile: {
      httpProfile: {
        endpoint: "ocr.ap-hongkong.tencentcloudapi.com",
        reqTimeout: 60000, 
      },
    },
  };
  const client = new OcrClient(clientConfig);

  const params: any = {};
  
  if (source.type === 'url') {
    params.ImageUrl = source.payload;
  } else {
    const buffer = await fs.readFile(source.payload);
    params.ImageBase64 = buffer.toString('base64');
  }

  try {
    // 调用最新的通用文字识别（高精度版）
    const response = await client.GeneralAccurateOCR(params);
    
    if (!response.TextDetections || response.TextDetections.length === 0) {
        throw new Error("腾讯云未识别到有效的文本内容");
    }

    // ==========================================
    // 诊断日志：打印 OCR 原始文本条数
    // ==========================================
    console.log(`[腾讯云 OCR] 原始 TextDetections 数量 = ${response.TextDetections.length}`);

    // 诊断：找出所有包含"971"或"天叶"或"品悦"或"闪带"或"276"或"南京"或"至尊"/"鸿运"/"宽窄"/"商鼎"/"新版"/"163"的原始 TextDetection
    for (const item of response.TextDetections as any[]) {
      const t = item.DetectedText || '';
      if (t.includes('971') || t.includes('天叶') || t.includes('品悦') || t.includes('闪带') || t.includes('276') || t.includes('玉溪') || t.includes('南京') || t.includes('至尊') || t.includes('鸿运') || t.includes('宽窄') || t.includes('131') || t.includes('204') || t.includes('商鼎') || t.includes('新版') || t.includes('163') || t.includes('1045') || t.includes('3克细')) {
        const pts = (item.Polygon || []).map((p: any) => ({ x: p.X, y: p.Y }));
        const xs = pts.map((p: any) => p.x);
        const ys = pts.map((p: any) => p.y);
        console.log(`[OCR 原始块诊断] text="${t}" x=${Math.min(...xs)}..${Math.max(...xs)} y=${Math.min(...ys)}..${Math.max(...ys)}`);
      }
    }

    // 诊断：收集命中调试关键字的原始块及其同行块，后续放进返回值里
    const DEBUG_KW = process.env.OCR_DEBUG_KEYWORD || (globalThis as any).__OCR_DEBUG_KEYWORD__;
    const debugDump: any[] = [];
    if (DEBUG_KW) {
      const items = response.TextDetections as any[];
      const hits = items
        .map((it, idx) => ({ it, idx }))
        .filter(({ it }) => (it.DetectedText || '').includes(DEBUG_KW));
      for (const { it, idx } of hits) {
        const pts = (it.Polygon || []).map((p: any) => ({ x: p.X, y: p.Y }));
        if (pts.length < 4) continue;
        const minX = Math.min(...pts.map((p: any) => p.x));
        const maxX = Math.max(...pts.map((p: any) => p.x));
        const minY = Math.min(...pts.map((p: any) => p.y));
        const maxY = Math.max(...pts.map((p: any) => p.y));
        const yc = (minY + maxY) / 2;
        const h = Math.max(1, maxY - minY);

        const sameRowItems = items
          .filter((it2) => {
            const p2 = (it2.Polygon || []).map((p: any) => ({ x: p.X, y: p.Y }));
            if (p2.length < 4) return false;
            const yy = (Math.min(...p2.map((p: any) => p.y)) + Math.max(...p2.map((p: any) => p.y))) / 2;
            return Math.abs(yy - yc) <= h * 1.5;
          })
          .map((it2) => {
            const p2 = (it2.Polygon || []).map((p: any) => ({ x: p.X, y: p.Y }));
            const xMin = Math.min(...p2.map((p: any) => p.x));
            const xMax = Math.max(...p2.map((p: any) => p.x));
            const yMin = Math.min(...p2.map((p: any) => p.y));
            const yMax = Math.max(...p2.map((p: any) => p.y));
            return { text: it2.DetectedText, xMin, xMax, yMin, yMax };
          })
          .sort((a, b) => a.xMin - b.xMin);

        debugDump.push({
          idx,
          hit: { text: it.DetectedText, xMin: minX, xMax: maxX, yMin: minY, yMax: maxY, yc: Math.round(yc) },
          sameRow: sameRowItems,
        });
        console.log(`[DEBUG] 命中 "${DEBUG_KW}" @ idx=${idx}: "${it.DetectedText}", 同行 ${sameRowItems.length} 块`);
      }
      // 把调试数据塞到全局，供 ocr.ts 回传
      (globalThis as any).__OCR_DEBUG_DUMP__ = debugDump;
    } else {
      (globalThis as any).__OCR_DEBUG_DUMP__ = null;
    }


    // 物理坐标转换适配器
    const fakeBlocks: any[] = [];

    // 把一行 "名字 + 大空格 + 价格/断货符" 这种复合文本，切成独立的名字块和价格块。
    // 切分规则（按优先级）：
    //   1) 多空格(>=2) 或 制表符 作为间隔，且右侧是纯数字/价格/断货符
    //   2) 单空格 + 右侧是纯数字/价格/断货符
    //   3) 没有空格，但结尾紧贴数字（字母/汉字 + 数字）
    // 切分后按文本字符数线性估算 X 范围。
    //
    // 注意 PRICE_ATOM 扩大了断货符的容忍度，涵盖 OCR 常见误识：
    //   - "//" / "///" / "/ /"   —— 标准断货符与其变形
    //   - "||" / "｜｜" / "III"   —— 竖线/罗马一/字母 I 组合
    //   - "÷" / "::" / "\\"      —— 其它常见错识
    // 这些脏符都会在后端 isPrice/parsePrice 处被识别为 -1（缺货）。
    const PRICE_ATOM = String.raw`(?:\d+(?:\.\d+)?|\/\/+|\/+\s*\/+|\|{2,}|｜{2,}|I{2,}|[Il]{2,}|÷+|:{2,}|\\{2,})`;

    // doc 组扫描版表格里，每条价格后面常跟装饰性文字 "点烫"，OCR 会把它粘在前/后：
    //   形式 A:  "171点烫"             -> 纯价格 171，"点烫" 丢弃
    //   形式 B:  "1230点烫大峡谷情"     -> 价格 1230 + 名字 "大峡谷情"
    //   形式 C:  "点烫视窗"             -> "点烫" 丢弃，保留 "视窗"（价格在别处）
    //   形式 D:  "点烫"                 -> 纯噪声，丢弃
    // 统一先剥离 "点烫" 二字。
    const STRIP_DIANTANG = (s: string): string => {
        // 删除所有出现的 "点烫"（不区分位置）
        return s.replace(/点烫/g, '').trim();
    };

    const splitNameAndPrice = (line: string): { name: string; price: string; gapRatio: number; priceLeft?: boolean } | null => {
        // 预处理：把 "点烫" 剥掉再做后续切分
        const cleaned = STRIP_DIANTANG(line);
        if (!cleaned) return null;

        // 规则 0a：剥掉 "点烫" 后是"数字+汉字"（如 "1230大峡谷情"），
        //         只有确实剥过 "点烫" 才生效，避免把 "1906喜" 这种品牌误拆。
        //         注意：价格在左、品名在右 → priceLeft=true
        if (cleaned !== line) {
            const reDT = /^(\d+(?:\.\d+)?)([\u4e00-\u9fa5][\u4e00-\u9fa5A-Za-z0-9]+)$/;
            const mDT = cleaned.match(reDT);
            if (mDT) {
                const priceNum = parseFloat(mDT[1]);
                if (priceNum >= 20 && priceNum <= 9999) {
                    const total = mDT[1].length + mDT[2].length;
                    return {
                        name: mDT[2].trim(),
                        price: normalizePriceToken(mDT[1]),
                        gapRatio: Math.max(0.15, mDT[1].length / total),
                        priceLeft: true,
                    };
                }
            }
        }

        // 规则 0b：cam 图上常见的 "带小数点价格 + 汉字品名" 粘连
        //         例子："119.5中支银灰狼"、"132.5玫瑰2代钻石"
        //         小数点是烟价的可靠锚点（烟品牌名几乎不含裸小数点），所以限定
        //         "数字.数字 + 汉字" 才切，安全。
        //         注意：价格在左、品名在右 → priceLeft=true
        const reDecimalSplit = /^(\d+\.\d+)([\u4e00-\u9fa5][\u4e00-\u9fa5A-Za-z0-9]+)$/;
        const mDec = cleaned.match(reDecimalSplit);
        if (mDec) {
            const priceNum = parseFloat(mDec[1]);
            if (priceNum >= 20 && priceNum <= 9999) {
                const total = mDec[1].length + mDec[2].length;
                return {
                    name: mDec[2].trim(),
                    price: normalizePriceToken(mDec[1]),
                    gapRatio: Math.max(0.15, mDec[1].length / total),
                    priceLeft: true,
                };
            }
        }

        // 规则 0c："价格 + 空格 + 汉字品名" 粘连（OCR 把左列价格和右列品名识别到同一块）
        //         例子："308.5 中人民大会堂"、"126.5 中支长安印象"、"425 王者荣耀"
        //         这是跨列粘连 —— 价格属于左列末尾，品名是右列开头，需要拆开。
        //         注意：价格在左、品名在右 → priceLeft=true
        const reSpaceSplit = /^(\d+(?:\.\d+)?)\s+([\u4e00-\u9fa5][\u4e00-\u9fa5A-Za-z0-9]+)$/;
        const mSp = cleaned.match(reSpaceSplit);
        if (mSp) {
            const priceNum = parseFloat(mSp[1]);
            // 要求价格 >= 50（烟价几乎都 >= 60），避免把"3 克细..."/"5 年"这种误拆
            if (priceNum >= 50 && priceNum <= 9999) {
                const total = mSp[1].length + mSp[2].length + 1; // +1 for space
                return {
                    name: mSp[2].trim(),
                    price: normalizePriceToken(mSp[1]),
                    gapRatio: Math.max(0.15, mSp[1].length / total),
                    priceLeft: true,
                };
            }
        }

        // 规则 1：多空格
        const re1 = new RegExp(`^(.+?)(\\s{2,}|\\t+)(${PRICE_ATOM})\\s*$`);
        const m1 = cleaned.match(re1);
        if (m1) {
            const total = cleaned.length;
            return {
                name: m1[1].trim(),
                price: normalizePriceToken(m1[3].trim()),
                gapRatio: (m1[1].length + m1[2].length / 2) / total,
            };
        }
        // 规则 2：单空格
        const re2 = new RegExp(`^(.+?[\\u4e00-\\u9fa5A-Za-z\\)\\]])\\s+(${PRICE_ATOM})\\s*$`);
        const m2 = cleaned.match(re2);
        if (m2) {
            const total = cleaned.length;
            return {
                name: m2[1].trim(),
                price: normalizePriceToken(m2[2].trim()),
                gapRatio: (m2[1].length + 0.5) / total,
            };
        }
        // 规则 3：无空格紧贴（如 "合1906喜147"）
        const re3 = new RegExp(`^(.+?[\\u4e00-\\u9fa5A-Za-z\\)\\]])(${PRICE_ATOM})\\s*$`);
        const m3 = cleaned.match(re3);
        if (m3) {
            const total = m3[1].length + m3[2].length;
            return {
                name: m3[1].trim(),
                price: normalizePriceToken(m3[2].trim()),
                gapRatio: m3[1].length / total,
            };
        }
        return null;
    };

    // 把一行的整体 polygon 根据 gapRatio 切成 左 + 右 两个子 polygon
    // 根据 split.priceLeft 判断谁在左：
    //   - 默认（规则 1/2/3）：名字在左，价格在右
    //   - 规则 0a/0b（价格+品名粘连）：priceLeft=true，价格在左，品名在右
    const emitNameAndPrice = (
        line: string,
        minX: number, maxX: number, top: number, bottom: number
    ): boolean => {
        const split = splitNameAndPrice(line);
        if (!split) return false;
        const width = maxX - minX;
        // 为了鲁棒，gapRatio 限制在 [0.3, 0.85]
        const ratio = Math.min(0.85, Math.max(0.3, split.gapRatio));
        const splitX = Math.round(minX + width * ratio);
        // 留一点重叠缓冲：左边界往右 + 一点；右边界往左 - 一点
        const pad = Math.round(width * 0.01);

        const leftContent = split.priceLeft ? split.price : split.name;
        const rightContent = split.priceLeft ? split.name : split.price;

        fakeBlocks.push({
            blockContent: leftContent,
            blockPoints: [
                { x: minX, y: Math.round(top) },
                { x: splitX + pad, y: Math.round(top) },
                { x: splitX + pad, y: Math.round(bottom) },
                { x: minX, y: Math.round(bottom) },
            ],
        });
        fakeBlocks.push({
            blockContent: rightContent,
            blockPoints: [
                { x: splitX - pad, y: Math.round(top) },
                { x: maxX, y: Math.round(top) },
                { x: maxX, y: Math.round(bottom) },
                { x: splitX - pad, y: Math.round(bottom) },
            ],
        });
        return true;
    };

    for (const item of response.TextDetections) {
        if (!item.DetectedText) continue;

        const rawText = item.DetectedText.trim();
        const lines = rawText.split(/\r?\n/).map((l: string) => l).filter((l: string) => l.trim());
        const pts = item.Polygon?.map((p: any) => ({ x: p.X, y: p.Y })) || [];

        if (pts.length < 4) {
            fakeBlocks.push({ blockContent: rawText, blockPoints: pts });
            continue;
        }

        // ==========================================================
        // 倾斜鲁棒：保留 polygon 四顶点，并额外记录"行基线"
        //   - leftY  = 左侧（x 最小的两点）y 的平均
        //   - rightY = 右侧（x 最大的两点）y 的平均
        //   - topY/botY 仍然用最小/最大包围盒，便于切图
        // 这些扩展字段会被后续 ocr.ts 读取，用于倾斜同行判定。
        // ==========================================================
        const sortedByX = [...pts].sort((a: any, b: any) => a.x - b.x);
        const leftTwo = sortedByX.slice(0, 2);
        const rightTwo = sortedByX.slice(-2);
        const leftY = (leftTwo[0].y + leftTwo[1].y) / 2;
        const rightY = (rightTwo[0].y + rightTwo[1].y) / 2;

        const minX = Math.min(...pts.map((p: any) => p.x));
        const maxX = Math.max(...pts.map((p: any) => p.x));
        const minY = Math.min(...pts.map((p: any) => p.y));
        const maxY = Math.max(...pts.map((p: any) => p.y));

        const emitOne = (line: string, top: number, bottom: number) => {
            // 预处理：检测"品名A+价格A+品名B(+价格B)"这种多列粘连
            // 模式：汉字序列(以汉字/字母结尾) + 价格数字 + 汉字序列 + (可选价格数字)
            // 例："银细支休闲禾1165细智圣出山575" → 拆成 "银细支休闲禾 1165" 和 "细智圣出山 575"
            // 例："细蓝闪带王276.5续果爆玉溪" → 拆成 "细蓝闪带王 276.5" 和 "续果爆玉溪"
            // 品名A 必须以汉字/字母结尾（避免贪婪匹配吞数字）
            const multiPairRe = /^([\u4e00-\u9fa5A-Za-z()（）\d]*[\u4e00-\u9fa5A-Za-z)）])(\d{2,5}(?:\.\d+)?)([\u4e00-\u9fa5][\u4e00-\u9fa5A-Za-z()（）\d]*?)(\d{2,5}(?:\.\d+)?)?\s*$/;
            const cleaned = line.trim().replace(/点烫/g, '');
            const mp = cleaned.match(multiPairRe);
            // 启用条件必须严格，避免把品名里的数字（如"95南京"的"95"）当作价格：
            //   a) mp[1] 至少 2 字符（第一段品名不能是单字，避免误拆"软95南京"）；
            //   b) mp[3] 至少 2 字符（第二段品名合理，避免拆"合1906喜"）；
            //   c) 如果有 mp[4]（完整双对"品名A+价格A+品名B+价格B"）：
            //        mp[2] >= 50 即可（双价格强匹配模式，置信度高）
            //      如果没有 mp[4]（单对"品名A+数字+品名B"）：
            //        mp[2] >= 200（品名里的"3克细95南京"的95/"细95南京"会被排除，
            //                      但 "银细支休闲禾1165细智圣出山"的1165 能被识别）
            if (mp && mp[1] && mp[1].length >= 2 && mp[3] && mp[3].length >= 2) {
                const p1 = parseFloat(mp[2]);
                const hasMp4 = !!mp[4];
                const priceThreshold = hasMp4 ? 50 : 200;
                if (p1 >= priceThreshold && p1 <= 9999) {
                    const totalLen = cleaned.length;
                    const width = maxX - minX;
                    // 第一对：品名A + 价格A
                    const seg1Len = mp[1].length + mp[2].length;
                    const seg1Right = Math.round(minX + width * (seg1Len / totalLen));
                    emitNameAndPrice(mp[1] + ' ' + mp[2], minX, seg1Right, top, bottom);
                    // 第二对：品名B + 价格B (价格可选)
                    const seg2 = mp[4] ? mp[3] + ' ' + mp[4] : mp[3];
                    const seg2Left = seg1Right;
                    const ok2 = emitNameAndPrice(seg2, seg2Left, maxX, top, bottom);
                    if (!ok2) {
                        const stripped2 = seg2.replace(/点烫/g, '').trim();
                        if (stripped2) {
                            fakeBlocks.push({
                                blockContent: stripped2,
                                blockPoints: [
                                    { x: seg2Left, y: Math.round(top) },
                                    { x: maxX, y: Math.round(top) },
                                    { x: maxX, y: Math.round(bottom) },
                                    { x: seg2Left, y: Math.round(bottom) },
                                ],
                                _leftY: leftY,
                                _rightY: rightY,
                            });
                        }
                    }
                    return;
                }
            }

            const ok = emitNameAndPrice(line.trim(), minX, maxX, top, bottom);
            if (!ok) {
                // 降级：剥离 "点烫" 装饰，空字符串则整块丢弃
                const stripped = line.replace(/点烫/g, '').trim();
                if (!stripped) return;
                fakeBlocks.push({
                    blockContent: stripped,
                    blockPoints: [
                        { x: minX, y: Math.round(top) },
                        { x: maxX, y: Math.round(top) },
                        { x: maxX, y: Math.round(bottom) },
                        { x: minX, y: Math.round(bottom) },
                    ],
                    // 倾斜元数据（只有不可切分的整块保留，切分后的子块以新 polygon 为准）
                    _leftY: leftY,
                    _rightY: rightY,
                });
            }
        };

        if (lines.length <= 1) {
            // 单行：尝试在 X 方向上切分 名字+价格
            emitOne(lines[0] || rawText, minY, maxY);
        } else {
            // 多行：先按 Y 均分，再对每行尝试 X 方向切分
            const totalHeight = maxY - minY;
            const lineHeight = totalHeight / lines.length;

            lines.forEach((line, idx) => {
                const curTop = minY + idx * lineHeight;
                const curBottom = curTop + lineHeight;
                emitOne(line, curTop, curBottom);
            });
        }
    }

    return {
        tableInfo: null,
        blockInfo: { blockDetails: fakeBlocks }
    };

  } catch (err: any) {
    console.error("[Tencent GeneralAccurateOCR Error]", err);
    throw new Error(`腾讯云节点处理失败: ${err.message}`);
  }
}

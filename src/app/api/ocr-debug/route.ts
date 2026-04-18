// 临时诊断路由：转发到 scanImageLocal，便于命令行压测
// 使用方式：
//   curl -F "file=@xxx.jpg" -F "engine=tencent" http://localhost:3000/api/ocr-debug
//   curl -F "file=@xxx.jpg" -F "engine=tencent" -F "q=红邮喜" http://localhost:3000/api/ocr-debug
//     -> 仅返回 name 里包含 q 的条目详情（含坐标 hint / 切片前 200 字符）
// 测试完请删除本文件。

import { NextRequest, NextResponse } from 'next/server';
import { scanImageLocal } from '@/actions/ocr';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const q = (form.get('q') as string) || '';
    const qAll = (form.get('qAll') as string) || '';        // 逗号分隔多关键字
    const allMissing = (form.get('allMissing') as string) === '1'; // 批量：所有 missing 都 dump

    // 通过 globalThis 把调试关键字传给 ocr-engine，让它回传原始 OCR 块
    // 为了一次 OCR 能 dump 多个，用数组
    const kws: string[] = [];
    if (q) kws.push(q);
    if (qAll) qAll.split(',').forEach((s) => s && kws.push(s.trim()));
    (globalThis as any).__OCR_DEBUG_KEYWORDS__ = kws;
    // 兼容旧的单关键字接口
    (globalThis as any).__OCR_DEBUG_KEYWORD__ = kws[0] || null;

    const res = await scanImageLocal(form);
    const rawDump = (globalThis as any).__OCR_DEBUG_DUMP__ || null;
    const hAvg = (globalThis as any).__OCR_H_AVG__ || null;
    const trace = (globalThis as any).__OCR_DBG_TRACE__ || null;
    const missingDump = (globalThis as any).__OCR_MISSING_DUMP__ || null;
    const expandDiag = (globalThis as any).__OCR_EXPAND_DIAG__ || null;
    const salvageDiag = (globalThis as any).__OCR_DICT_SALVAGE_DIAG__ || null;
    (globalThis as any).__OCR_DEBUG_KEYWORD__ = null;
    (globalThis as any).__OCR_DEBUG_KEYWORDS__ = null;
    (globalThis as any).__OCR_DEBUG_DUMP__ = null;
    (globalThis as any).__OCR_H_AVG__ = null;
    (globalThis as any).__OCR_DBG_TRACE__ = null;
    (globalThis as any).__OCR_MISSING_DUMP__ = null;
    (globalThis as any).__OCR_EXPAND_DIAG__ = null;
    (globalThis as any).__OCR_DICT_SALVAGE_DIAG__ = null;

    if (!res.success) {
      return NextResponse.json({ success: false, error: res.error }, { status: 500 });
    }
    const data = res.parsedData || [];

    const total = data.length;
    const missing = data.filter((d) => d.price === -1).length;
    const corrected = data.filter((d) => d.isCorrected).length;
    const highConf = data.filter((d) => d.confidence === '1.0').length;
    const missingList = data
      .filter((d) => d.price === -1)
      .map((d) => d.name)
      .slice(0, 40);

    // q 查询：返回匹配条目的详情，以及它上下 y 范围内的所有条目（帮助判断"旁边有没有价格"）
    let queryHit: any = null;
    if (q) {
      const hits = data
        .map((d, idx) => ({ d, idx }))
        .filter(({ d }) => (d.name || '').includes(q) || (d.originalName || '').includes(q));

      queryHit = hits.map(({ d, idx }) => {
        // 找 data 中 y 相近（±60px）的前后条目，展示同行全貌
        // 因为 ParsedItem 已经剥了 _left/_top，我们只能用切片 dataUri 大小近似；
        // 但最实用的是直接把整组 name/price 回传，让人眼看。
        const context = data.slice(Math.max(0, idx - 6), Math.min(data.length, idx + 7)).map((c) => ({
          name: c.name,
          originalName: c.originalName,
          price: c.price,
          isCorrected: c.isCorrected,
          hasCrop: !!c.cropDataUri,
        }));
        return {
          index: idx,
          name: d.name,
          originalName: d.originalName,
          price: d.price,
          isCorrected: d.isCorrected,
          confidence: d.confidence,
          cropDataUriHead: d.cropDataUri ? d.cropDataUri.slice(0, 80) + '...' : null,
          context,
        };
      });
    }

    return NextResponse.json({
      success: true,
      summary: { total, missing, corrected, dictHit: highConf },
      missingList,
      sample: data.slice(0, 8).map((d) => ({ name: d.name, price: d.price, isCorrected: d.isCorrected })),
      queryHit,
      rawDump,
      hAvg,
      trace,
      missingDump,
      expandDiag,
      salvageDiag,
    });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e?.message || String(e) }, { status: 500 });
  }
}


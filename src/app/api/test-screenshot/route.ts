import { scanImageLocal } from '@/actions/ocr';
import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';

/**
 * 截图解析测试 API
 * GET /api/test-screenshot?path=C:/Users/Administrator/Desktop/yan/doc/1.jpg
 */
export async function GET(request: NextRequest) {
  const imagePath = request.nextUrl.searchParams.get('path');
  if (!imagePath) {
    return NextResponse.json({ error: '请提供 path 参数' }, { status: 400 });
  }

  try {
    // 捕获 console.log 输出
    const logs: string[] = [];
    const origLog = console.log;
    const origWarn = console.warn;
    console.log = (...args: any[]) => {
      logs.push(args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' '));
      origLog(...args);
    };
    console.warn = (...args: any[]) => {
      logs.push('[WARN] ' + args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' '));
      origWarn(...args);
    };

    // 读取文件
    const fileBuffer = await fs.readFile(imagePath);
    const fileName = path.basename(imagePath);
    
    // 构建 FormData
    const formData = new FormData();
    const blob = new Blob([fileBuffer], { type: 'image/jpeg' });
    formData.append('file', blob, fileName);
    formData.append('engine', request.nextUrl.searchParams.get('engine') || 'tencent');

    // 调用截图解析
    const result = await scanImageLocal(formData);

    // 恢复 console
    console.log = origLog;
    console.warn = origWarn;

    if (!result.success || !result.parsedData) {
      return NextResponse.json({ error: result.error || '解析失败', logs }, { status: 500 });
    }

    // 统计分析
    const items = result.parsedData;
    const total = items.length;
    const missing = items.filter(i => i.price === -1);
    const orphan = items.filter(i => i.name === '【孤立数字】');
    const recognized = items.filter(i => i.price !== -1 && i.name !== '【孤立数字】');

    const summary = {
      total,
      recognized: recognized.length,
      missingPrice: missing.length,
      orphanDigits: orphan.length,
      recognitionRate: `${((recognized.length / (total - orphan.length)) * 100).toFixed(1)}%`,
      missingItems: missing
        .filter(i => i.name !== '【孤立数字】')
        .map(i => ({ name: i.name, price: i.price })),
      orphanItems: orphan.map(i => ({ name: i.name, price: i.price })),
      logs: logs.filter(l => l.includes('[MISS]') || l.includes('配对汇总') || l.includes('字典') || l.includes('列锚点') || l.includes('孤立数字') || l.includes('7A1') || l.includes('补救') || l.includes('二次OCR-诊断')),
    };

    // 同时写入文件方便查看
    await fs.writeFile(path.join(process.cwd(), 'test-result.json'), JSON.stringify(summary, null, 2));

    return NextResponse.json(summary);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

'use server';

import prisma from '@/lib/prisma';

export type DashboardItem = {
  id: string;
  name: string;
  expressPrice: number | null;
  expressPrev: number | null;
  guanghuoPrice: number | null;
  guanghuoPrev: number | null;
  compareDiff: number | null; // 快递价格 - 广货价格
  lastUpdate: Date | null;
};

export async function getDashboardData(): Promise<DashboardItem[]> {
  const products = await prisma.product.findMany({
    include: {
      priceHistory: {
        include: { sheet: true },
        // 🚨 拦截同日更新 Bug：按业务日期倒序，同日按系统保存绝对秒数倒序
        orderBy: [
          { sheet: { recordDate: 'desc' } },
          { sheet: { createdAt: 'desc' } }
        ]
      }
    }
  });

  const formatted: DashboardItem[] = products.map(p => {
    // 拆分出两条时间线
    const expressHistory = p.priceHistory.filter(h => h.sheet.marketType === 'EXPRESS');
    const guanghuoHistory = p.priceHistory.filter(h => h.sheet.marketType === 'GUANGHUO');

    // 提取快递最新与昨日
    const expLatest = expressHistory.length > 0 ? expressHistory[0].price : null;
    const expPrev = expressHistory.length > 1 ? expressHistory[1].price : null;

    // 提取广货最新与昨日
    const ghLatest = guanghuoHistory.length > 0 ? guanghuoHistory[0].price : null;
    const ghPrev = guanghuoHistory.length > 1 ? guanghuoHistory[1].price : null;

    // 计算跨市场套利差价 (快递 - 广货)
    let compareDiff = null;
    if (expLatest !== null && ghLatest !== null && expLatest > 0 && ghLatest > 0) {
      compareDiff = expLatest - ghLatest;
    }

    // 获取最近更新时间
    let lastUpdate = null;
    if (expressHistory.length > 0 && guanghuoHistory.length > 0) {
      lastUpdate = expressHistory[0].sheet.recordDate > guanghuoHistory[0].sheet.recordDate 
        ? expressHistory[0].sheet.recordDate : guanghuoHistory[0].sheet.recordDate;
    } else if (expressHistory.length > 0) {
      lastUpdate = expressHistory[0].sheet.recordDate;
    } else if (guanghuoHistory.length > 0) {
      lastUpdate = guanghuoHistory[0].sheet.recordDate;
    }

    return {
      id: p.id,
      name: p.name,
      expressPrice: expLatest,
      expressPrev: expPrev,
      guanghuoPrice: ghLatest,
      guanghuoPrev: ghPrev,
      compareDiff,
      lastUpdate
    };
  });

  // 过滤掉没有任何报价的死数据
  return formatted.filter(item => item.expressPrice !== null || item.guanghuoPrice !== null);
}
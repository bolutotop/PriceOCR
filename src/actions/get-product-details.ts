'use server';

import prisma from '@/lib/prisma';
import { format } from 'date-fns';

export async function getProductDetails(productId: string) {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    include: {
      priceHistory: {
        include: { sheet: true },
        orderBy: { sheet: { recordDate: "asc" } } // 按日期升序排列用于画图
      }
    }
  });

  if (!product) return null;

  // 将历史数据按日期分组，合并快递和广货的价格用于画双折线图
  const chartDataMap: Record<string, any> = {};

  product.priceHistory.forEach(record => {
    // 过滤掉断货的 -1 价格，不画在折线图上
    if (record.price <= 0) return; 

    const dateKey = format(new Date(record.sheet.recordDate), 'MM-dd');
    
    if (!chartDataMap[dateKey]) {
      chartDataMap[dateKey] = { date: dateKey };
    }
    
    // 如果一天内有多次报价，取最后一次
    if (record.sheet.marketType === 'EXPRESS') {
      chartDataMap[dateKey].expressPrice = record.price;
    } else if (record.sheet.marketType === 'GUANGHUO') {
      chartDataMap[dateKey].guanghuoPrice = record.price;
    }
  });

  // 提取最新的分别价格
  const latestExpress = [...product.priceHistory].reverse().find(h => h.sheet.marketType === 'EXPRESS');
  const latestGuanghuo = [...product.priceHistory].reverse().find(h => h.sheet.marketType === 'GUANGHUO');

  return {
    product,
    chartData: Object.values(chartDataMap), // 转换为数组给图表组件用
    latestExpressPrice: latestExpress ? latestExpress.price : null,
    latestGuanghuoPrice: latestGuanghuo ? latestGuanghuo.price : null,
  };
}
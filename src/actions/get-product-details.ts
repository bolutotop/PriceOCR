'use server';

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function getProductDetails(productId: string) {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    include: {
      category: true,
      priceHistory: {
        include: {
          sheet: true, // 需要拿到报价单里的日期
        },
        orderBy: {
          sheet: { recordDate: 'asc' } // 按日期正序排列 (画图必须)
        }
      }
    }
  });

  if (!product) return null;

  // 格式化数据以适应图表
  const chartData = product.priceHistory
    .filter(item => item.price > 0) // 过滤掉 "//" 的价格，防止折线掉到0
    .map(item => ({
      date: item.sheet.recordDate.toISOString(), // 用于排序和Key
      displayDate: item.sheet.recordDate, // 用于显示
      price: item.price,
      sheetTitle: item.sheet.title
    }));

  return { product, chartData };
}
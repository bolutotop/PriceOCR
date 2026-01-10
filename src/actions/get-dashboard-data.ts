'use server';

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export type DashboardCategory = {
  id: string;
  name: string;
  products: {
    id: string;
    name: string;
    latestPrice: number | null;
    lastUpdate: Date | null;
  }[];
};

export async function getDashboardData() {
  // 查询所有分类
  const categories = await prisma.category.findMany({
    include: {
      products: {
        // 同时也查出产品
        include: {
          // 只查最近的一条价格记录
          priceHistory: {
            orderBy: { sheet: { recordDate: 'desc' } }, // 按行情日期倒序
            take: 1, 
            include: { sheet: true }
          }
        }
      }
    },
    orderBy: { order: 'asc' } // 按自定义顺序排序
  });

  // 格式化数据，把复杂的嵌套结构简化给前端用
  const formatted: DashboardCategory[] = categories.map(cat => ({
    id: cat.id,
    name: cat.name,
    products: cat.products.map(prod => {
      const latestItem = prod.priceHistory[0];
      return {
        id: prod.id,
        name: prod.name,
        latestPrice: latestItem ? latestItem.price : null,
        lastUpdate: latestItem ? latestItem.sheet.recordDate : null,
      };
    })
  }));

  // 过滤掉那些下面完全没有烟的空分类（可选）
  return formatted.filter(c => c.products.length > 0);
}
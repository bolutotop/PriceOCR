'use server';

import prisma from '@/lib/prisma';

export async function updateProductPrice(productId: string, marketType: 'EXPRESS' | 'GUANGHUO', newPrice: number) {
  try {
    // 寻找该商品在对应市场的最新一条报单价格
    const latestItem = await prisma.priceItem.findFirst({
      where: {
        productId,
        sheet: { marketType }
      },
      orderBy: [
        { sheet: { recordDate: 'desc' } },
        { sheet: { createdAt: 'desc' } }
      ]
    });

    if (latestItem) {
      // 存在最新记录，直接覆盖修改它（类似于纠错或即时更新价格）
      await prisma.priceItem.update({
        where: { id: latestItem.id },
        data: { price: newPrice }
      });
      return { success: true };
    } else {
      // 从未有过该市场的报价记录，我们寻找或创建一个人工补单板 (title: Manual Override)
      let dummySheet = await prisma.priceSheet.findFirst({
         where: { 
           marketType, 
           title: 'Manual Override',
         },
         orderBy: { recordDate: 'desc' }
      });
      
      if (!dummySheet) {
         dummySheet = await prisma.priceSheet.create({
            data: { marketType, recordDate: new Date(), title: 'Manual Override' }
         });
      }
      
      const product = await prisma.product.findUnique({ where: { id: productId } });

      await prisma.priceItem.create({
         data: { 
           price: newPrice, 
           productId, 
           sheetId: dummySheet.id,
           rawName: product ? product.name : '未知手工修正'
         }
      });
      return { success: true };
    }
  } catch (error: any) {
    console.error("更新价格失败:", error);
    return { success: false, error: error.message };
  }
}


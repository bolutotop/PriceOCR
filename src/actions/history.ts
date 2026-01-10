'use server';

import { PrismaClient } from '@prisma/client';
import { revalidatePath } from 'next/cache';

const prisma = new PrismaClient();

// 1. 获取所有历史上传记录
export async function getUploadHistory() {
  const sheets = await prisma.priceSheet.findMany({
    orderBy: {
      recordDate: 'desc', // 按行情日期倒序
    },
    include: {
      _count: {
        select: { items: true } // 顺便查出来这一单有多少行数据
      }
    }
  });
  return sheets;
}

// 2. 删除指定批次
export async function deletePriceSheet(sheetId: string) {
  try {
    // 因为我们在 Schema 里设置了 onDelete: Cascade
    // 所以删除 Sheet 会自动删除它下面所有的 PriceItem，不用手动删
    await prisma.priceSheet.delete({
      where: { id: sheetId }
    });
    
    // 刷新页面数据
    revalidatePath('/history');
    revalidatePath('/'); // 首页数据也会变，也刷新一下
    revalidatePath('/product/[id]'); // 详情页也会变
    
    return { success: true };
  } catch (error) {
    console.error('删除失败:', error);
    return { success: false, error: '删除失败' };
  }
}
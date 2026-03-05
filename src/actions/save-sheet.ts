'use server';

import prisma from '@/lib/prisma'; 
import { ParsedItem } from './ocr';

export async function savePriceSheet(
  items: ParsedItem[], 
  recordDateStr: string, 
  titleOrNote: string,   
  marketType: string     
) {
  try {
    const bizDate = new Date(recordDateStr);

    await prisma.$transaction(async (tx) => {
      const sheet = await tx.priceSheet.create({
        data: {
          recordDate: bizDate,
          title: titleOrNote,
          marketType: marketType, 
        },
      });

      for (const item of items) {
        // 🚨 核心修复 2：彻底清除 OCR 带来的空格和换行，确保唯一性
        const cleanName = item.name.replace(/\s+/g, '').trim();
        if (!cleanName) continue; // 防止空行导致异常

        const product = await tx.product.upsert({
          where: { name: cleanName },
          update: {}, 
          create: { name: cleanName },
        });

        await tx.priceItem.create({
          data: {
            price: item.price,
            rawName: item.originalName || item.name, 
            sheetId: sheet.id,
            productId: product.id,
          },
        });
      }
    });

    return { success: true };
  } catch (error: any) {
    console.error('保存报价单失败:', error);
    return { success: false, message: error.message };
  }
}
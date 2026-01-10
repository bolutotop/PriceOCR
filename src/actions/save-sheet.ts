'use server';

import { PrismaClient } from '@prisma/client';
import { ParsedItem } from './ocr'; // 引用之前的类型定义

const prisma = new PrismaClient();

type SaveResult = {
  success: boolean;
  message?: string;
  sheetId?: string;
};

export async function savePriceSheet(
  items: ParsedItem[], 
  recordDateStr: string, // 用户选的日期字符串 "2023-10-27"
  note?: string
): Promise<SaveResult> {
  try {
    // 1. 转换日期
    const recordDate = new Date(recordDateStr);
    
    // 2. 开启事务：一次性写入单据和所有价格
    const sheet = await prisma.$transaction(async (tx) => {
      // A. 创建报价单头
      const newSheet = await tx.priceSheet.create({
        data: {
          title: note || `${recordDateStr} 报价单`,
          recordDate: recordDate,
        },
      });

      // B. 遍历所有条目并保存
      for (const item of items) {
        // 忽略无效价格或名字
        if (item.price <= 0 || !item.name) continue;

        // C. 尝试匹配标准库里的烟 (自动归类核心逻辑)
        // 我们用 OCR 修正后的名字去库里查
        const existingProduct = await tx.product.findUnique({
          where: { name: item.name },
        });

        // D. 创建价格行
        await tx.priceItem.create({
          data: {
            sheetId: newSheet.id,
            price: item.price,
            rawName: item.originalName, // 存原始 OCR 名字留底
            // 如果库里有这烟，就关联上 ID (这样主页就能按分类统计了)
            productId: existingProduct ? existingProduct.id : undefined, 
          },
        });
      }

      return newSheet;
    });

    return { success: true, sheetId: sheet.id };

  } catch (error: any) {
    console.error('保存失败:', error);
    return { success: false, message: error.message };
  }
}
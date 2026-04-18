'use server';

import prisma from '@/lib/prisma';
import { revalidatePath } from 'next/cache';

// 获取所有产品（供选择器使用）
export async function getAllProducts() {
  try {
    const products = await prisma.product.findMany({
      orderBy: { name: 'asc' },
      select: { id: true, name: true }
    });
    return { success: true, data: products };
  } catch (error: any) {
    console.error('获取商品列表失败:', error);
    return { success: false, error: error.message };
  }
}

// 获取智能映射任务（分类广货和纯快递）
export async function getMappingTasks() {
  try {
    const products = await prisma.product.findMany({
      include: {
        priceHistory: {
          select: {
            sheet: { select: { marketType: true } }
          }
        }
      }
    });

    const guanghuoProducts: { id: string; name: string }[] = [];
    const expressOnlyProducts: { id: string; name: string }[] = [];

    for (const p of products) {
      const hasExpress = p.priceHistory.some(h => h.sheet.marketType === 'EXPRESS');
      const hasGuanghuo = p.priceHistory.some(h => h.sheet.marketType === 'GUANGHUO');

      if (hasGuanghuo) {
        guanghuoProducts.push({ id: p.id, name: p.name });
      }

      if (hasExpress && !hasGuanghuo) {
        expressOnlyProducts.push({ id: p.id, name: p.name });
      }
    }

    guanghuoProducts.sort((a, b) => a.name.localeCompare(b.name));
    expressOnlyProducts.sort((a, b) => a.name.localeCompare(b.name));

    return { success: true, data: { guanghuoProducts, expressOnlyProducts } };
  } catch (error: any) {
    console.error('获取映射任务失败:', error);
    return { success: false, error: error.message };
  }
}

// 合并功能：把 sourceId 合并进 targetId
export async function mergeProducts(targetId: string, sourceId: string) {
  try {
    if (targetId === sourceId) {
      throw new Error('不能合并同一个商品');
    }

    await prisma.$transaction(async (tx) => {
      // 1. 获取源商品和目标商品
      const sourceProduct = await tx.product.findUnique({ where: { id: sourceId } });
      const targetProduct = await tx.product.findUnique({ where: { id: targetId } });

      if (!sourceProduct || !targetProduct) {
        throw new Error('商品不存在');
      }

      // 2. 判断该异名是否已经在 Alias 表中（虽然理论上 name @unique 已经限制，但安全起见）
      const existingAlias = await tx.productAlias.findUnique({ where: { name: sourceProduct.name } });
      if (!existingAlias) {
        // 创建别名记录，将来的 OCR 如果出现源名称，就自动映射给 targetProduct
        await tx.productAlias.create({
          data: {
            name: sourceProduct.name,
            productId: targetId
          }
        });
      }

      // 3. 将原先挂在 source 下的别名也指向 target
      await tx.productAlias.updateMany({
        where: { productId: sourceId },
        data: { productId: targetId }
      });

      // 4. 把源商品名下的所有的价格记录（PriceItem）转移到目标商品名下
      await tx.priceItem.updateMany({
        where: { productId: sourceId },
        data: { productId: targetId }
      });

      // 5. 删除源商品
      await tx.product.delete({
        where: { id: sourceId }
      });
    });

    revalidatePath('/'); // 刷新首页
    revalidatePath('/mapping');
    
    return { success: true };
  } catch (error: any) {
    console.error('合并商品失败:', error);
    return { success: false, error: error.message || '合并失败' };
  }
}

// 获取当前的别名映射关系表，用于展示
export async function getMappings() {
  try {
    const aliases = await prisma.productAlias.findMany({
      include: {
        product: true
      },
      orderBy: { name: 'asc' }
    });
    return { success: true, data: aliases };
  } catch (error: any) {
    console.error('获取映射关系失败:', error);
    return { success: false, error: error.message };
  }
}

// 删除错误映射
export async function deleteMapping(aliasId: string) {
  try {
    await prisma.productAlias.delete({
      where: { id: aliasId }
    });
    revalidatePath('/mapping');
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

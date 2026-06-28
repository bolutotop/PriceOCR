'use server';

import prisma from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { NO_COMPARE_TARGET_ID, NO_COMPARE_TARGET_NAME } from '@/lib/mapping-constants';

// 虚拟"无对应行情"标准品 ID。
// 在"待办清洗"页面的下拉里作为一个特殊选项出现，用户为某条快递专属名选择该项 + 合并后，
// 该名字会被打上"无需对比"标记（在 ProductAlias 表里写一条 name == product.name 的自指记录），
// 之后：
//   1) 不会再出现在待办清洗列表里
//   2) 出货比价页面会跳过它（即使它后来同时有了快递价和广货价）
// 这样无需修改 Prisma schema，也不改动现有数据。
// 常量定义在 src/lib/mapping-constants.ts，因为 Next.js 的 'use server' 文件
// 只允许导出 async function，不允许导出普通常量。

// 获取所有产品（供选择器使用）
export async function getAllProducts() {
  try {
    const products = await prisma.product.findMany({
      orderBy: { name: 'asc' },
      select: { id: true, name: true }
    });
    return { success: true, data: products };
  } catch (error) {
    console.error('获取商品列表失败:', error);
    return { success: false, error: (error instanceof Error ? error.message : String(error)) };
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

    // 找到所有"自指别名" => 这些商品已经被标记为"无需对比"
    const selfAliases = await prisma.productAlias.findMany({
      where: {
        // 自指别名：name 与 product.name 完全相同
        // SQLite/Prisma 不支持直接列比较，这里先全量取出再用 Set 过滤
      },
      select: { name: true, productId: true, product: { select: { id: true, name: true } } }
    });
    const noCompareIds = new Set<string>();
    for (const a of selfAliases) {
      if (a.product && a.product.id === a.productId && a.name === a.product.name) {
        noCompareIds.add(a.productId);
      }
    }

    const guanghuoProducts: { id: string; name: string }[] = [];
    const expressOnlyProducts: { id: string; name: string }[] = [];

    for (const p of products) {
      const hasExpress = p.priceHistory.some(h => h.sheet.marketType === 'EXPRESS');
      const hasGuanghuo = p.priceHistory.some(h => h.sheet.marketType === 'GUANGHUO');

      if (hasGuanghuo) {
        guanghuoProducts.push({ id: p.id, name: p.name });
      }

      if (hasExpress && !hasGuanghuo && !noCompareIds.has(p.id)) {
        expressOnlyProducts.push({ id: p.id, name: p.name });
      }
    }

    guanghuoProducts.sort((a, b) => a.name.localeCompare(b.name));
    expressOnlyProducts.sort((a, b) => a.name.localeCompare(b.name));

    // 在下拉选项最前面插入"无对应行情（无需对比）"虚拟选项
    const guanghuoOptions = [
      { id: NO_COMPARE_TARGET_ID, name: NO_COMPARE_TARGET_NAME },
      ...guanghuoProducts
    ];

    return { success: true, data: { guanghuoProducts: guanghuoOptions, expressOnlyProducts } };
  } catch (error) {
    console.error('获取映射任务失败:', error);
    return { success: false, error: (error instanceof Error ? error.message : String(error)) };
  }
}

// 合并功能：把 sourceId 合并进 targetId
// 当 targetId === NO_COMPARE_TARGET_ID 时，走"无需对比"分支：
// 既不转移价格、也不删除源商品，只在 ProductAlias 里写一条 name == 源商品名的自指别名。
export async function mergeProducts(targetId: string, sourceId: string) {
  try {
    // === 分支：标记"无需对比" ===
    if (targetId === NO_COMPARE_TARGET_ID) {
      const sourceProduct = await prisma.product.findUnique({ where: { id: sourceId } });
      if (!sourceProduct) throw new Error('商品不存在');

      // 若已存在同名别名（无论指向谁），先清掉再写，避免 unique 冲突
      const existing = await prisma.productAlias.findUnique({ where: { name: sourceProduct.name } });
      if (existing) {
        await prisma.productAlias.delete({ where: { id: existing.id } });
      }
      await prisma.productAlias.create({
        data: {
          name: sourceProduct.name,
          productId: sourceProduct.id, // 自指 -> 表示"无需对比"
        }
      });

      revalidatePath('/');
      revalidatePath('/mapping');
      return { success: true };
    }

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
      } else if (existingAlias.productId !== targetId) {
        // 已存在但指向其它商品（例如旧的"无需对比"自指别名）：改指向新的 target
        await tx.productAlias.update({
          where: { id: existingAlias.id },
          data: { productId: targetId },
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
  } catch (error) {
    console.error('合并商品失败:', error);
    return { success: false, error: (error instanceof Error ? error.message : String(error)) || '合并失败' };
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
  } catch (error) {
    console.error('获取映射关系失败:', error);
    return { success: false, error: (error instanceof Error ? error.message : String(error)) };
  }
}

// 删除错误映射
export async function deleteMapping(aliasId: string) {
  try {
    await prisma.productAlias.delete({
      where: { id: aliasId }
    });
    revalidatePath('/');
    revalidatePath('/mapping');
    return { success: true };
  } catch (error) {
    return { success: false, error: (error instanceof Error ? error.message : String(error)) };
  }
}

// 获取所有"无需对比"商品 ID（自指别名）。
// 出货比价页面用它来排除这些商品。
export async function getNoCompareProductIds(): Promise<string[]> {
  try {
    const aliases = await prisma.productAlias.findMany({
      include: { product: { select: { id: true, name: true } } }
    });
    const ids: string[] = [];
    for (const a of aliases) {
      if (a.product && a.product.id === a.productId && a.name === a.product.name) {
        ids.push(a.productId);
      }
    }
    return ids;
  } catch (e) {
    console.error('获取无需对比列表失败:', e);
    return [];
  }
}


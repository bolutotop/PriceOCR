'use server';

import prisma from '@/lib/prisma';

/**
 * 给定一组品名，返回它们在对应行情下"上一次"被录入的价格。
 *
 * 用于「录入新单」页校对：OCR 识别出来的价格如果与服务器最新一次价格差距过大（>20），
 * 前端会标红提醒用户复核。
 *
 * 解析顺序：
 *  1. 先把传入名字按 ProductAlias 表做一次别名归一化（异名 -> 标准名）
 *  2. 用归一化后的标准名查 Product
 *  3. 在该 Product 的 PriceItem 中找 marketType 匹配且业务日期最新的一条
 *  4. 返回 { name -> price | null }
 */
export async function getLatestPrices(
  names: string[],
  marketType: 'EXPRESS' | 'GUANGHUO'
): Promise<Record<string, number | null>> {
  const cleanNames = Array.from(
    new Set(
      names
        .map((n) => (n || '').replace(/\s+/g, '').trim())
        .filter((n) => n.length > 0)
    )
  );

  const result: Record<string, number | null> = {};
  if (cleanNames.length === 0) return result;

  try {
    // 一把性查 Product 直接命中标准名
    const products = await prisma.product.findMany({
      where: { name: { in: cleanNames } },
      select: { id: true, name: true },
    });
    const productByName = new Map<string, { id: string; name: string }>();
    for (const p of products) productByName.set(p.name, p);

    // 没命中的名字尝试走 ProductAlias
    const missing = cleanNames.filter((n) => !productByName.has(n));
    if (missing.length > 0) {
      const aliases = await prisma.productAlias.findMany({
        where: { name: { in: missing } },
        include: { product: { select: { id: true, name: true } } },
      });
      for (const a of aliases) {
        if (a.product) {
          productByName.set(a.name, { id: a.product.id, name: a.product.name });
        }
      }
    }

    // 批量查最新价：每个 productId 找符合 marketType 的最新一条
    const productIds = Array.from(
      new Set(
        Array.from(productByName.values()).map((p) => p.id)
      )
    );

    const latestByProduct = new Map<string, number>();
    if (productIds.length > 0) {
      // 取出全部命中商品的所有价格行，按 product 分组取最新
      // 数据量不会太大；如表大可改成多次 findFirst 并发。
      const items = await prisma.priceItem.findMany({
        where: {
          productId: { in: productIds },
          sheet: { marketType },
        },
        select: {
          productId: true,
          price: true,
          sheet: { select: { recordDate: true, createdAt: true } },
        },
      });

      // 按 productId 分组挑最新的一条
      const bucket = new Map<
        string,
        { price: number; recordDate: Date; createdAt: Date }
      >();
      for (const it of items) {
        if (!it.productId) continue;
        const cur = bucket.get(it.productId);
        const ts = new Date(it.sheet.recordDate).getTime();
        const cts = new Date(it.sheet.createdAt).getTime();
        if (
          !cur ||
          new Date(cur.recordDate).getTime() < ts ||
          (new Date(cur.recordDate).getTime() === ts &&
            new Date(cur.createdAt).getTime() < cts)
        ) {
          bucket.set(it.productId, {
            price: it.price,
            recordDate: it.sheet.recordDate,
            createdAt: it.sheet.createdAt,
          });
        }
      }
      for (const [pid, info] of bucket) latestByProduct.set(pid, info.price);
    }

    for (const name of cleanNames) {
      const prod = productByName.get(name);
      if (!prod) {
        result[name] = null;
        continue;
      }
      const v = latestByProduct.get(prod.id);
      result[name] = typeof v === 'number' ? v : null;
    }

    return result;
  } catch (error) {
    console.error('[getLatestPrices] 查询失败:', error);
    return result;
  }
}

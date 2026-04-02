'use server';

import prisma from '@/lib/prisma';
import { revalidatePath } from 'next/cache';

// 获取所有库存
export async function getInventory() {
  try {
    const items = await prisma.inventoryItem.findMany({
      orderBy: { updatedAt: 'desc' }
    });
    return { success: true, data: items };
  } catch (error: any) {
    console.error('Failed to get inventory:', error);
    return { success: false, error: error.message };
  }
}

// 创建库存条目
export async function createInventoryItem(name: string, price: number, quantity: number) {
  try {
    const item = await prisma.inventoryItem.create({
      data: { name, price, quantity }
    });
    revalidatePath('/');
    return { success: true, data: item };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

// 更新库存条目（支持快速+-数量）
export async function updateInventoryItem(id: string, data: { name?: string; price?: number; quantity?: number }) {
  try {
    const item = await prisma.inventoryItem.update({
      where: { id },
      data
    });
    revalidatePath('/');
    return { success: true, data: item };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

// 删除库存条目
export async function deleteInventoryItem(id: string) {
  try {
    await prisma.inventoryItem.delete({
      where: { id }
    });
    revalidatePath('/');
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

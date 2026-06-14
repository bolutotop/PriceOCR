// 这两个常量同时被 server action 与客户端组件使用。
// 不能放在 'use server' 文件里（Next.js 限制 server module 仅允许 export async function）。

export const NO_COMPARE_TARGET_ID = '__NO_COMPARE__';
export const NO_COMPARE_TARGET_NAME = '无对应行情（无需对比）';

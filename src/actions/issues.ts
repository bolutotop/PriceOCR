'use server';

import path from 'path';
import fs from 'fs/promises';
import { revalidatePath } from 'next/cache';
import prisma from '@/lib/prisma';

// ====================================================================
// 问题反馈 Server Actions
//
// 用户提交问题（文字 + 图片）→ 开发者标记已修复 → 用户在看板确认完成 →
// 删除条目并清理图片。
//
// 【图片存储策略】
// 旧实现：写到 public/issue-uploads/<id>/<file>，前端直接 <img src="/issue-uploads/...">
//   问题：Next.js 在构建后（standalone/部署环境）对「运行时」新增到 public/ 的
//   文件不会自动作为静态资源服务 → 浏览器看到破图。
// 新实现：写到项目根 data/issue-uploads/<id>/<file>（脱离 public/），
//   通过专用 API 路由 /api/issue-images/<id>/<file> 返回图片二进制流。
//   数据库里只存这个相对 URL。
//
// 兼容：旧数据仍在 public/issue-uploads/...，API 路由会自动回退读取。
// ====================================================================

export type IssueImage = string; // 形如 "/api/issue-images/<id>/abc.jpg"

export type IssueDTO = {
  id: string;
  description: string;
  images: IssueImage[];
  status: 'OPEN' | 'RESOLVED';
  reporter: string | null;
  resolution: string | null;
  createdAt: string; // ISO
  resolvedAt: string | null;
};

// 新存储位置（脱离 public/，避免 Next 静态托管问题）
// 支持通过环境变量 ISSUE_UPLOAD_DIR 指定绝对路径，便于 Docker/standalone 挂载持久卷
const UPLOAD_ROOT = process.env.ISSUE_UPLOAD_DIR
  ? path.resolve(process.env.ISSUE_UPLOAD_DIR)
  : path.resolve(process.cwd(), 'data', 'issue-uploads');
// 旧存储位置（仅用于清理时一并删除）
const LEGACY_UPLOAD_ROOT = path.resolve(process.cwd(), 'public', 'issue-uploads');
const IMAGE_URL_PREFIX = '/api/issue-images';

const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5MB
const MAX_IMAGE_COUNT = 5;
const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

function safeParseImages(json: string): IssueImage[] {
  try {
    const arr = JSON.parse(json);
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((s): s is string => typeof s === 'string')
      // 兼容旧数据：把 "/issue-uploads/<id>/<file>" 重写到新 API 路径
      .map((s) => (s.startsWith('/issue-uploads/') ? s.replace('/issue-uploads', IMAGE_URL_PREFIX) : s));
  } catch {
    return [];
  }
}

function toDTO(row: {
  id: string;
  description: string;
  imagesJson: string;
  status: string;
  reporter: string | null;
  resolution: string | null;
  createdAt: Date;
  resolvedAt: Date | null;
}): IssueDTO {
  return {
    id: row.id,
    description: row.description,
    images: safeParseImages(row.imagesJson),
    status: row.status === 'RESOLVED' ? 'RESOLVED' : 'OPEN',
    reporter: row.reporter ?? null,
    resolution: row.resolution ?? null,
    createdAt: row.createdAt.toISOString(),
    resolvedAt: row.resolvedAt ? row.resolvedAt.toISOString() : null,
  };
}

/**
 * 创建问题（带文字描述 + 可选图片）
 * formData: description (string), reporter (string?), images (File[] 0~5)
 */
export async function createIssue(formData: FormData): Promise<{ success: boolean; id?: string; error?: string }> {
  try {
    const description = ((formData.get('description') as string) || '').trim();
    if (!description) return { success: false, error: '描述不能为空' };
    if (description.length > 2000) return { success: false, error: '描述过长（>2000）' };

    const reporter = ((formData.get('reporter') as string) || '').trim() || null;

    const fileEntries = formData.getAll('images').filter((v): v is File => v instanceof File && v.size > 0);
    if (fileEntries.length > MAX_IMAGE_COUNT) {
      return { success: false, error: `最多上传 ${MAX_IMAGE_COUNT} 张图片` };
    }
    for (const f of fileEntries) {
      if (f.size > MAX_IMAGE_SIZE) return { success: false, error: `图片 ${f.name} 超过 5MB` };
      if (!ALLOWED_MIME.includes(f.type)) return { success: false, error: `不支持的图片格式: ${f.type || '未知'}` };
    }

    // 先建数据库行拿到 id，再写文件，最后回写 imagesJson
    const created = await prisma.issue.create({
      data: { description, reporter, imagesJson: '[]', status: 'OPEN' },
    });

    const dir = path.join(UPLOAD_ROOT, created.id);
    await fs.mkdir(dir, { recursive: true });

    const savedUrls: string[] = [];
    for (let i = 0; i < fileEntries.length; i++) {
      const f = fileEntries[i];
      const ext = (() => {
        const m = (f.name || '').match(/\.[a-zA-Z0-9]+$/);
        if (m) return m[0].toLowerCase();
        if (f.type === 'image/png') return '.png';
        if (f.type === 'image/webp') return '.webp';
        if (f.type === 'image/gif') return '.gif';
        return '.jpg';
      })();
      const filename = `${Date.now()}_${i}${ext}`;
      const filePath = path.join(dir, filename);
      const buf = Buffer.from(await f.arrayBuffer());
      await fs.writeFile(filePath, buf);
      savedUrls.push(`${IMAGE_URL_PREFIX}/${created.id}/${filename}`);
    }

    if (savedUrls.length > 0) {
      await prisma.issue.update({
        where: { id: created.id },
        data: { imagesJson: JSON.stringify(savedUrls) },
      });
    }

    revalidatePath('/issues');
    return { success: true, id: created.id };
  } catch (e) {
    console.error('[createIssue]', e);
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** 列出所有问题，按 status + 时间排序：OPEN 在前，新提交在前 */
export async function listIssues(): Promise<IssueDTO[]> {
  try {
    const rows = await prisma.issue.findMany({
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    });
    return rows.map(toDTO);
  } catch (e) {
    console.error('[listIssues]', e);
    return [];
  }
}

/** 开发者把问题标为已修复（可附修复说明）。用户看到后可"确认完成"。 */
export async function resolveIssue(id: string, resolution?: string): Promise<{ success: boolean; error?: string }> {
  try {
    const trimmed = (resolution || '').trim();
    await prisma.issue.update({
      where: { id },
      data: {
        status: 'RESOLVED',
        resolvedAt: new Date(),
        resolution: trimmed || null,
      },
    });
    revalidatePath('/issues');
    return { success: true };
  } catch (e) {
    console.error('[resolveIssue]', e);
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** 把已修复的条目重新打开（用户表示"还有问题"） */
export async function reopenIssue(id: string): Promise<{ success: boolean; error?: string }> {
  try {
    await prisma.issue.update({
      where: { id },
      data: { status: 'OPEN', resolvedAt: null },
    });
    revalidatePath('/issues');
    return { success: true };
  } catch (e) {
    console.error('[reopenIssue]', e);
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** 用户确认问题真的修好了：彻底删除条目 + 清理图片目录 */
export async function confirmIssueDone(id: string): Promise<{ success: boolean; error?: string }> {
  try {
    const issue = await prisma.issue.findUnique({ where: { id } });
    if (!issue) return { success: false, error: '问题不存在' };
    if (issue.status !== 'RESOLVED') {
      return { success: false, error: '只有已修复的问题才能确认完成' };
    }

    await prisma.issue.delete({ where: { id } });

    // 同时清理新位置 data/ 与旧位置 public/（兼容历史数据）
    const dir = path.join(UPLOAD_ROOT, id);
    const legacyDir = path.join(LEGACY_UPLOAD_ROOT, id);
    await Promise.all([
      fs.rm(dir, { recursive: true, force: true }).catch(() => {}),
      fs.rm(legacyDir, { recursive: true, force: true }).catch(() => {}),
    ]);

    revalidatePath('/issues');
    return { success: true };
  } catch (e) {
    console.error('[confirmIssueDone]', e);
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}

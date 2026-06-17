import { NextRequest } from 'next/server';
import path from 'path';
import fs from 'fs/promises';

// =============================================================================
// 问题反馈截图专用图片服务路由
//
// 为什么不直接把图片放到 public/ 让 Next 静态托管？
//   1) Next.js 在构建后（standalone / vercel / 部分托管平台）对运行时
//      新增到 public/ 的文件并不会自动加入静态资源索引，会出现 404 / 破图。
//   2) public/ 里存运行时数据也不利于备份与权限控制。
// 因此：图片真正存放在项目根的 data/issue-uploads/<issueId>/<name>，
//   通过本路由 /api/issue-images/<issueId>/<name> 以受控方式读取并返回。
//
// 兼容：老数据仍存在 public/issue-uploads/<id>/<name>，本路由会自动回退查找。
// =============================================================================

// 强制动态路由：避免 Next.js 在 build 期把这条 route handler 静态化，
// 导致部署后读取到的是构建时的 storage 快照（这是常见的破图原因之一）。
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const DATA_ROOT = process.env.ISSUE_UPLOAD_DIR
  ? path.resolve(process.env.ISSUE_UPLOAD_DIR)
  : path.resolve(process.cwd(), 'data', 'issue-uploads');
const LEGACY_PUBLIC_ROOT = path.resolve(process.cwd(), 'public', 'issue-uploads');

const ALLOWED_EXT: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

// 仅允许「字母/数字/下划线/短横线/点」组成的安全片段，禁止 .. 与路径分隔符
const SAFE_SEGMENT = /^[A-Za-z0-9_.-]+$/;

function isSafeSegment(s: string): boolean {
  if (!s) return false;
  if (s.includes('..')) return false;
  return SAFE_SEGMENT.test(s);
}

async function readIfExists(p: string): Promise<Buffer | null> {
  try {
    return await fs.readFile(p);
  } catch {
    return null;
  }
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ issueId: string; name: string }> },
) {
  const { issueId, name } = await params;

  if (!isSafeSegment(issueId) || !isSafeSegment(name)) {
    return new Response('Bad Request', { status: 400 });
  }

  const ext = path.extname(name).toLowerCase();
  const mime = ALLOWED_EXT[ext];
  if (!mime) {
    return new Response('Unsupported Media Type', { status: 415 });
  }

  // 1) 优先读新位置 data/
  const primary = path.join(DATA_ROOT, issueId, name);
  let buf = await readIfExists(primary);

  // 2) 回退老位置 public/（兼容已有数据）
  if (!buf) {
    const legacy = path.join(LEGACY_PUBLIC_ROOT, issueId, name);
    buf = await readIfExists(legacy);
  }

  if (!buf) {
    return new Response('Not Found', { status: 404 });
  }

  return new Response(new Uint8Array(buf), {
    status: 200,
    headers: {
      'Content-Type': mime,
      'Content-Length': String(buf.length),
      // 私有缓存即可：图片不会变，但删除问题后会消失
      'Cache-Control': 'private, max-age=300',
      // 允许跨域读取，方便接 Cloudflare Tunnel / 反代到不同域名时仍能显示
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
    },
  });
}

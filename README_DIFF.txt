PriceOCR 反馈模块图片破图问题修复 - 差异包说明
========================================================

提交时间：2026-06-17 22:45
基线：origin/main 最新提交 b893550 (feat: 新增 Issue 反馈模块（TAPD 风格看板）)
影响范围：仅"问题反馈/问题看板"模块的图片显示

------------------------------------------------------------
【问题现象】
  问题看板里上传的截图显示成破图（如附图：截图1 显示不出来）。

【根因】
  原实现把上传截图写到 public/issue-uploads/<issueId>/<file>，
  让浏览器走 Next.js 的静态资源加载。
  但 Next.js 在 build / 生产部署后，对「运行时」新增到 public/ 的
  文件不会自动加入静态资源索引 → 浏览器请求 /issue-uploads/... 时
  命中 404，最终就是破图。

【修复方案】
  参考 https://github.com/bolutotop/ImageManagement.git 的"动静分离"思路：
    1) 图片改存到项目根的 data/issue-uploads/<issueId>/<file>（脱离 public/）
    2) 新增专用 API 路由 /api/issue-images/<issueId>/<file>，
       由 route.ts 实时读取磁盘文件并以二进制流返回
    3) 数据库里只存这个相对 URL
    4) 兼容旧数据：safeParseImages 自动把老前缀 /issue-uploads/
       重写到 /api/issue-images/，路由本身也会回退到 public/ 老位置查找

------------------------------------------------------------
【本包包含的差异文件】
  1. src/actions/issues.ts            （修改：UPLOAD_ROOT、URL 前缀、清理逻辑）
  2. src/app/api/issue-images/[issueId]/[name]/route.ts  （新增）
  3. .gitignore                        （新增 /data/ 忽略项）

【应用方法】
  解压本 zip 到项目根目录，覆盖 / 新增上述文件即可。
  无需迁移已有数据（数据库存的旧 URL 会自动重写）。
  如果磁盘上已有旧图，请把 public/issue-uploads/* 复制一份到 data/issue-uploads/，
  或直接保留在原位（API 路由会回退查找）。

【部署注意】
  - 单机服务器（PM2 / next start）：开箱即用，无需任何额外配置。
  - Docker：把宿主机一个目录挂载到容器内，并设环境变量
      ISSUE_UPLOAD_DIR=/var/lib/priceocr/issue-uploads
    避免容器重建后图片丢失。
  - Vercel / Serverless：本方案文件系统不持久化，需另行接对象存储（不在本次范围）。

【git 提交建议】
  git add .gitignore src/actions/issues.ts src/app/api/issue-images
  git commit -m "fix(issues): 截图改用 /api/issue-images 路由读取，解决 public/ 运行时新增文件破图问题"

------------------------------------------------------------
【安全相关】
  新增的 route.ts 已做严格防御：
    - 仅允许字母/数字/下划线/短横线/点 组成的路径片段
    - 拒绝任何包含 ".." 的请求
    - MIME 白名单（jpg/jpeg/png/webp/gif）
    - export const dynamic = 'force-dynamic' 防止被 build 期静态化


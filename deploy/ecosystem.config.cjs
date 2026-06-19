// PM2 ecosystem 配置（PriceOCR · 轮询模式）
//
// ⚠ 这是模板（含占位符），请复制为 ecosystem.local.cjs 后再填真实配置，
//   ecosystem.local.cjs 已被 .gitignore 忽略，不会进仓库。
//
// 启动：
//   cd /opt/PriceOCR
//   cp deploy/ecosystem.config.cjs deploy/ecosystem.local.cjs   # 首次
//   # 编辑 deploy/ecosystem.local.cjs，确认/修改 DATABASE_URL 等
//   pm2 start deploy/ecosystem.local.cjs --env production
//   pm2 save
//   pm2 startup    # 输出一行 sudo，照做即可开机自启
//
// 默认管理 2 个进程：
//   1. priceocr   Next.js 主应用（端口 3100）
//   2. poller     轮询器（每 30 秒检查 origin/main 是否有更新）

const path = require('path');
const ROOT = path.resolve(__dirname, '..');

module.exports = {
  apps: [
    // -------------------------------------------------------------------------
    // Next.js 主应用
    // -------------------------------------------------------------------------
    {
      name: 'priceocr',
      script: 'node_modules/next/dist/bin/next',
      args: 'start -p 3100',
      cwd: ROOT,
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production',
        PORT: '3100',

        // ----- Prisma -----
        // SQLite 文件位置（建议放仓库外的持久化目录，避免 git pull 影响）
        DATABASE_URL: 'file:/opt/PriceOCR-data/priceocr.db',

        // ----- 反馈图上传根目录（运行时数据，建议放仓库外） -----
        ISSUE_UPLOAD_DIR: '/opt/PriceOCR-data/issue-uploads',

        // ----- 云 OCR 密钥（按需填，不填则不启用对应引擎） -----
        // ALIYUN_AK_ID: '',
        // ALIYUN_AK_SECRET: '',
        // TENCENT_SECRET_ID: '',
        // TENCENT_SECRET_KEY: '',
      },
      out_file: './.data/logs/priceocr.out.log',
      error_file: './.data/logs/priceocr.err.log',
      merge_logs: true,
      time: true,
    },

    // -------------------------------------------------------------------------
    // 轮询部署器（30 秒一次检查 origin/main）
    // -------------------------------------------------------------------------
    {
      name: 'poller',
      script: './deploy/poller.sh',
      interpreter: 'bash',     // 用 bash 执行，不是 node
      cwd: ROOT,
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_memory_restart: '128M',
      env: {
        // 轮询间隔（秒）。生产建议 30~60，太短浪费 GitHub API；太长更新慢
        POLL_INTERVAL: '30',
        DEPLOY_BRANCH: 'main',
        DEPLOY_SCRIPT: './deploy/deploy.sh',
        DEPLOY_LOG: './.data/deploy.log',
        POLLER_LOG: './.data/poller.log',
      },
      out_file: './.data/logs/poller.out.log',
      error_file: './.data/logs/poller.err.log',
      merge_logs: true,
      time: true,
    },
  ],
};

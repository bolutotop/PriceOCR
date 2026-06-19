// PM2 ecosystem 配置（PriceOCR）
//
// ⚠ 这是模板（含占位符），请复制为 ecosystem.local.cjs 后再填真实 secret，
//   ecosystem.local.cjs 已被 .gitignore 忽略，不会进仓库。
//
// 启动：
//   cd /opt/PriceOCR
//   cp deploy/ecosystem.config.cjs deploy/ecosystem.local.cjs   # 首次
//   # 编辑 deploy/ecosystem.local.cjs，填 WEBHOOK_SECRET 等真实值
//   pm2 start deploy/ecosystem.local.cjs --env production
//   pm2 save
//   pm2 startup    # 输出一行 sudo，照做即可开机自启
//
// 默认管理 2 个进程：
//   1. priceocr   Next.js 主应用（端口 3100）
//   2. webhook    GitHub Webhook 监听器（端口 9100，仅 127.0.0.1）

module.exports = {
  apps: [
    // -------------------------------------------------------------------------
    // Next.js 主应用
    // -------------------------------------------------------------------------
    {
      name: 'priceocr',
      script: 'node_modules/next/dist/bin/next',
      args: 'start -p 3100',
      cwd: __dirname.replace(/[/\\]deploy$/, ''),
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production',
        PORT: '3100',

        // ----- Prisma -----
        // SQLite 文件位置（建议放仓库外的持久化目录，避免 git pull 影响）
        // 如果用默认 prisma/dev.db，可注释掉下一行；推荐独立路径如下：
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
    // GitHub Webhook 监听器
    // -------------------------------------------------------------------------
    {
      name: 'webhook',
      script: './deploy/webhook.js',
      cwd: __dirname.replace(/[/\\]deploy$/, ''),
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_memory_restart: '256M',
      env: {
        NODE_ENV: 'production',
        WEBHOOK_PORT: '9100',
        // ⚠ 改成 32 位以上随机字符串，并填到 GitHub Webhook 的 Secret
        // 生成命令：openssl rand -hex 24
        WEBHOOK_SECRET: 'CHANGE_ME_TO_RANDOM_LONG_STRING',
        DEPLOY_BRANCH: 'main',
        DEPLOY_SCRIPT: './deploy/deploy.sh',
        DEPLOY_LOG: './.data/deploy.log',
        // 通知脚本，先不接，留接口；接通知时取消注释：
        // NOTIFY_SCRIPT: './deploy/notify.sh',
      },
      out_file: './.data/logs/webhook.out.log',
      error_file: './.data/logs/webhook.err.log',
      merge_logs: true,
      time: true,
    },
  ],
};

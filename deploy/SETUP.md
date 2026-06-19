# PriceOCR 自动部署 · 一次性安装手册

> 目标：**部署一次后，每次 `git push` 自动更新服务器**。
> 适用：Ubuntu/Debian VPS，sudo/root 权限，公网 IP，已绑定域名。

---

## 一、原理（速览）

```
你的电脑                           服务器                     你的浏览器
─────────────────────────────────────────────────────────────────────────
git push                                                   https://your-domain
      │                                                              │
      ▼                                                              ▼
   GitHub ──webhook (HMAC 验签)──▶ 9100 (webhook.js) ──▶ deploy.sh
                                       │                       │
                                       │                       ├─ git fetch + reset
                                       │                       ├─ npm ci (智能跳过)
                                       │                       ├─ prisma generate + migrate deploy (智能)
                                       │                       ├─ npm run build (智能跳过)
                                       │                       └─ pm2 reload priceocr  ◀──── 零停机
                                       │
                                       └──────── pm2 也守护 ────▶ 3100 (Next.js)
                                                       │
                                                       ▼
                                                    nginx 443 → 反代
```

端口规划：
- **3100**：Next.js 主应用
- **9100**：Webhook 监听器（仅监听 127.0.0.1，由 nginx 反代到 `/webhook`）

---

## 二、首次部署清单（约 30 分钟）

### 1. 基础环境

```bash
# Node 20+（推荐 22）。这里用 nvm，干净又灵活
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
source ~/.bashrc
nvm install 22
nvm alias default 22

# PM2（进程管理 + 开机自启）
npm i -g pm2

# nginx + certbot（反代 + 自动 HTTPS）
sudo apt update
sudo apt install -y nginx certbot python3-certbot-nginx git build-essential
```

### 2. 拉代码 & 装依赖 & 准备数据目录

```bash
# 仓库地址
sudo mkdir -p /opt && cd /opt
sudo git clone https://github.com/bolutotop/PriceOCR.git
sudo chown -R $USER:$USER /opt/PriceOCR
cd /opt/PriceOCR

npm ci

# 仓库外的持久化数据目录（SQLite 库 + 反馈图，git pull 不会影响）
sudo mkdir -p /opt/PriceOCR-data/issue-uploads
sudo chown -R $USER:$USER /opt/PriceOCR-data

# 部署日志 / PM2 日志目录（在仓库内，已被 .gitignore 排除）
mkdir -p .data/logs
```

### 3. 配置环境变量 & 初始化数据库

```bash
# 第一次部署时手动跑 prisma，让 SQLite 库就位
DATABASE_URL='file:/opt/PriceOCR-data/priceocr.db' \
  npx prisma migrate deploy

DATABASE_URL='file:/opt/PriceOCR-data/priceocr.db' \
  npx prisma generate

# 第一次构建
npm run build
```

### 4. 配置 PM2

```bash
# 复制模板（local 文件已 gitignore）
cp deploy/ecosystem.config.cjs deploy/ecosystem.local.cjs

# 生成强随机串作为 webhook secret，记下来
openssl rand -hex 24
```

编辑 `deploy/ecosystem.local.cjs`，至少改这几项：
- `WEBHOOK_SECRET`：填刚生成的随机串
- `DATABASE_URL`：确认是 `file:/opt/PriceOCR-data/priceocr.db`（默认已对）
- `ISSUE_UPLOAD_DIR`：确认是 `/opt/PriceOCR-data/issue-uploads`（默认已对）
- 如果要用云 OCR：把 `ALIYUN_AK_ID/SECRET`、`TENCENT_SECRET_ID/KEY` 填上

启动：

```bash
pm2 start deploy/ecosystem.local.cjs --env production
pm2 save
pm2 startup    # 复制输出的 sudo 行执行一次
pm2 status     # 应看到 priceocr / webhook online
```

### 5. 配置 Nginx 反代 + HTTPS

```bash
# 复制示例
sudo cp deploy/nginx.conf.example /etc/nginx/sites-available/priceocr.conf

# 改 server_name 为你的域名（两处）
sudo nano /etc/nginx/sites-available/priceocr.conf

sudo ln -s /etc/nginx/sites-available/priceocr.conf /etc/nginx/sites-enabled/
# 如果是单独这一个站点可移除默认：
# sudo rm /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx

# 自动签发 Let's Encrypt 证书
sudo certbot --nginx -d your-domain.com
# 选 "重定向到 HTTPS"（选项 2）
```

打开 `https://your-domain.com` 应能看到 PriceOCR 主页。

### 6. 配置 GitHub Webhook（关键！）

进入仓库：https://github.com/bolutotop/PriceOCR/settings/hooks

点 **Add webhook**，填：

| 项 | 值 |
|---|---|
| Payload URL | `https://your-domain.com/webhook` |
| Content type | `application/json` |
| Secret | **第 4 步生成的那个字符串**（必须完全一致！） |
| SSL verification | Enable |
| Which events | Just the push event |
| Active | ✅ |

点 **Add webhook**。GitHub 会立即发一个 ping。

验证：

```bash
pm2 logs webhook --lines 20
# 不应有 "[reject] bad signature"，应能看到 ping → pong
```

### 7. 测试自动部署

在本地：

```bash
echo "" >> README.md
git commit -am "chore: test auto deploy"
git push
```

服务器上看日志：

```bash
pm2 logs webhook --lines 30
tail -f .data/deploy.log
```

应该看到 `[deploy] start` → `git fetch` → `pm2 reload priceocr` → `[deploy] DONE`。

---

## 三、（可选）接入通知

参考 `deploy/notify.sh`，把对应渠道的 curl 取消注释 + 填 token，然后在 `ecosystem.local.cjs` 里启用：

```js
env: {
  // ...
  NOTIFY_SCRIPT: './deploy/notify.sh',
}
```

`pm2 reload webhook --update-env` 生效。

---

## 四、常用运维命令

```bash
# 看进程状态
pm2 status

# 实时日志
pm2 logs                    # 全部
pm2 logs priceocr           # 仅主应用
pm2 logs webhook --lines 100

# 部署日志（webhook 自己写的）
tail -f .data/deploy.log
curl http://127.0.0.1:9100/log | tail -100

# 手动触发一次部署（不通过 webhook，便于排错）
bash deploy/deploy.sh manual

# 健康检查
curl http://127.0.0.1:9100/health
# {"ok":true,"running":false,"pending":false,"branch":"main"}

# 重启所有
pm2 reload all

# 滚回到某个 commit
cd /opt/PriceOCR
git reset --hard <sha>
npm ci && npm run build
pm2 reload priceocr

# 数据库手动迁移（修改了 schema 后）
DATABASE_URL='file:/opt/PriceOCR-data/priceocr.db' npx prisma migrate deploy
```

---

## 五、安全 & 备份

- `WEBHOOK_SECRET` 一定要 **强随机**（`openssl rand -hex 24`），不要用人能猜的字符串。
- webhook 监听 `127.0.0.1:9100`，**不直接暴露**，由 nginx 反代到 `/webhook` 路径并走 https。
- `ecosystem.local.cjs` 含 secret，**不要提交**（已 gitignore）。仓库里的 `ecosystem.config.cjs` 是带占位符的模板。
- 数据备份建议（SQLite + 反馈图）：

  ```bash
  # 加到 crontab：每天 3 点备份到 ~/backup/
  0 3 * * * tar czf ~/backup/priceocr-$(date +\%F).tar.gz /opt/PriceOCR-data/
  ```

---

## 六、踩坑速查

| 现象 | 原因 / 排查 |
|---|---|
| `pm2 logs webhook` 出现 `bad signature` | secret 不一致；GitHub Webhook 配置和 PM2 env 必须完全相同 |
| 推送后 webhook 没反应 | GitHub Settings → Webhooks → Recent Deliveries 看 HTTP 状态码 |
| `npm run build` 报内存不足 | `NODE_OPTIONS='--max-old-space-size=2048' npm run build`；或加 swap |
| 反馈截图传完看不到 | nginx `client_max_body_size` 太小；改成 30M 后 `nginx -s reload`；或确认 `ISSUE_UPLOAD_DIR` 目录存在且可写 |
| 部署中 push 第二个 commit | webhook.js 有队列，会自动等当前完再跑下一个 |
| Prisma 报 `Database does not exist` | 第一次部署忘了跑 `prisma migrate deploy`；按第 3 步手动执行一次 |
| Sharp 安装慢/失败 | 可设 `npm_config_sharp_binary_host` 镜像，或确认服务器架构匹配 |
| 同机有 QuantTrade 端口冲突 | 默认已避开（QT 用 3000/9000，PriceOCR 用 3100/9100），别再改回去 |

完。

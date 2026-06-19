# PriceOCR 自动部署 · 一次性安装手册（轮询模式）

> 目标：**部署一次后，每次 `git push`，服务器最多 30 秒内自动更新**。
> 适用：任何能装 Node + Git 的 Linux 服务器（推荐 Ubuntu/Debian 22.04+）。

## 一、原理（速览）

```
你的电脑                                服务器
─────────────────────────────────────────────────────────────────
git push  ────────────►  GitHub
                            │
                            │  (服务器主动拉，不需要 webhook，不需要域名)
                            │
                            ▼
                       deploy/poller.sh  每 30 秒：
                        ├─ git fetch origin main
                        ├─ if local != remote：
                        │    git reset --hard origin/main
                        │    bash deploy/deploy.sh <new_sha>
                        │      ├─ npm ci  (智能跳过)
                        │      ├─ prisma generate + migrate deploy (智能)
                        │      ├─ npm run build  (智能跳过)
                        │      └─ pm2 reload priceocr  ← 零停机
                        └─ sleep 30
                            │
                            ▼
                  http://server-ip → nginx 80 → 127.0.0.1:3100 (Next.js)
```

**轮询模式的优劣**：
- ✅ 不需要域名、不需要公网开 80/443、不需要管 GitHub Webhook 设置
- ✅ 服务器在防火墙后/内网都能用（只要能出网到 github.com）
- ⚠️ 最多 30 秒延迟（可调）
- ⚠️ 每分钟会向 GitHub 发 2 次请求，私有仓库每小时 60 次内（GitHub 限额 5000/h，不会超）

---

## 二、首次部署清单（约 25 分钟）

### 1. 基础环境

```bash
# Node 20+（推荐 22）
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
source ~/.bashrc
nvm install 22
nvm alias default 22

# PM2（进程管理 + 开机自启）
npm i -g pm2

# Git + Nginx + 编译工具
sudo apt update
sudo apt install -y git nginx build-essential
```

### 2. 拉代码（公开仓库直接 clone）

```bash
sudo mkdir -p /opt && cd /opt
sudo git clone https://github.com/bolutotop/PriceOCR.git
sudo chown -R $USER:$USER /opt/PriceOCR
cd /opt/PriceOCR

npm ci

# 仓库外的持久化数据目录（git pull 永远不会动这里）
sudo mkdir -p /opt/PriceOCR-data/issue-uploads
sudo chown -R $USER:$USER /opt/PriceOCR-data

# PM2 / 部署日志（在仓库内，已 .gitignore）
mkdir -p .data/logs
```

> **如果仓库是私有的**：用 SSH 克隆 `git clone git@github.com:bolutotop/PriceOCR.git`，
> 并在服务器上配好 deploy key（github.com/bolutotop/PriceOCR/settings/keys）或用你账号的 SSH key。

### 3. 初始化数据库 & 首次构建

```bash
# 创建 SQLite 库
DATABASE_URL='file:/opt/PriceOCR-data/priceocr.db' npx prisma migrate deploy
DATABASE_URL='file:/opt/PriceOCR-data/priceocr.db' npx prisma generate

# 首次构建（之后由 poller 自动构建）
npm run build
```

### 4. 配置 PM2

```bash
# 复制模板到本地配置（含真实路径/密钥的版本不入库）
cp deploy/ecosystem.config.cjs deploy/ecosystem.local.cjs

# 如需改 OCR 密钥、轮询间隔等：
nano deploy/ecosystem.local.cjs

# 启动两个进程：priceocr（Next.js）+ poller（轮询器）
pm2 start deploy/ecosystem.local.cjs --env production
pm2 save
pm2 startup    # 复制输出的 sudo 行执行一次（开机自启）
pm2 status     # 应看到 priceocr / poller 都是 online
```

### 5. 配置 Nginx 反代

```bash
sudo cp deploy/nginx.conf.example /etc/nginx/sites-available/priceocr.conf
sudo ln -s /etc/nginx/sites-available/priceocr.conf /etc/nginx/sites-enabled/

# 没域名：保持 server_name _; 即可
# 有域名：把 server_name _ 改成 your-domain.com

sudo nginx -t && sudo systemctl reload nginx
```

打开浏览器访问 `http://<服务器IP>` 应该能看到 PriceOCR 主页。

> **境外服务器**：80 端口在云控制台安全组放通即可。
> **国内服务器**：80 端口必须 ICP 备案才能用，未备案请改用 8080 等非标端口（修改 nginx `listen 80;` 为 `listen 8080;`，并放通 8080）。

### 6. 验证自动更新

在你**本地**：
```powershell
cd d:\TGit\PriceOCR
echo "" >> README.md
git commit -am "test: auto deploy"
git push
```

服务器上看日志（最多 30 秒后会有动作）：
```bash
# 实时看轮询器
tail -f /opt/PriceOCR/.data/poller.log

# 实时看部署
tail -f /opt/PriceOCR/.data/deploy.log

# 或者 PM2 日志
pm2 logs poller
```

应该看到：
```
[poller xxx] NEW COMMIT detected: xxx -> yyy
[poller xxx] running ./deploy/deploy.sh ...
[deploy 16:35:12] === START ===
[deploy 16:35:13] skip npm ci
[deploy 16:35:13] skip prisma
[deploy 16:35:14] skip build (no relevant changes)
[deploy 16:35:14] pm2 reload priceocr
[deploy 16:35:15] === DONE ===
[poller xxx] deploy OK: now at yyy
```

✅ 看到这个 = 已经打通，今后只需 `git push`。

---

## 三、常用运维命令

```bash
# 看进程状态
pm2 status

# 实时日志
pm2 logs                    # 全部
pm2 logs priceocr           # 仅主应用
pm2 logs poller             # 仅轮询器

# 文本日志文件（更适合 grep）
tail -f /opt/PriceOCR/.data/poller.log
tail -f /opt/PriceOCR/.data/deploy.log

# 手动触发一次部署（不等轮询，便于排错）
cd /opt/PriceOCR
git fetch origin main
PREV_SHA=$(git rev-parse HEAD) git reset --hard origin/main
bash deploy/deploy.sh "$(git rev-parse HEAD)"

# 暂停自动部署（保留主应用运行）
pm2 stop poller

# 恢复
pm2 start poller

# 重启所有
pm2 reload all

# 滚回到某个 commit（注意：此时若 origin/main 比本地新，poller 会很快又拉新版回来；
# 想保持回滚态请先 pm2 stop poller）
pm2 stop poller
cd /opt/PriceOCR
git reset --hard <sha>
npm ci && npm run build
pm2 reload priceocr

# 调整轮询频率（改完后 reload 生效）
nano deploy/ecosystem.local.cjs   # 改 POLL_INTERVAL
pm2 reload poller --update-env
```

---

## 四、安全 & 备份

- 不需要 webhook secret，**减少了一个泄露面**。
- 服务器对外只需开 22 (SSH) + 80 (HTTP)（或备案后的 443）。
- 数据备份建议（SQLite + 反馈图）：

  ```bash
  # 加到 crontab：每天凌晨 3 点
  crontab -e
  # 添加：
  0 3 * * * tar czf /root/backup/priceocr-$(date +\%F).tar.gz /opt/PriceOCR-data/
  ```

- `ecosystem.local.cjs` 含真实密钥，已 gitignore，**别提交**。

---

## 五、踩坑速查

| 现象 | 原因 / 排查 |
|---|---|
| `pm2 status` 里 poller 反复重启 | `tail -f .data/poller.err.log` 看错误；常见：`deploy/poller.sh` 没有可执行权限（其实 PM2 用 bash 跑不需要 +x，但本机执行需要 `chmod +x`） |
| 推送 30s 后还是没更新 | 1) `tail -f .data/poller.log` 看 fetch 是否失败 2) 服务器能否访问 github.com（私有库要 SSH key） |
| `git fetch` 报权限 | 私有仓库的 SSH key 没配好；或 https 没缓存凭据；改成 SSH 形式最稳 |
| `npm run build` 内存不足 | `NODE_OPTIONS='--max-old-space-size=2048' npm run build`，或加 swap，或升级到 2GB+ 内存 |
| Prisma 报 Database does not exist | 漏了第 3 步 `prisma migrate deploy` |
| 反馈截图 404 | `ISSUE_UPLOAD_DIR` 目录不存在或不可写；nginx `client_max_body_size` 太小 |
| 我手动改了服务器代码 | 下次 `git push` 时 `git reset --hard` 会**覆盖**你的改动！服务器上不要直接改文件。 |
| 轮询频率太高担心 GitHub 限额 | GitHub 对未认证请求每小时 60 次（IP 维度），认证请求 5000 次。`git fetch` 走 ssh 不算 REST API 配额，30 秒一次完全没事。|
| 想暂时停止自动更新（比如做演示） | `pm2 stop poller` |
| poller 检测到失败后会怎样 | deploy.sh 内部会 rollback 代码 + .next；poller 会 back-off 5 分钟再继续，避免疯狂重试。修复后 push 一个新 commit 自动恢复 |

完。

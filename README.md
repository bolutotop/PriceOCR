


# 报价看板系统 (Price Board) - 生产环境部署指南

本文档用于指导本系统在 Linux 生产服务器上的首次环境搭建、编译与后台常驻运行。

## 1. 基础环境准备
在服务器上，必须预先安装以下运行环境：
* **Node.js** (推荐 v18.17.0 或以上版本)
* **npm** (随 Node.js 附带)
* **Git** (用于拉取代码，若手动上传代码包则非必需)
* **PM2** (Node.js 进程守护工具)

全局安装 PM2 命令：
```bash
npm install -g pm2



## 2. 代码获取与依赖安装

将项目代码放置于服务器目标目录（例如 `/var/www/price-board`），进入该目录后执行依赖安装。

```bash
cd /var/www/price-board
npm install

```

## 3. 环境变量与数据库配置

在项目根目录创建 `.env` 环境变量文件，配置生产数据库连接。

```bash
touch .env

```

使用编辑器（如 vim 或 nano）打开 `.env` 文件，填入你的数据库连接字符串（以 PostgreSQL 或 SQLite 为例）：

```env
# 替换为你的真实数据库连接地址
DATABASE_URL="postgresql://user:password@localhost:5432/priceboard?schema=public"

# 如果你使用的是 SQLite，则直接指定本地文件路径
# DATABASE_URL="file:./prisma/data.db"

```

## 4. 数据库初始化与 Prisma 客户端生成

执行以下命令，将 Prisma Schema 同步到生产数据库，并生成数据交互客户端。

```bash
# 1. 生成 Prisma Client
npx prisma generate

# 2. 推送表结构到数据库 (首次建表)
npx prisma db push

```

*注：生产环境如需严格的数据库迁移控制，可将 `db push` 替换为 `migrate deploy`。*

## 5. 项目生产编译

编译 Next.js 生产代码。此过程会进行严格的 TypeScript 类型检查与路由静态化。

```bash
npm run build

```

*如遇到输出 `Compiled successfully`，则代表编译完全通过。*

## 6. PM2 进程守护与启动

切勿直接使用 `npm run start`，否则断开 SSH 连接后服务会立即停止。必须使用 PM2 将其挂载至系统后台常驻运行。

```bash
# 启动服务，并命名为 "price-board"
pm2 start npm --name "price-board" -- start

# 保存当前 PM2 进程列表，确保服务器重启后自动恢复
pm2 save

# 设置 PM2 开机自启
pm2 startup

```

## 7. 常用运维指令

部署完成后，可使用以下指令进行日常维护：

* 查看实时运行状态：`pm2 status`
* 查看系统控制台日志：`pm2 logs price-board`
* 重启服务（更新代码后）：`pm2 restart price-board`
* 停止服务：`pm2 stop price-board`

## 8. Nginx 端口映射 (可选)

系统默认运行在 `3000` 端口（即 `http://1.1.1.1:3000`）。若需隐藏端口或绑定域名，需配置 Nginx 反向代理：

```nginx
server {
    listen 80;
    server_name yourdomain.com; # 替换为你的域名或 IP

    location / {
        proxy_pass [http://127.0.0.1:3000](http://127.0.0.1:3000);
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}

```

配置完成后，重启 Nginx 即可通过 `80` 默认端口访问。

```

---

### 下一步建议
这套文档严格遵循了运维的标准操作流程（SOP）。你只需要通过 SSH 连上你的服务器，照着这份说明书从上往下一行一行敲命令，你的系统就能绝对稳定地在后台跑起来。

连上服务器后，如果你在执行某一步（比如装 PM2 或者装 Node.js）遇到了卡壳，随时把终端的报错信息发给我！

```
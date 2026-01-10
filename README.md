# priceOCR

## 配置环境
- 更新系统源
`sudo apt update && sudo apt upgrade -y`

- 安装基础工具 (git, curl, wget, zip)
`sudo apt install -y git curl wget unzip build-essential`

- nodejs环境
`sudo apt install nodejs`
把npm更新到11.7.0版本


## 项目部署

- git
`git clone https://github.com/bolutotop/PriceOCR.git`

`npm install` 安装依赖

## ocr-engine

- 创建ocr-engine
`mkdir ocr-engine`
### 在ocr-engine内
- 下载 v1.4.1
`wget https://github.com/hiroi-sora/PaddleOCR-json/releases/download/v1.4.1/PaddleOCR-json_v1.4.1_debian_x64_glibc2.31.tar.xz`

- 解压
`tar -xf PaddleOCR-json_v1.4.1_debian_x64_glibc2.31.tar.xz`

- 测试
`./run`
## 数据库
### 部署
`DATABASE_URL="file:./prod.db"`写入 DATABASE_URL="file:./prod.db"

- 生成 Prisma Client (必须)
`npx prisma generate`

- 运行迁移 (这将创建 prod.db 文件)
`npx prisma migrate deploy`

- 执行预设的 seed 脚本
`npx prisma db seed`

- 赋予当前目录写入权限
`chmod 777 prod.db`
`chmod 777 . ` 

### 修改
- 1. 如果你修改了 prisma/schema.prisma (如加了新字段)
`npx prisma migrate deploy`

- 2. 如果你想查看数据库里的数据 (Prisma Studio Web界面)
- 注意：这会在服务器的 5555 端口启动，你需要配置安全组放行 5555 端口
`npx prisma studio`


## 上线

### 不使用Nginx
- 构建生产版本
`npm run build`

- 安装pm2
`npm install -g pm2`

- 使用 PM2 启动 Next.js
`PORT=8080 pm2 start npm --name "ocr-app" -- start` 端口(8080)可选

- 保存当前进程列表 (防止重启服务器后服务丢失)
`pm2 save`
`pm2 startup`

当你修改代码并重新构建生产版本时
- 重启pm2
`pm2 reload "你创建的(ocr-app)"`

### 使用Nginx

- 安装Nginx
`sudo apt install nginx`

- 修改配置

`sudo vim /etc/nginx/sites-available/default`

```js
server {
    listen 80;
    server_name _; # 或者写你的域名

    location / {
        # 把流量转发给你的 Node.js 端口 (比如 3000)
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

- 重启
`sudo systemctl restart nginx`


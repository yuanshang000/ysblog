# 部署指南 —— Vercel

从零到上线的完整步骤。**不需要购买服务器，也不需要绑定信用卡**（Vercel 与 Vercel Postgres 在免费额度内均可直接使用）。

---

## 部署前准备

| 项目 | 要求 |
| --- | --- |
| Node.js | ≥ 20（推荐 22） |
| Vercel 账号 | 免费版即可 |
| GitHub 账号 | 用于代码托管与自动部署 |

---

## 方式一：GitHub 推送自动部署（推荐）

### 1. 导入仓库

1. 登录 [vercel.com](https://vercel.com)
2. 点击 **Add New → Project**
3. 选择 **Import** 你的 GitHub 仓库
4. Framework Preset 选 **Other**

### 2. 创建 Postgres 数据库

1. 项目页 → **Storage** 标签 → **Create Database**
2. 选择 **Neon**（Vercel 官方托管，免费额度足够个人博客）
3. 创建后在数据库详情页点 **Connection String**，复制连接串

### 3. 创建 Blob 存储

1. **Storage** 标签 → **Create Store** → 选择 **Blob**
2. 创建后复制 `BLOB_READ_WRITE_TOKEN`

### 4. 配置环境变量

进入 **Settings → Environment Variables**，逐个添加：

| 变量 | 值 | 是否必填 |
| --- | --- | --- |
| `POSTGRES_URL` | 第2 步复制的连接串 | 必填 |
| `BLOB_READ_WRITE_TOKEN` | 第 3 步复制的令牌 | 必填 |
| `SESSION_SECRET` | `openssl rand -hex 32` 生成 | 必填 |
| `IP_HASH_SALT` | `openssl rand -hex 32` 生成 | 必填 |
| `SITE_URL` | `https://<你的项目名>.vercel.app` | 建议 |
| `CRON_SECRET` | `openssl rand -hex 32` 生成 | 建议 |

> `SESSION_SECRET` 与 `IP_HASH_SALT` 务必使用随机值。
> 前者泄露等同于允许他人伪造登录会话，后者泄露会让统计中的 IP 哈希可被反推。
> 可本地生成：`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`

### 5. 初始化数据库表结构

Vercel 构建时不会自动执行数据库迁移，需要手动跑一次。在项目页右下角打开 **Terminal**：

```bash
npm run db:migrate
npm run db:seed   # 可选：写入演示数据
```

### 6. 首次部署后创建管理员

访问 `https://<你的域名>/admin`，未初始化时会跳转至 `/admin/setup`。

需要先在环境变量中配置 `ADMIN_SETUP_TOKEN`，然后用该令牌、用户名（3-32 位字母数字下划线）、密码（≥10 位含字母和数字）完成初始化。

创建完成后**务必删除 `ADMIN_SETUP_TOKEN` 变量**。

### 7. 后续部署

代码 push 到默认分支即自动部署，无需手动操作。

---

## 方式二：本地 CLI 部署

```bash
# 1. 安装 Vercel CLI
npm i -g vercel

# 2. 登录并关联项目
vercel login
vercel link

# 3. 拉取生产环境变量到本地
vercel env pull .env.local

# 4. 初始化数据库表结构
npm run db:migrate

# 5. 构建并部署
npm run deploy
```

---

## 本地开发

```bash
# 1. 安装依赖
npm install

# 2. 准备环境变量
cp .env.example .env.local
# 编辑 .env.local 填入真实值
#
# 若使用本机 Postgres，可用 Docker 快速起一个：
#   docker run -d --name myblog-pg -p 5432:5432 \
#     -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=myblog postgres:16
#   POSTGRES_URL="postgres://postgres:postgres@localhost:5432/myblog"
#   POSTGRES_SSL="false"

# 3. 初始化表结构 + 演示数据
npm run db:migrate
npm run db:seed

# 4. 启动（Vercel 本地运行时 + 前端构建监听）
npm run dev
```

访问 `http://localhost:3000`，后台在 `/admin`。

演示数据的登录信息为 `admin` / `Demo123456`，**仅用于本地预览**。

---

## 定时任务

`vercel.json` 中配置了每 10 分钟执行一次：

```json
{ "crons": [{ "path": "/api/cron", "schedule": "*/10 * * * *" }] }
```

用于：发布到期文章、清理过期会话、清理过期统计、删除无引用媒体。

> **注意**：Vercel Cron 在 Hobby 计划上每天最多执行一次，Pro 计划无限制。
> 若使用 Hobby 且需要更频繁执行，可改用外部定时器调用 `/api/cron` 端点。
> 该端点会校验 `Authorization: Bearer <CRON_SECRET>`，未配置 `CRON_SECRET`
> 时退化为仅允许携带 Vercel Cron User-Agent 的请求。

---

## 常见问题

### 部署报 `It's necessary to set a POSTGRES_URL environment variable`

环境变量没配或没生效。检查 **Settings → Environment Variables** 中 `POSTGRES_URL` 是否存在于 **Production** 环境（默认勾选），改完变量后需要 **Redeploy** 才会生效。

### 页面可以打开，但所有数据都为空

表结构没建。执行 `npm run db:migrate`（见第 5 步）。

### 图片上传失败

`BLOB_READ_WRITE_TOKEN` 未配置或已失效。重新在 Storage 页面获取令牌并更新环境变量。

### 修改密码报 403「缺少 CSRF 令牌」

这是浏览器残留了旧版本的 HttpOnly Cookie。清空该站点的站点数据（DevTools → Application → Clear site data）后重新登录即可。

### 修改密码后被强制登出

这是预期行为：改密会使该用户所有其他会话失效。

---

## 绑定自定义域名

1. **Settings → Domains → Add**
2. 输入域名，按提示配置 DNS

绑定后请把 `SITE_URL` 环境变量改为 `https://你的域名`，否则 canonical、RSS、Sitemap 中仍是 vercel.app 地址。
# 部署指南

从零到上线的完整步骤。全程不需要购买服务器。

---

## 部署前准备

| 项目 | 要求 |
| --- | --- |
| Node.js | ≥ 20（推荐 22） |
| Cloudflare 账号 | 免费版即可 |
| GitHub 账号 | 用于代码托管与自动部署 |
| 信用卡 | **不必须**。Cloudflare Workers 免费额度足够个人博客使用 |

---

## 第一步：创建 Cloudflare 资源

### 1.1 创建 D1 数据库

```bash
npx wrangler login
npx wrangler d1 create myblog
```

命令会输出类似：

```
🌀 Creating database...
✅ Success! Added database myblog with id "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```

把这个 **database_id** 填入 `wrangler.jsonc`：

```jsonc
"d1_databases": [
  {
    "binding": "DB",
    "database_name": "myblog",
    "database_id": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
    "migrations_dir": "migrations"
  }
]
```

### 1.2 创建 R2 存储桶

```bash
npx wrangler r2 bucket create myblog-media
```

> R2 需要绑定信用卡才能创建（免费额度：10GB 存储 + 每月 1000 万次写操作 + 1000 万次读操作）。

### 1.3 执行数据库迁移

```bash
npm run db:migrate:remote
```

预期输出：

```
┌───────────────┬────────┐
│ name          │ status │
├───────────────┼────────┤
│ 0001_init.sql │ ✅     │
└───────────────┴────────┘
```

---

## 第二步：配置密钥（Secrets）

密钥**绝不写入代码或 Git 仓库**。用 Wrangler 命令设置：

```bash
# 会话令牌哈希盐 —— 必填，用于会话与限流的安全隔离
npx wrangler secret put SESSION_SECRET

# IP 哈希盐 —— 必填，统计与限流使用，不存原始 IP
npx wrangler secret put IP_HASH_SALT

# 初始化令牌 —— 仅首次创建管理员需要，创建后建议删除
npx wrangler secret put ADMIN_SETUP_TOKEN
```

每个命令会提示输入值，输入时不会回显。

> **为什么需要这些？**
> `SESSION_SECRET` 参与会话 token 的哈希运算，数据库泄露时若无此盐，攻击者可直接还原有效 token。
> `IP_HASH_SALT` 保证 IP 哈希不可逆推。
> 两者都必须使用**随机且唯一**的值（可用 `openssl rand -hex 32` 生成）。

---

## 第三步：本地验证

```bash
npm install
npm run db:migrate:local
npm run dev
```

访问 `http://127.0.0.1:8787` 查看前台，`http://127.0.0.1:8787/admin` 查看后台。

---

## 第四步：创建管理员账号

### 方式 A：通过初始化页面（推荐）

1. 先部署（见下一步），或本地启动
2. 访问 `/admin`，未初始化时会自动跳转到 `/admin/setup`
3. 填入 `ADMIN_SETUP_TOKEN`、用户名（3-32 位字母数字下划线）、密码（≥10 位含字母和数字）

### 方式 B：本地生成哈希后写库

```bash
npm run setup:admin -- --username admin
```

脚本会输出可直接执行的 SQL 命令（密码不会出现在日志或命令历史中）。

---

## 第五步：部署到 Cloudflare

```bash
npm run deploy
```

部署完成后访问 `https://<你的子域>.workers.dev`。

**首次部署后立刻做：**

```bash
# 删除初始化令牌，防止被他人创建账号
npx wrangler secret delete ADMIN_SETUP_TOKEN
```

---

## 第六步：绑定自定义域名（可选）

1. Cloudflare 控制台 → Workers & Pages → `myblog` → Settings → Triggers → Custom Domains
2. 添加域名，例如 `blog.example.com`

绑定后请到**后台 → 站点设置 → 基础信息**把「站点 URL」改为 `https://blog.example.com`，
否则 canonical、OG、Sitemap、RSS 里的地址仍是 workers.dev 域名。

---

## GitHub 自动部署

### 1. 推送代码

```bash
git init
git add .
git commit -m "feat: MyBlog 初始版本"
git branch -M main
git remote add origin https://github.com/<你的用户名>/my-blog.git
git push -u origin main
```

### 2. 在 Cloudflare 连接 GitHub

1. Cloudflare 控制台 → Workers & Pages → Create → **Connect to Git**
2. 选择 `my-blog` 仓库
3. **构建配置**：

| 配置项 | 值 |
| --- | --- |
| Build command | `npm ci && npm run build` |
| Deploy command | `npx wrangler deploy` |
| Root directory | 留空（仓库根目录） |
| Build output directory | `apps/worker/public` |

4. 环境变量：把 `vars` 中的配置填入（`SESSION_SECRET` 等敏感值在 Settings → Variables and Secrets 中设为 **Secret** 类型）

之后每次 push 到 `main` 即自动构建部署。

### 3. 数据库迁移的注意事项

GitHub 自动部署**不会**自动执行迁移（避免未验证的脚本改动生产库）。正确流程：

```bash
# 1. 先在本地验证迁移脚本
npm run db:migrate:local

# 2. 确认无误后手动执行线上迁移
npm run db:migrate:remote
```

---

## 费用控制

Cloudflare 各服务的免费额度（**以官网最新说明为准**，政策可能调整）：

| 服务 | 免费额度（官方公布） |
| --- | --- |
| Workers 请求 | 100,000 次/天 |
| Workers CPU 时间 | 10ms/次请求（免费版） |
| D1 | 5GB 存储，500 万行读取/天，10 万行写入/天 |
| R2 | 10GB 存储，每月 1000 万次写 + 1000 万次读 |
| Cron Triggers | 5 个任务 |
| Pages/静态资源 | 无限制 |

个人博客的日常流量远在免费额度之内。控制成本的实践：

- 图片启用懒加载与长期缓存（已内置）
- 内容页 `Cache-Control: no-cache` 但带 ETag，避免重复回源计算
- 静态资源长缓存 + 内容哈希文件名
- 访问统计异步写入（`waitUntil`），不阻塞响应
- 定时任务只做必要清理，不做高频轮询

> ⚠️ 上线前请到 Cloudflare 控制台确认当前套餐的实际配额与计费规则。

---

## 环境变量说明

### 普通变量（可公开，写在 `wrangler.jsonc` 的 `vars`）

| 键 | 默认值 | 说明 |
| --- | --- | --- |
| `ENVIRONMENT` | `production` | 环境标识 |
| `SITE_URL` | 空 | 站点公开地址，如 `https://blog.example.com`。影响 canonical / OG / RSS |
| `ALLOWED_ORIGINS` | 空 | 额外允许的后台来源，逗号分隔。缺省用请求自身 origin |
| `MAX_UPLOAD_MB` | `10` | 单文件上传大小上限 |
| `ALLOW_SVG` | `false` | 是否允许 SVG。**默认关闭**，SVG 可含脚本 |

### 敏感变量（必须用 Secret）

| 键 | 说明 |
| --- | --- |
| `SESSION_SECRET` | 会话哈希盐 |
| `IP_HASH_SALT` | IP 哈希盐 |
| `ADMIN_SETUP_TOKEN` | 初始化令牌，初始化后删除 |

---

## 回滚

### 代码回滚

```bash
# Cloudflare 控制台 → Workers → myblog → Deployments
# 选择历史版本 → Rollback
```

或用 Wrangler：

```bash
npx wrangler deployments list
npx wrangler rollback <deployment-id>
```

### 数据库回滚

**本项目的迁移全部是增量且向后兼容的**（只新增表/索引，无破坏性变更），因此代码回滚不会导致数据库不可用。

若需回滚数据：

```bash
npx wrangler d1 execute myblog --remote --file=./backups/<时间戳>/database.sql
```

---

## 故障排查

| 现象 | 排查方向 |
| --- | --- |
| 前台 500 | `npx wrangler tail` 看实时日志；检查 D1 绑定是否正确 |
| 后台一直跳登录 | 检查 `SESSION_SECRET` 是否已在生产环境设置；Cookie 域名是否匹配 |
| 上传失败 | 确认 R2 桶已创建并绑定；检查文件大小是否超限 |
| 图片 404 | 确认 `apps/worker/public` 已随代码部署；检查对象键是否正确 |
| 定时发布不执行 | `npx wrangler tail` 观察 cron；确认 `triggers.crons` 配置正确 |
| 文章不显示 | 检查文章状态是否为 `published`；草稿不会出现在前台 |
| 中文 slug 异常 | 确认请求体为 UTF-8 编码 |
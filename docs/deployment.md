# 部署指南

从零到上线的完整步骤。全程不需要购买服务器。

> 只想快速上手？README 的「部署」章节提供了同样的两种方式（GitHub Actions 一键部署 / 本地手动部署）的精简版，可先看那里再回到本文档查细节。

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

本项目采用**GitHub Actions**（不是 Cloudflare 内置的 Git 集成），原因见下方说明。

### 为什么不用 Cloudflare 内置 Git 集成

Cloudflare 控制台的 Workers Git 集成有三个限制：

1. **没有 Build output directory** —— 那是 Pages 才有的字段；Workers 的产物由 `wrangler deploy` 自行上传
2. **无法在部署前执行数据库迁移** —— 迁移必须单独跑
3. **Node 版本固定死**（通常 18/20），无法选择

GitHub Actions 可完全控制流程：类型检查 → 测试 → 构建 → 迁移 → 部署，任一步失败即中止。

工作流文件已包含在仓库中：`.github/workflows/deploy.yml`（62 行，10 个步骤）。

### 1. 推送代码

```bash
git init
git add .
git commit -m "feat: MyBlog 初始版本"
git branch -M main
git remote add origin https://github.com/<你的用户名>/my-blog.git
git push -u origin main
```

### 2. 配置 GitHub Secrets

仓库 → Settings → Secrets and variables → Actions → New repository secret：

| Secret 名称 | 值 | 获取方式 |
| --- | --- | --- |
| `CLOUDFLARE_API_TOKEN` | Workers 部署令牌 | Cloudflare → My Profile → API Tokens → Create Token，选模板 **Edit Cloudflare Workers** |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare 账户 ID | Cloudflare 控制台右侧边栏可见 |

### 3. 首次启用

推送到 `main` 即自动触发。可在仓库 Actions 页面查看执行日志。

工作流执行顺序：

```
checkout → setup-node（npm 缓存） → npm ci → 类型检查 → 单元测试
        → build:ci（含产物完整性校验） → 拉取凭据
        → 数据库迁移 → wrangler deploy
```

任一步失败都会中止，不会部署半成品。

### 关键命令说明

```bash
npm ci                # 严格按 lock 安装（CI 用）
npm run build:ci      # 清理 + 构建前台 + 构建后台 + 校验产物
npm run typecheck     # Worker tsc + 后台vue-tsc
```

`build:ci` 末尾会执行 `scripts/verify-build-assets.mjs`，校验：

- `islands/app.js` 存在且体积合理
- `admin/app.htm` 存在、含挂载点、引用资源全部真实存在

这一步能在部署前拦住「后台资源缺失导致白屏」类问题——因为这类问题在 `wrangler deploy` 时不会报错。

### 常见构建失败与处理

| 报错 | 原因 | 处理 |
| --- | --- | --- |
| `npm ci can only install packages when... in sync` | lock 文件缺当前平台的二进制包（Windows 上生成时只记录 win32） | 运行 `npm run fix:lock` 补全，然后提交 lock |
| `Missing: fsevents@2.3.3 from lock file` | 同上 | `npm run fix:lock` |
| 后台部署后白屏 | `admin/app.htm` 缺失 | 本地跑 `npm run build:ci` 看校验输出 |
| 部署报找不到 D1 | `wrangler.jsonc` 里`database_id` 仍是占位符 | 填入真实 ID |
| 部署成功但接口 500 | 未配置 `SESSION_SECRET` 等 Secret | `npx wrangler secret put SESSION_SECRET` |

### lock 文件的平台包问题（重要）

npm 生成 `package-lock.json` 时**只记录当前操作系统**的二进制可选依赖。在 Windows 上开发时，
lock 里只有 `win32-x64`，而 Cloudflare 的构建环境是 Linux，`npm ci` 会直接失败。

本项目提供了修复脚本：

```bash
npm run fix:lock   # 补全所有平台的 esbuild / rollup 二进制包
```

脚本会从 npm registry 抓取各平台的真实 integrity 与 tarball 地址后写入 lock，
并跳过 registry 上不存在的平台（如 `@rollup/rollup-linux-arm64` 实际不存在，属正常）。

**若在 Windows 上新增了依赖，务必重新执行一次 `npm run fix:lock` 再提交 lock。**

### 数据库迁移说明

本工作流**已包含**迁移步骤（部署前执行）。若迁移失败，部署不会继续 —— 这正是期望行为：
避免代码已部署但表结构不匹配导致运行时 500。

本地验证迁移：

```bash
npm run db:migrate:local   # 在 .tmp/d1 本地库执行
```

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

**本项目的迁移以增量且向后兼容为主**（新增表/索引、无破坏性变更），因此代码回滚不会导致数据库不可用。

例外：`0002_menu_open_in_new.sql` 为落实 `menus.open_in_new` 的新默认值，
采用「建新表 → 拷贝数据 → 删旧表 → 改名」的重建方式。该迁移内部使用事务，
失败会整体回滚，且执行前已确认无任何外键引用 `menus` 表；数据本身不丢失，
但仍建议按下方流程在执行前备份。

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
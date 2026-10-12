# MyBlog 个人博客系统

一套自托管在 Vercel 上的个人博客：**Vue 3 服务端渲染前台 + Vue 3 管理后台 + Vercel Functions + Postgres + Blob**。

无需购买服务器，不依赖 Nginx / PHP / MySQL，推送 GitHub 即自动部署。

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/yuanshang000/ysblog)

---

## 页面预览

以下截图全部截自**线上真实运行实例**（`https://ysblog-pi.vercel.app`），非设计稿、非本地模拟。

### 前台首页（日间主题）

个人简介、精选文章、最新文章一屏呈现。导航为页面内路由跳转，无整页刷新。

![首页](docs/images/home.png)

### 文章详情

服务端渲染的完整正文，支持表格、代码高亮、引用、右侧目录随滚动高亮。

![文章详情](docs/images/post-detail.png)

### 夜间主题（淡灰）

独立配色而非简单反色，`<head>` 内联脚本确定主题，切换时无闪烁。日间为淡棕黄、夜间为淡灰，两套均为浅底深字，正文对比度均达 WCAG AAA 级。

![夜间主题](docs/images/post-detail-gray.png)

### 文章列表与归档

按时间倒序排列，支持分页；归档页按年月分组。

| 文章列表 | 归档 |
| --- | --- |
| ![文章列表](docs/images/post-list.png) | ![归档](docs/images/archives.png) |

### 分类与标签

| 分类 | 标签 |
| --- | --- |
| ![分类](docs/images/categories.png) | ![标签](docs/images/tags.png) |

### 关于、友链与搜索

| 关于我 | 友情链接 | 搜索 |
| --- | --- | --- |
| ![关于](docs/images/about.png) | ![友链](docs/images/links.png) | ![搜索](docs/images/search.png) |

### 移动端适配

同一套响应式布局，移动端折叠为抽屉式导航。

![移动端](docs/images/home-mobile.png)

### 管理后台登录

![后台登录](docs/images/admin-login.png)

### 工作台

访问趋势、热门文章与最近操作日志一览。

![工作台](docs/images/admin-dashboard.png)

### 文章管理

![文章管理](docs/images/admin-posts.png)

### Markdown 编辑器

三栏布局：左侧大纲、中间编辑、右侧属性（发布状态、URL 别名、分类标签、SEO）。支持 1.5 秒防抖自动保存与实时预览。

![编辑器](docs/images/admin-editor.png)

### 媒体库与评论

| 媒体库 | 评论管理 |
| --- | --- |
| ![媒体库](docs/images/admin-media.png) | ![评论管理](docs/images/admin-comments.png) |

### 菜单与外观、站点设置

| 菜单与外观 | 站点设置 |
| --- | --- |
| ![菜单与外观](docs/images/admin-appearance.png) | ![站点设置](docs/images/admin-settings.png) |

---

## 核心特性

| 能力 | 说明 |
| --- | --- |
| 前台 SSR | 文章内容由服务端渲染成 HTML，搜索引擎与禁用 JS 的场景都能完整阅读 |
| 页面内路由 | 站内导航拦截后仅替换主体内容，同步标题与地址栏，支持前进后退；失败自动回退整页跳转 |
| 双主题 | 日间淡棕黄、夜间淡灰，另可跟随系统；`<head>` 内联脚本决定主题，切换无闪烁 |
| 极简写作 | 三栏编辑器、1.5 秒防抖自动保存、本地草稿兜底、多标签页冲突检测 |
| Markdown | 安全渲染（原始 HTML 一律转义），支持代码高亮、表格、数学公式、目录锚点、图片灯箱 |
| 图片管理 | 上传至 Blob，自动嗅探真实类型、提取宽高、去重、引用检查后删除 |
| SEO | 每篇独立 title/description/canonical/robots，自动生成 Sitemap、RSS、结构化数据 |
| 定时发布 | Vercel Cron 每日检查，到点自动发布并写入操作日志 |
| 访问统计 | 只存 IP 加盐哈希；独立访客按（访客 + 日期）去重，机器人流量自动排除 |
| 安全 | PBKDF2 密码哈希、会话仅存哈希、HttpOnly+SameSite Cookie、双提交 CSRF、参数化 SQL、上传白名单 |

---

## 技术栈

```
前端前台  Vue 3 + Vite + TypeScript（SSR + 渐进增强岛）
管理后台  Vue 3 + TypeScript + Element Plus + Pinia
样式      设计令牌驱动的 CSS 设计系统（无 UI 框架依赖，零样式冲突）
API       Vercel Functions（Node.js 运行时）+ TypeScript
数据库    Vercel Postgres（PostgreSQL 16）
文件存储  Vercel Blob
定时任务  Vercel Cron
部署      Vercel CLI + GitHub 自动部署
```

---

## 部署

### 方式一：一键部署（推荐）

点击顶部按钮，或访问：

```
https://vercel.com/new/clone?repository-url=https://github.com/yuanshang000/ysblog
```

导入后 Vercel 会自动识别并完成首次构建。**但数据库和存储需要你手动创建**，因为它们无法由平台自动分配——请继续往下走「方式二」的第 2、3 步完成配置，再重新部署一次。

---

### 方式二：控制台导入（完整步骤）

#### 第 1 步：导入仓库

登录 [vercel.com](https://vercel.com) → **Add New → Project** → **Import** 选择本仓库，Framework Preset 选 **Other**。

项目设置保持默认即可，仓库已内置 `vercel.json`：

| 配置项 | 值 | 说明 |
| --- | --- | --- |
| Build Command | `npm run build:vercel` | 构建前台 + 后台 + 预编译 Worker |
| Output Directory | `apps/worker/public` | 静态产物目录 |
| Install Command | `npm install` | npm workspaces |

> **关于 Functions 入口**：Vercel 只识别**项目根目录**下的 `api/`，所以入口文件是 `api/index.ts`，它会加载构建阶段由 esbuild 产出的 `dist-server/_worker.mjs`。这一层是协议适配代码，业务逻辑本身与平台无关。

#### 第 2 步：创建数据库与存储

在项目页的 **Storage** 标签下：

- **Create Database → Neon**：创建后 Vercel 会**自动注入** `POSTGRES_URL` 等环境变量，无需手动复制连接串
- **Create Store → Blob**：创建后同样自动注入 `BLOB_READ_WRITE_TOKEN`

> 若你的账号界面里没有 Neon 选项，也可以在 [Neon 控制台](https://console.neon.tech) 手动创建，然后回到 Vercel 用 **Integrations → Neon** 关联，同样会自动注入变量。

#### 第 3 步：配置环境变量

在 **Settings → Environment Variables** 中补充以下变量（数据库和 Blob 的变量已由第 2 步自动注入）：

| 变量 | 是否必填 | 说明 |
| --- | --- | --- |
| `SESSION_SECRET` | 必填 | 会话令牌哈希盐，泄露等同于可伪造会话 |
| `IP_HASH_SALT` | 必填 | IP 哈希盐，保证统计数据不可逆推 |
| `SITE_URL` | 建议 | `https://<项目名>.vercel.app`，影响 RSS、Sitemap 与 canonical |
| `CRON_SECRET` | 建议 | 校验 Vercel Cron 请求，留空则仅允许 Cron 的 User-Agent |
| `ADMIN_SETUP_TOKEN` | 首次需要 | 一次性初始化令牌，创建管理员后请删除 |
| `MAX_UPLOAD_MB` | 可选 | 单文件上传上限，默认 10 |
| `ALLOW_SVG` | 可选 | 默认 `false`（SVG 默认禁用） |

生成随机值：

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

完整变量清单与逐项说明见 [`.env.example`](.env.example)。

#### 第 4 步：初始化数据库表结构

**Vercel 构建不会自动跑迁移**，需在项目页的 **Terminal** 中执行一次：

```bash
npm run db:migrate
npm run db:seed     # 可选：写入演示数据
```

迁移会创建 18 张业务表 + 34 个索引，脚本可重复执行（已迁移的不会重复建表）。

#### 第 5 步：创建管理员

访问 `https://<你的域名>/admin`，未初始化会跳转至 `/admin/setup`。

需先配置 `ADMIN_SETUP_TOKEN` 环境变量用于一次性初始化，**完成后立刻删除该变量**，防止他人创建账号。

之后每次 `git push` 即自动部署。

---

### 方式三：本地 CLI 部署

适合习惯在本地管理环境变量的场景。

```bash
npm install -g vercel

vercel login
vercel link --yes --project=<项目名> --scope=<你的团队>

# 拉取生产环境变量到本地（迁移脚本需要）
vercel env pull .env.local

npm run db:migrate        # 初始化表结构
npm run db:seed           # 可选：演示数据

npm run deploy            # 构建并部署到生产
```

> **注意**：Hobby 套餐的 Cron 每天最多只能执行一次，因此 `vercel.json` 里的定时发布任务配置为每天 03:00 UTC。需要更频繁的调度请升级到 Pro 套餐并调整 `crons[].schedule`。

---

### 本地开发

```bash
npm install
cp .env.example .env.local   # 填入数据库连接串等

npm run db:migrate
npm run db:seed              # 可选：演示数据

npm run dev                  # http://localhost:3000
```

`npm run dev` 会同时启动三端：Vercel 本地运行时（Functions）、前台构建监听、后台 Vite 开发服务器。

若想用本机 Postgres，可用 Docker 快速起一个：

```bash
docker run -d --name myblog-pg -p 5432:5432 \
  -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=myblog postgres:16
```

对应 `.env.local`：

```ini
POSTGRES_URL="postgres://postgres:postgres@localhost:5432/myblog"
POSTGRES_SSL="false"
```

---

### 部署后必做

| 事项 | 说明 |
| --- | --- |
| 修改管理员密码 | 初始化密码强度较弱，务必在「站点设置 → 安全」中修改 |
| 删除 `ADMIN_SETUP_TOKEN` | 在环境变量中移除，防止他人创建账号 |
| 更新 `SITE_URL` | 绑定自定义域名后同步修改，影响 RSS 与站点地图 |
| 关闭 Deployment Protection | 若 Vercel 提示开启了 Vercel Authentication，需在项目设置中关闭，否则访客会看到登录拦截页 |

更完整的说明见 [`docs/deployment.md`](docs/deployment.md)。

---

## 常用命令

```bash
npm run dev                 # 本地开发（三端并行）
npm run build               # 清理并构建前台 + 后台
npm run build:vercel        # 完整构建（含 Worker 预编译，供 Vercel 使用）
npm run typecheck           # 前后端类型检查
npm test                    # 单元测试（122 个用例）
npm run db:migrate          # 初始化 / 更新数据库表结构
npm run db:seed             # 写入演示数据
npm run db:setup-admin      # 命令行创建 / 重置管理员
npm run db:backup           # 备份数据库 + 图片
npm run import:md           # 批量导入 Markdown 文章
npm run deploy              # 构建并部署到 Vercel
```

---

## 目录结构

```
my-blog/
├── api/
│   └── index.ts             Vercel Functions 入口（协议适配层）
├── apps/
│   ├── web/                  前台交互岛（渐进增强）
│   │   └── src/islands/main.ts 主题/目录/进度/灯箱/搜索/评论/路由
│   ├── admin/                后台管理 SPA
│   │   └── src/views/         12 个页面（工作台/编辑器/媒体库…）
│   └── worker/
│       └── src/
│           ├── index.ts       应用主逻辑（平台无关的 Web 标准代码）
│           ├── routes/        公开 API / 管理 API / 评论 / RSS
│           ├── repositories/  全部 SQL（参数化查询）
│           ├── services/      设置读写 / SSR 页面渲染
│           ├── lib/
│           │   ├── db-adapter.ts  Postgres 适配层（含 SQLite 方言转换）
│           │   ├── blob-store.ts   Vercel Blob 封装
│           │   ├── auth.ts         会话与 CSRF
│           │   ├── crypto.ts       PBKDF2 密码哈希
│           │   └── context.ts      请求上下文
│           └── jobs/            定时任务
├── packages/shared/          三端共用
│   ├── types.ts              数据契约
│   ├── markdown.ts           安全 Markdown 渲染器
│   ├── html-shell.ts         前台设计系统 + HTML 外壳
│   └── settings-schema.ts    设置项单一事实来源
├── migrations/postgres/      数据库迁移（PostgreSQL）
│   └── 0001_init.sql         建表（18 张表 / 34 个索引）
├── scripts/                  构建、迁移、种子与备份脚本
├── tests/                    单元测试
├── docs/                     部署 / API / 备份文档
│   └── images/               README 截图
└── vercel.json               Vercel 部署配置
```

---

## 文档

| 文档 | 内容 |
| --- | --- |
| **[docs/deployment.md](docs/deployment.md)** | **部署指南：Vercel 导入部署 / CLI 部署 / 本地开发 / 常见问题** |
| **[docs/howto.md](docs/howto.md)** | **日常操作手册：更新代码如何部署 + 如何批量导入文章** |
| [docs/api.md](docs/api.md) | 全部 REST API 接口说明 |
| [docs/backup-restore.md](docs/backup-restore.md) | 数据备份与恢复 |
| [docs/architecture.md](docs/architecture.md) | 架构决策与安全设计 |

---

## 已验证能力

以下均为**真实运行验证通过**，非模拟：

- 登录 → 建文章 → 自动保存 → 发布 → 前台可见 全链路
- 版本冲突正确返回 409，CSRF 缺失正确返回 403
- 22 个 XSS 攻击向量全部被拦截（含 `javascript:` 绕过、属性逃逸、编码混淆）
- 危险文件（`.sh`）被拒绝，SVG 默认禁用
- 全部前台页面 SSR 输出正常（含 404、归档、分类、标签、搜索、关于、友链）
- 后台 SPA 全部路由可访问，全程无 5xx
- 未登录打开后台不再产生 401 报错（登录态守卫 + 会话 Cookie 启发式判断）
- 122 个单元测试通过，前后端类型检查零错误
- SQLite → Postgres 方言转换有 15 项专项测试覆盖
- 日间 / 夜间两套主题实测对比度分别为 11.03:1 与 11.01:1，均达 WCAG AAA

安全与页面内路由的专项验证：

- CSRF 双提交实测：登录后 `mb_csrf` 不带 `HttpOnly`（前端可读），`mb_session` 仍带；
  缺失令牌返回 403，携带令牌改密码返回 200
- 页面内路由实测：线上导航全部标记为路由链接，无整页刷新

---

## 浏览器支持

现代浏览器（Chrome / Edge / Safari / Firefox 最近两个大版本）。

使用了 CSS `color-mix()`、`aspect-ratio`、AbortController 等现代特性。

---

## 许可

MIT

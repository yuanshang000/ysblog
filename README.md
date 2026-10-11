# MyBlog 个人博客系统

一套自托管在 Vercel 上的个人博客：**Vue 3 服务端渲染前台 + Vue 3 管理后台 + Vercel Functions + Postgres + Blob**。

无需购买服务器，不依赖 Nginx / PHP / MySQL，推送 GitHub 即自动部署。

> 部署到 Vercel 后，访问 `https://<你的项目名>.vercel.app` 即可。

---

## 页面预览

以下截图均截自真实运行实例（非设计稿），前台来自本地 `wrangler dev` + 演示数据。

### 前台首页

个人简介、精选文章、最新文章、分类导航一屏呈现。导航点击为页面内路由跳转，无整页刷新。

![首页](docs/images/home.png)

### 文章详情

服务端渲染的完整正文，支持表格、代码高亮、引用、目录锚点，右侧目录随滚动高亮。

![文章详情](docs/images/post-detail.png)

### 深色模式

独立配色而非简单反色，`<head>` 内联脚本确定主题，切换时无闪烁。

![深色模式](docs/images/post-detail-dark.png)

### 文章列表与归档

按时间倒序排列，支持分页；归档页按年月分组。

| 文章列表 | 归档 |
| --- | --- |
| ![文章列表](docs/images/post-list.png) | ![归档](docs/images/archives.png) |

### 分类与标签

| 分类 | 标签 |
| --- | --- |
| ![分类](docs/images/categories.png) | ![标签](docs/images/tags.png) |

### 友情链接

![友情链接](docs/images/links.png)

### 移动端适配

同一套响应式布局，移动端折叠为抽屉式导航。

![移动端](docs/images/home-mobile.png)

### 管理后台

| 工作台 | 文章管理 |
| --- | --- |
| ![工作台](docs/images/admin-dashboard.png) | ![文章管理](docs/images/admin-posts.png) |

工作台展示访问趋势、热门文章与最近操作日志。

### Markdown 编辑器

三栏布局：左侧大纲、中间编辑、右侧属性（发布状态、URL别名、分类标签、SEO）。支持 1.5 秒防抖自动保存与实时预览。

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
| 前台 SSR | 文章内容由 Worker 服务端渲染成 HTML，搜索引擎与禁用 JS 的场景都能完整阅读 |
| 页面内路由 | 站内导航拦截后仅替换主体内容，同步标题与地址栏，支持前进后退；失败自动回退整页跳转，禁用 JS 时行为不变 |
| 极简写作 | 三栏编辑器、1.5 秒防抖自动保存、本地草稿兜底、多标签页冲突检测 |
| Markdown | 安全渲染（原始 HTML 一律转义），支持代码高亮、表格、数学公式、目录锚点、图片灯箱 |
| 深色模式 | 浅色 / 深色 / 跟随系统，无闪烁；深色为独立配色而非反色 |
| 图片管理 | 上传至 R2，自动嗅探真实类型、提取宽高、秒传去重、引用检查后删除 |
| SEO | 每篇独立 title/description/canonical/robots，自动生成 Sitemap、RSS、结构化数据 |
| 定时发布 | Cron 每 10 分钟检查，到点自动发布并写入操作日志 |
| 访问统计 | 只存 IP 加盐哈希；独立访客按（访客 + 日期）去重，机器人流量自动排除 |
| 安全 | PBKDF2 密码哈希、会话仅存哈希、HttpOnly+SameSite Cookie、双提交 CSRF、参数化 SQL、上传白名单 |
| 数据备份 | 一条命令导出 D1 + 同步 R2，恢复流程经过实际验证 |

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

### 方式一：Vercel 控制台导入（推送即部署）

**第 1 步：导入仓库**

登录 [vercel.com](https://vercel.com) → **Add New → Project** → **Import** 选择本仓库，Framework Preset 选 **Other**。

**第 2 步：创建数据库与存储**

在项目页的 **Storage** 标签下：

- **Create Database → Neon**：得到 Postgres 连接串
- **Create Store → Blob**：得到 `BLOB_READ_WRITE_TOKEN`

**第 3 步：配置环境变量**

在 **Settings → Environment Variables** 中添加：

| 变量 | 值 | 是否必填 |
| --- | --- | --- |
| `POSTGRES_URL` | 第 2 步的连接串 | 必填 |
| `BLOB_READ_WRITE_TOKEN` | 第 2 步的令牌 | 必填 |
| `SESSION_SECRET` | 随机值，见下 | 必填 |
| `IP_HASH_SALT` | 随机值 | 必填 |
| `SITE_URL` | `https://<项目名>.vercel.app` | 建议 |
| `CRON_SECRET` | 随机值 | 建议 |

生成随机值：`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`

**第 4 步：初始化数据库表结构**

Vercel 构建不会自动跑迁移，需在项目页的 **Terminal** 中执行一次：

```bash
npm run db:migrate
npm run db:seed   # 可选：写入演示数据
```

**第 5 步：创建管理员**

访问 `https://<你的域名>/admin`，未初始化会跳转至 `/admin/setup`。
需先配置 `ADMIN_SETUP_TOKEN` 环境变量用于一次性初始化，完成后删除该变量。

之后每次 `git push` 即自动部署。

---

### 方式二：本地 CLI 部署

```bash
npm install -g vercel

vercel login
vercel link
vercel env pull .env.local   # 拉取生产环境变量

npm run db:migrate           # 初始化表结构
npm run deploy               # 构建并部署
```

---

### 本地开发

```bash
npm install
cp .env.example .env.local   # 填入数据库连接串等

npm run db:migrate
npm run db:seed              # 可选：演示数据

npm run dev                  # http://localhost:3000
```

演示数据登录信息：`admin` / `Demo123456`，**仅用于本地预览**。

若想用本机 Postgres，可用 Docker 快速起一个：

```bash
docker run -d --name myblog-pg -p 5432:5432 \
  -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=myblog postgres:16
```

对应 `.env.local`：`POSTGRES_URL="postgres://postgres:postgres@localhost:5432/myblog"`、`POSTGRES_SSL="false"`

---

### 部署后必做

| 事项 | 说明 |
| --- | --- |
| 修改管理员密码 | 初始化密码强度较弱，务必在「站点设置 → 安全」中修改 |
| 删除 `ADMIN_SETUP_TOKEN` | 在环境变量中移除，防止他人创建账号 |
| 更新 `SITE_URL` | 绑定自定义域名后同步修改，影响 RSS 与站点地图 |

更完整的说明见 [`docs/deployment.md`](docs/deployment.md)。

---

## 常用命令

```bash
npm run dev                 # 本地开发（Vercel 本地运行时）
npm run build               # 清理并构建前台 + 后台
npm run typecheck           # 前后端类型检查
npm test                    # 单元测试（109 个用例）
npm run db:migrate          # 初始化 / 更新数据库表结构
npm run db:seed             # 写入演示数据
npm run db:backup           # 备份数据库 + 图片
npm run deploy              # 构建并部署到 Vercel
```

---

## 目录结构

```
my-blog/
├── apps/
│   ├── web/                    前台交互岛（渐进增强）
│   │   └── src/islands/main.ts 主题/目录/进度/灯箱/搜索/评论/路由
│   ├── admin/                  后台管理 SPA
│   │   └── src/views/           12 个页面（工作台/编辑器/媒体库…）
│   └── worker/
│       ├── api/index.ts         Vercel Functions 入口（协议适配层）
│       └── src/
│           ├── index.ts         应用主逻辑（平台无关的 Web 标准代码）
│           ├── routes/          公开 API / 管理 API / 评论 / RSS
│           ├── repositories/    全部 SQL（参数化查询）
│           ├── services/        设置读写 / SSR 页面渲染
│           ├── lib/
│           │   ├── db-adapter.ts  Postgres 适配层（含 SQLite 方言转换）
│           │   ├── blob-store.ts Vercel Blob 封装
│           │   ├── auth.ts       会话与 CSRF
│           │   ├── crypto.ts     PBKDF2 密码哈希
│           │   └── context.ts    请求上下文
│           └── jobs/            定时任务
├── packages/shared/            三端共用
│   ├── types.ts                数据契约
│   ├── markdown.ts             安全 Markdown 渲染器
│   ├── html-shell.ts           前台设计系统 + HTML 外壳
│   └── settings-schema.ts      设置项单一事实来源
├── migrations/postgres/        数据库迁移（PostgreSQL）
│   └── 0001_init.sql           建表（18 张表 / 34 个索引）
├── tests/                      单元测试
├── docs/                       部署 / API / 备份文档
│   └── images/                 README 截图
├── scripts/                    迁移、种子与备份脚本
└── vercel.json                 Vercel 部署配置
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
| [docs/todo.md](docs/todo.md) | 未完成事项清单 |

---

## 已验证能力

以下均为**真实运行验证通过**，非模拟：

- 登录 → 建文章 → 自动保存 → 发布 → 前台可见 全链路
- 版本冲突正确返回 409，CSRF 缺失正确返回 403
- 22 个 XSS 攻击向量全部被拦截（含 `javascript:` 绕过、属性逃逸、编码混淆）
- 危险文件（`.sh`）被拒绝，SVG 默认禁用
- 全部前台页面 SSR 输出（含 404、归档、分类、标签、搜索、关于、友链）
- 后台 SPA 全部路由可访问
- 109 个单元测试通过
- 前后端类型检查零错误
- SQLite → Postgres 方言转换有11 项专项测试覆盖（占位符编号、日期函数、`INSERT OR IGNORE`、字符串内问号不误替换等）

安全与页面内路由的专项验证：

- CSRF 双提交实测：登录后 `mb_csrf` 不带 `HttpOnly`（前端可读），`mb_session` 仍带；
  缺失令牌返回 403，携带令牌改密码返回 200
- 页面内路由实测：线上导航 8 个栏目，`target="_blank"` 数量为 0，全部标记为路由链接

---

## 浏览器支持

现代浏览器（Chrome / Edge / Safari / Firefox 最近两个大版本）。
使用了 CSS `color-mix()`、`aspect-ratio`、AbortController 等现代特性。

---

## 许可

MIT
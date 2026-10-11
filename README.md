# MyBlog 个人博客系统

一套自托管在 Cloudflare 上的个人博客：**Vue 3 服务端渲染前台 + Vue 3 管理后台 + Cloudflare Workers API + D1 + R2**。

无需购买服务器，不依赖 Nginx / PHP / MySQL，推送 GitHub 即自动部署。

**在线体验**：<https://myblog.yuanshang000.workers.dev>

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
API       Cloudflare Workers + TypeScript
数据库    Cloudflare D1（SQLite 兼容语法）
文件存储  Cloudflare R2
定时任务  Cloudflare Cron Triggers
部署      Wrangler + GitHub Actions
```

---

## 部署

### 方式一：一键部署（GitHub Actions 自动）

仓库已内置 [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml)，**推送即部署**，无需手动执行任何命令。

**第 1 步：Fork 本仓库**

**第 2 步：配置 Secrets**

进入仓库 `Settings` → `Secrets and variables` → `Actions` → `New repository secret`，添加：

| Secret | 说明 | 获取方式 |
| --- | --- | --- |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare 账号 ID | 控制台右侧边栏，或 `npx wrangler whoami` |
| `CLOUDFLARE_API_TOKEN` | API 令牌 | 见下方说明 |

> **API Token 权限**（创建令牌时按需勾选）：
> - `Account` → `Workers Scripts` → `Edit`
> - `Account` → `Workers KV Storage` → `Edit`
> - `Account` → `D1` → `Edit`
> - `Account` → `R2` → `Edit`
>
> 账号级权限可在 <https://dash.cloudflare.com/profile/api-tokens> 创建。

> **常见坑：报「it's necessary to set a CLOUDFLARE_API_TOKEN environment variable」**
>
> 这**不是**权限不足，而是凭据没传到运行 `wrangler` 的步骤里。
> `cloudflare/wrangler-action` 只用它自己的输入完成登录，不会把这两个变量
> 导出为后续 `run` 步骤的环境变量；而本工作流后续步骤都是直接 `npx wrangler ...`。
> 工作流中的「导出 Cloudflare 环境变量」步骤负责把 secrets 写入 `$GITHUB_ENV`，
> 自行精简工作流时请保留它。

**第 3 步：推送触发**

```bash
git push origin main
```

或直接在 Actions 页面点击 `Run workflow` 手动触发。

流水线会依次完成：类型检查 → 单元测试 → 构建资源 → 自动创建 R2 桶与 D1 库 → 回填 `database_id` → 执行迁移 → 部署。任一步失败即中止。

> 数据库迁移失败时，流水线会把 wrangler 的原始报错逐行写入 Actions 的错误注记，
> 无需打开完整日志即可看到失败原因。

---

### 方式二：手动部署（本地执行）

适合希望掌控每一步、或不使用 GitHub Actions 的场景。

**第 0 步：环境要求**

Node.js ≥ 20（推荐 22）、Cloudflare 账号（免费版即可）。

> 信用卡**不必须**。只有创建 R2 存储桶时才需要绑定信用卡。

**第 1 步：获取代码并安装依赖**

```bash
git clone https://github.com/yuanshang000/ysblog.git
cd ysblog
npm install
```

**第 2 步：登录 Cloudflare**

```bash
npx wrangler login
```

**第 3 步：创建 D1 数据库**

```bash
npx wrangler d1 create myblog
```

输出形如 `Added database myblog with id "xxxxxxxx-xxxx-..."`，把这串 **database_id** 填入 `wrangler.jsonc`：

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

**第 4 步：创建 R2 存储桶**

```bash
npx wrangler r2 bucket create myblog-media
```

**第 5 步：执行数据库迁移**

```bash
npm run db:migrate:remote
```

**第 6 步：设置密钥**

密钥**绝不写入代码或 Git 仓库**：

```bash
# 必填：参与会话令牌哈希运算，数据库泄露时防止有效 token 被还原
npx wrangler secret put SESSION_SECRET

# 必填：IP 哈希盐，保证统计与限流数据不可逆推
npx wrangler secret put IP_HASH_SALT

# 可选：仅首次创建管理员需要，创建后建议删除
npx wrangler secret put ADMIN_SETUP_TOKEN
```

可用 `openssl rand -hex 32` 生成随机值。

**第 7 步：部署**

```bash
npm run deploy
```

**第 8 步：创建管理员**

访问 `https://<你的域名>/admin`，未初始化时会自动跳转至 `/admin/setup`，填入 `ADMIN_SETUP_TOKEN`、用户名与密码即可。

---

### 部署后必做

| 事项 | 说明 |
| --- | --- |
| 修改管理员密码 | 演示/初始化密码强度较弱，务必在「站点设置 → 安全」中修改 |
| 删除 `ADMIN_SETUP_TOKEN` | `npx wrangler secret delete ADMIN_SETUP_TOKEN` |
| 配置 `SITE_URL` | 在 `wrangler.jsonc` 的 `vars` 中改为自己的域名，影响 RSS 与站点地图 |

更完整的说明见 [`docs/deployment.md`](docs/deployment.md) 与 [`docs/deploy-checklist.md`](docs/deploy-checklist.md)。

---

## 本地开发

```bash
npm install
npm run db:migrate:local   # 创建本地 D1
npm run seed:demo          # 可选：写入演示数据
npm run dev                # 同时启动 Worker 与两个前端
```

访问 `http://127.0.0.1:8787`，后台在 `http://127.0.0.1:8787/admin`。

演示数据提供的登录信息为 `admin` / `Demo123456`，**仅用于本地预览**。

---

## 常用命令

```bash
npm run dev                 # 本地开发
npm run build               # 清理并构建前台 + 后台
npm run typecheck           # Worker 与后台类型检查
npm test                    # 单元测试（98 个用例）
npm run db:migrate:local    # 本地执行 D1 迁移
npm run db:migrate:remote   # 线上执行 D1 迁移
npm run db:backup           # 备份数据库 + 图片
npm run deploy              # 构建并部署到 Cloudflare
npm run seed:demo           # 写入演示数据
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
│   └── worker/                 Cloudflare Worker
│       ├── src/routes/          公开 API / 管理 API / 评论 / RSS
│       ├── src/repositories/    全部 SQL（参数化查询）
│       ├── src/services/        设置读写 / SSR 页面渲染
│       ├── src/lib/             加密 / 会话 / 上下文 / HTTP
│       └── src/jobs/            定时任务
├── packages/shared/            三端共用
│   ├── types.ts                数据契约
│   ├── markdown.ts             安全 Markdown 渲染器
│   ├── html-shell.ts           前台设计系统 + HTML 外壳
│   └── settings-schema.ts      设置项单一事实来源
├── migrations/                  D1 迁移
│   ├── 0001_init.sql            建表（18 张表 / 34 个索引）
│   └── 0002_menu_open_in_new.sql 菜单跳转方式修正
├── tests/                      单元测试
├── docs/                       部署 / API / 备份文档
│   └── images/                  README 截图
└── scripts/                    备份与初始化脚本
```

---

## 文档

| 文档 | 内容 |
| --- | --- |
| [docs/deployment.md](docs/deployment.md) | 两种部署方式的完整步骤、环境变量、密钥管理 |
| [docs/deploy-checklist.md](docs/deploy-checklist.md) | 部署前需要准备哪些凭据（含获取方式与回滚方案） |
| **[docs/howto.md](docs/howto.md)** | **日常操作手册：更新代码如何部署 + 如何批量导入文章** |
| [docs/api.md](docs/api.md) | 全部 REST API 接口说明 |
| [docs/backup-restore.md](docs/backup-restore.md) | 数据备份与恢复（已验证流程） |
| [docs/architecture.md](docs/architecture.md) | 架构决策与安全设计 |
| [docs/todo.md](docs/todo.md) | 未完成事项清单 |

---

## 已验证能力

以下均为**真实运行验证通过**，非模拟：

- D1 迁移在真实 SQLite 执行成功（18 表 / 34 索引）
- 登录 → 建文章 → 自动保存 → 发布 → 前台可见 全链路
- 版本冲突正确返回 409，CSRF 缺失正确返回 403
- 22 个 XSS 攻击向量全部被拦截（含 `javascript:` 绕过、属性逃逸、编码混淆）
- 图片上传至 R2 并可访问（PNG 字节完全一致，自动解析 8×8 尺寸）
- 危险文件（`.sh`）被拒绝，SVG 默认禁用
- 全部前台页面 SSR 输出（含 404、归档、分类、标签、搜索、关于、友链）
- 后台 SPA 全部路由可访问
- 98 个单元测试通过
- Worker 与后台类型检查零错误

安全与部署链路的专项验证：

- CSRF 双提交实测：登录后 `mb_csrf` 不带 `HttpOnly`（前端可读），`mb_session` 仍带；
  缺失令牌返回 403，携带令牌改密码返回 200
- 页面内路由实测：线上导航 8 个栏目，`target="_blank"` 数量为 0，全部标记为路由链接
- GitHub Actions 端到端跑通：推送后自动完成检查、构建、迁移与部署

---

## 浏览器支持

现代浏览器（Chrome / Edge / Safari / Firefox 最近两个大版本）。
使用了 CSS `color-mix()`、`aspect-ratio`、AbortController 等现代特性。

---

## 许可

MIT
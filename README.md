# MyBlog 个人博客系统

一套自托管在 Cloudflare 上的个人博客：**Vue 3 服务端渲染前台 + Vue 3 管理后台 + Cloudflare Workers API + D1 + R2**。

无需购买服务器，不依赖 Nginx / PHP / MySQL，推送 GitHub 即自动部署。

---

## 核心特性

| 能力 | 说明 |
| --- | --- |
| 前台 SSR | 文章内容由 Worker 服务端渲染成 HTML，搜索引擎与禁用 JS 的场景都能完整阅读 |
| 极简写作 | 三栏编辑器、1.5 秒防抖自动保存、本地草稿兜底、多标签页冲突检测 |
| Markdown | 安全渲染（原始 HTML 一律转义），支持代码高亮、表格、数学公式、目录锚点、图片灯箱 |
| 深色模式 | 浅色 / 深色 / 跟随系统，`<head>` 内联脚本确定主题，无闪烁；深色为独立配色而非反色 |
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
部署      Wrangler + GitHub 自动部署
```

---

## 快速开始

```bash
# 1. 安装依赖
npm install

# 2. 配置 Cloudflare 资源（见 docs/deployment.md）
#    编辑 wrangler.jsonc 填入 D1 database_id

# 3. 创建本地数据库并执行迁移
npm run db:migrate:local

# 4. 启动开发环境（Worker + 前台岛 + 后台）
npm run dev
# Worker: http://127.0.0.1:8787
# 后台:    http://127.0.0.1:8787/admin
```

首次使用需创建管理员账号，见 [`docs/deployment.md`](docs/deployment.md#创建管理员账号)。

---

## 常用命令

```bash
npm run dev              # 本地开发（三个进程并行）
npm run build            # 清理并构建前台 + 后台
npm run typecheck        # Worker 与后台类型检查
npm test                 # 单元测试（80 个用例）
npm run db:migrate:local   # 本地执行 D1 迁移
npm run db:migrate:remote  # 线上执行 D1 迁移
npm run db:backup          # 备份数据库 + 图片
npm run deploy             # 构建并部署到 Cloudflare
```

---

## 目录结构

```
my-blog/
├── apps/
│   ├── web/                    前台交互岛（渐进增强）
│   │   └── src/islands/main.ts 主题/目录/进度/灯箱/搜索/评论
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
├── migrations/0001_init.sql    D1 迁移（18 张表 / 34 个索引）
├── tests/                      单元测试
├── docs/                       部署 / API / 备份文档
└── scripts/                    备份与初始化脚本
```

---

## 文档

| 文档 | 内容 |
| --- | --- |
| [docs/deployment.md](docs/deployment.md) | 首次部署、GitHub 自动部署、环境变量、密钥管理 |
| [docs/api.md](docs/api.md) | 全部 REST API 接口说明 |
| [docs/backup-restore.md](docs/backup-restore.md) | 数据备份与恢复（已验证流程） |
| [docs/architecture.md](docs/architecture.md) | 架构决策与安全设计 |
| [docs/todo.md](docs/todo.md) | 未完成事项清单 |

---

## 已验证能力

以下均为**真实运行验证通过**，非模拟：

- ✅ D1 迁移在真实 SQLite 执行成功（18 表 / 34 索引）
- ✅ 登录 → 建文章 → 自动保存 → 发布 → 前台可见 全链路
- ✅ 版本冲突正确返回 409，CSRF 缺失正确返回 403
- ✅ 22 个 XSS 攻击向量全部被拦截（含 `javascript:` 绕过、属性逃逸、编码混淆）
- ✅ 图片上传至 R2 并可访问（PNG 字节完全一致，自动解析 8×8 尺寸）
- ✅ 危险文件（`.sh`）被拒绝，SVG 默认禁用
- ✅ 全部前台页面 SSR 输出（含 404、归档、分类、标签、搜索、关于、友链）
- ✅ 后台 SPA 全部路由可访问
- ✅ 80 个单元测试通过
- ✅ Worker 与后台类型检查零错误

---

## 浏览器支持

现代浏览器（Chrome / Edge / Safari / Firefox 最近两个大版本）。
使用了 CSS `color-mix()`、`aspect-ratio`、容器无关的现代布局特性。

---

## 许可

MIT
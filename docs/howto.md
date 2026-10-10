# 日常操作手册

涵盖两个高频场景：**更新代码后如何部署**、**如何批量导入文章**。

---

# 一、更新代码后如何部署

## 场景 A：改了代码（改Worker / 前台 / 后台）

### 方式 1：推送触发自动部署（推荐）

```bash
git add .
git commit -m "feat: 你的改动说明"
git push origin master
```

推完GitHub Actions 自动跑完这 5 步，约 2-3 分钟：

| 步骤 | 做什么 | 失败后果 |
|---|---|---|
| npm ci | 按 lock 装依赖 | 中止（不会部署半成品） |
| typecheck | Worker tsc + 后台 vue-tsc | 中止 |
| 单元测试 | vitest run | 中止 |
| build:ci | 构建前台+后台+校验产物 | 中止 |
| 迁移 → 部署 | D1 迁移 + wrangler deploy | 中止 |

在仓库 Actions 页面看进度。

**推送前建议先本地跑一遍**，避免白等 CI：

```bash
npm run typecheck&& npm test && npm run build:ci
```

### 方式 2：本地直接部署（不想等 CI）

```bash
npm run deploy
```

等于 `npm run build && wrangler deploy`，约 40 秒。

改完数据库表结构（新增 migration）时，**必须**先迁移再部署：

```bash
npm run db:migrate:remote   # 应用到生产库
npm run deploy
```

### 方式 3：只改文章内容 —— 不需要重新部署

文章存在 D1 里，不在代码里。**用后台编辑器改，或用下面的导入工具**，都无需重新部署。

---

## 场景 B：新增了 npm 依赖（重要）

Windows 上装依赖会让 `package-lock.json` 只记录 win32 平台包，
Cloudflare 的Linux 构建会失败。

```bash
npm install xxx
npm run fix:lock        # 补全所有平台的二进制包
npm run test:e2e        # 验证 npm ci 能通过
git add package.json package-lock.json
git commit -m "deps: 新增 xxx"
git push
```

**每次新增依赖后都要跑 `npm run fix:lock`**，否则 CI 会报
`Missing: @esbuild/linux-x64 from lock file`。

---

## 部署出问题了怎么回滚

```bash
# 看历史版本
npx wrangler deployments list

# 回滚到上一个版本（在 Dashboard 的 Deployments 页面点 Rollback 更直观）
```

Cloudflare Workers 保留最近 10 个版本，回滚是秒级操作，不会丢数据
（数据在 D1，部署只换代码）。

---

## 本地开发

```bash
npm run dev# 同时起 Worker(8787) / 前台 / 后台
```

改了 Worker 代码需重启 `npm run dev`；改了前台/后台 vite 会热更新。

---

# 二、如何批量导入文章

## 准备：写好 Markdown 文件

在任意文件夹里放 `.md` 文件，**可选**在顶部写 front-matter：

```markdown
---
title: 我的新文章
date: 2026-10-10
status: published
tags: [TypeScript, Cloudflare]
categories: [技术笔记]
featured: true
summary: 一句话摘要，会显示在文章列表页。
---

## 二级标题

正文内容，支持 **粗体**、`代码`、表格、引用等。

```js
console.log('代码高亮')
```

- 列表项一
- 列表项二
```

### front-matter 字段说明

| 字段 | 必填 | 说明 |
|---|---|---|
| `title` | 否 | 不填则取正文首个 `#` 标题，再退到文件名 |
| `slug` | 否 | 不填则按标题生成；中文超 40 字符自动截断 |
| `date` | 否 | `YYYY-MM-DD`，不填用当前时间 |
| `status` | 否 | `draft`（默认）/ `published` / `archived` |
| `tags` | 否 | 数组，不存在会自动创建 |
| `categories` | 否 | 数组，不存在会自动创建 |
| `featured` | 否 | `true` 则在首页显示为精选 |
| `summary` | 否 | 列表页摘要 |

**全部不写也能用** —— 最简就是一个 `.md` 文件。

## 导入

### 方式 1：先预览（推荐第一次用）

```bash
node scripts/import-markdown.mjs --dir ./我的文章 --dry-run
```

会打印每篇的标题、slug、字数、标签数量，以及将要执行的 SQL。**不写库。**

### 方式 2：生成本地库 + 确认无误后导生产

```bash
# 第一步：导到本地库看看效果
node scripts/import-markdown.mjs --dir ./我的文章
npm run dev   # 打开 http://127.0.0.1:8787 看效果

# 第二步：确认没问题后导生产
node scripts/import-markdown.mjs --dir ./我的文章 --remote --publish
```

默认是**草稿**状态。加 `--publish` 直接发布。

### 方式 3：只生成 SQL（受限环境用）

某些环境（如 CI 沙箱、容器）禁止 Node 创建子进程，脚本无法直接调wrangler。
这时让它只生成 SQL 文件，你手动执行：

```bash
node scripts/import-markdown.mjs --dir ./我的文章 --out ./.tmp/import.sql
npx wrangler d1 execute myblog --remote --file ./.tmp/import.sql
```

## 常用参数

| 参数 | 作用 |
|---|---|
| `--dir <目录>` | 批量导入目录下所有 `.md` |
| `--file <文件>` | 导入单个文件 |
| `--remote` | 写生产库（**不加则只写本地库**） |
| `--publish` | 直接发布（不加则存草稿） |
| `--dry-run` | 只打印SQL，不写库 |
| `--out <文件>` | 只生成 SQL 文件 |

## 重要行为说明

### slug 冲突会自动改名，不会覆盖

重复导入同名文件时，slug 会变成 `xxx-2`、`xxx-3`。

**实测**：连着导入两次同一批 3 篇文章，得到 6 篇，
第二篇 slug 分别带 `-2` 后缀，标签/分类/修订快照都正确挂到对应文章上。

> 注意：这意味着**重复导入会生成重复文章**。
> 如果只是想更新已有文章，请去后台编辑，或者把文件里的 `slug` 固定成已存在的值并手动删除旧文章。

### 不会覆盖已有内容

导入只做 INSERT，从不 UPDATE 或 DELETE。已存在的 slug 一定会改名让开。

### 导入后想改内容怎么办

导入后文章就在后台了，正常用后台编辑器改，改完点保存即可。
后台会保存历史版本（导入时已写入初始快照）。

## 从其他平台搬家

如果你之前的文章在 WordPress / Hexo / Jekyll：

1. 把`.md`（或转成 `.md`）放进一个文件夹
2. 不用写 front-matter —— 脚本会从正文提取标题
3. 图片：把图片上传到后台媒体库，或用图床地址在正文里引用
4. 一次导入，全站搞定

---

# 三、常用命令速查

| 命令 | 作用 |
|---|---|
| `npm run dev` | 本地开发 |
| `npm run typecheck` | 类型检查 |
| `npm test` | 单元测试 |
| `npm run test:e2e` | 110 项集成测试（需先启动服务） |
| `npm run build:ci` | 构建 + 校验产物 |
| `npm run deploy` | 本地部署 |
| `npm run db:migrate:local` | 本地库迁移 |
| `npm run db:migrate:remote` | 生产库迁移 |
| `npm run fix:lock` | 补全 lock 的跨平台包 |
| `node scripts/import-markdown.mjs --dir ./x` | 导入文章 |
| `npx wrangler tail` | 看线上实时日志 |
| `npx wrangler deployments list` | 看部署历史 |

---

# 四、故障速查

| 现象 | 原因 | 处理 |
|---|---|---|
| CI 报 `Missing: @esbuild/linux-x64 from lock file` | Windows 装依赖导致 lock 缺平台包 | `npm run fix:lock` 后重新提交 |
| CI 报 `database_id ... code 10021` | D1 ID 未回填（已修，应不会再出现） | 检查 `wrangler.jsonc` 里的 ID |
| 后台白屏 | `admin/app.htm` 缺失 | 本地跑 `npm run build:ci` 看校验输出 |
| 导入报 `FOREIGN KEY constraint failed` | 库中无用户 | 先去后台创建一次管理员 |
| 导入报 `no such table: posts` | 本地库没迁移 | `npm run db:migrate:local` |
| 导入报 `EBUSY` / `EINVAL` | 环境禁止 spawn 子进程 | 用 `--out` 生成 SQL 后手动执行 |
| 部署后 500 | 多半是 D1 没迁移 | `npm run db:migrate:remote` |
| 修改不生效 | 静态资源长缓存 | 资源带 `?b=` 版本号，重新构建即失效 |
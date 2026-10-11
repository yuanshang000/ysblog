# 日常操作手册

涵盖两个高频场景：**更新代码后如何部署**、**如何批量导入文章**。

---

# 一、更新代码后如何部署

## 场景 A：改了代码（改 Worker / 前台 / 后台）

### 方式 1：推送触发自动部署（推荐）

```bash
git add .
git commit -m "feat: 你的改动说明"
git push origin master
```

Vercel 会自动完成：安装依赖 → 构建前台+后台 → 部署。约 2-3 分钟。

**推送前建议先本地跑一遍**，避免把编译错误推到线上：

```bash
npm run typecheck && npm test && npm run build
```

### 方式 2：本地直接部署（不想等 CI）

```bash
npm run deploy
```

改完数据库表结构（新增 migration）时，**必须**先迁移再部署：

```bash
npm run db:migrate
npm run deploy
```

### 方式 3：只改文章内容 —— 不需要重新部署

文章存在数据库里，不在代码里。**用后台编辑器改，或用下面的导入工具**，都无需重新部署。

---

## 场景 B：新增了 npm 依赖

Vercel 在 Linux 环境构建，若 `package-lock.json` 里缺少对应平台的二进制包会构建失败：

```bash
npm install xxx
npm test                      # 确认没破坏现有功能
git add package.json package-lock.json
git commit -m "deps: 新增 xxx"
git push
```

若 CI 报 `Missing: xxx from lock file`，说明 lock 文件不完整，
可在 Linux 环境或用 WSL 重新执行一次 `npm install` 生成完整 lock。

---

## 部署出问题了怎么回滚

进入 Vercel 项目的 **Deployments** 页面，找到上一个正常版本，点击右侧的 `⋯` → **Promote to Production**，秒级回滚。

> 回滚只更换代码版本，不影响数据库中的数据。
> 若问题出在数据库（schema 或数据），需要单独处理，代码回滚无法解决。

---

## 本地开发

```bash
npm run dev        # 启动 Vercel 本地运行时（localhost:3000）
```

改了 `apps/worker/` 下的代码需重启；前台岛与后台是 Vite watch，会自动热更新。

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

### 方式 2：先生成 SQL，确认无误后导入

```bash
# 第一步：先生成 SQL 并本地试跑
node scripts/import-markdown.mjs --dir ./我的文章 --dry-run

# 第二步：确认没问题后导入生产库
node scripts/import-markdown.mjs --dir ./我的文章 --remote --publish
```

默认是**草稿**状态。加 `--publish` 直接发布。

### 方式 3：只生成 SQL 文件（受限环境用）

某些环境禁止 Node 创建子进程，脚本无法直接连数据库。
这时让它只生成 SQL 文件，你手动执行：

```bash
node scripts/import-markdown.mjs --dir ./我的文章 --out ./import.sql
psql "$POSTGRES_URL" -f ./import.sql
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
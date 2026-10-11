# API 文档

所有接口以 `/api/v1` 为前缀，统一 JSON 格式。

## 统一响应格式

成功：

```json
{ "code": 0, "message": "success", "data": {} }
```

失败：

```json
{ "code": 422, "message": "请求参数校验失败", "data": { "field": "title" } }
```

> **判断成功必须看 HTTP 状态码**，不能只看 `code`。`code` 与 HTTP 状态码一致，便于前端统一处理。

## 状态码约定

| 码 | 含义 | 典型场景 |
| --- | --- | --- |
| 200 / 201 | 成功 | 查询、创建 |
| 400 | 请求格式错误 | JSON 解析失败、缺少必需参数 |
| 401 | 未登录 | 会话过期或未提供 Cookie |
| 403 | 权限不足 | 角色不符、CSRF 校验失败、Origin 不匹配 |
| 404 | 资源不存在 | 文章已删除、slug 不存在 |
| 409 | 版本冲突 | 并发编辑、slug 重复、媒体仍被引用 |
| 413 | 请求体过大 | 上传文件超限 |
| 422 | 参数校验失败 | 必填缺失、格式错误、非法状态流转 |
| 429 | 请求过于频繁 | 登录失败过多、评论提交过快 |
| 500 | 服务器内部错误 | 未预期异常 |

## 认证与 CSRF

- 登录后服务端下发两个 Cookie：
  - `mb_session` — **HttpOnly** + SameSite=Lax，JS 不可读
  - `mb_csrf` — **必须不带 HttpOnly**（SameSite=Lax），供前端 JS 读取并回传
- 所有写操作（POST/PUT/PATCH/DELETE）必须携带请求头 `X-CSRF-Token`，值与 `mb_csrf` Cookie 一致
- 写操作还校验 `Origin` / `Referer` 是否在白名单内
- 若请求中的 `mb_csrf` 缺失或与会话不匹配，服务端会在会话校验阶段自动重新下发，
  因此升级或Cookie 异常后无需重新登录，刷新页面即可恢复

> 注意：`mb_csrf` 一旦被误加 `HttpOnly`，前端将读不到令牌，所有写操作都会返回
> 403「缺少 CSRF 令牌，请刷新页面后重试」。修改 Cookie 下发逻辑时务必保持该Cookie 可被 JS 读取。

```bash
# 登录并保存 Cookie
curl -c jar.txt -X POST https://your-blog.com/api/v1/admin/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"your-password"}'

# 读取 CSRF token
CSRF=$(grep mb_csrf jar.txt | awk '{print $7}')

# 写操作
curl -b jar.txt -X POST https://your-blog.com/api/v1/admin/posts \
  -H 'Content-Type: application/json' \
  -H "X-CSRF-Token: $CSRF" \
  -d '{"title":"标题","content":"正文"}'
```

---

# 公开接口

无需认证。所有接口在**服务端**强制过滤非公开内容。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/v1/site` | 站点信息 + 导航菜单 |
| GET | `/api/v1/home` | 首页聚合数据（站点 / 精选 / 最新 / 分类） |
| GET | `/api/v1/posts` | 文章列表 |
| GET | `/api/v1/posts/:slug` | 文章详情 |
| GET | `/api/v1/categories` | 分类列表（含文章数） |
| GET | `/api/v1/categories/:slug` | 某分类下的文章 |
| GET | `/api/v1/tags` | 标签列表（含使用数） |
| GET | `/api/v1/tags/:slug` | 某标签下的文章 |
| GET | `/api/v1/archives` | 归档（按年月分组） |
| GET | `/api/v1/pages/:slug` | 独立页面 |
| GET | `/api/v1/search?q=` | 站内搜索 |
| GET | `/api/v1/feed` | RSS 2.0（`/feed`、`/rss.xml` 同样可用） |
| GET | `/api/v1/sitemap.xml` | 站点地图 |
| GET | `/robots.txt` | robots（同样支持 `/robots.txt`） |
| GET | `/api/v1/setup-status` | 是否已完成初始化 |

### 查询参数

`GET /api/v1/posts`：

| 参数 | 默认 | 说明 |
| --- | --- | --- |
| `page` | 1 | 页码 |
| `pageSize` | 站点设置值 | 每页条数（上限 50） |
| `q` | — | 标题/摘要关键词 |
| `category` | — | 分类 slug |
| `tag` | — | 标签 slug |

`GET /api/v1/search`：`q`（必填）、`limit`（默认 30，上限 100）。
搜索范围覆盖标题、摘要、正文，按中文字符直接匹配。

---

# 认证接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/v1/admin/auth/login` | 登录 |
| POST | `/api/v1/admin/auth/logout` | 退出 |
| POST | `/api/v1/setup` | 首次初始化（需 `ADMIN_SETUP_TOKEN`） |

**登录限流**：同一账号 15 分钟内失败 8 次、同一 IP 15 分钟内失败 20 次即锁定。

**密码要求**：≥ 10 位，必须同时包含字母和数字。
存储为 `pbkdf2$210000$<salt>$<hash>`，每个账号独立随机盐。

---

# 文章管理

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/v1/admin/dashboard` | 工作台数据 |
| GET | `/api/v1/admin/posts` | 文章列表（支持全部状态筛选） |
| POST | `/api/v1/admin/posts` | 新建（**始终创建为草稿**） |
| GET | `/api/v1/admin/posts/:id` | 文章详情（含相邻、相关文章） |
| PUT | `/api/v1/admin/posts/:id` | 更新（支持自动保存） |
| DELETE | `/api/v1/admin/posts/:id` | 移入回收站（软删除） |
| POST | `/api/v1/admin/posts/:id/publish` | 发布 |
| POST | `/api/v1/admin/posts/:id/schedule` | 定时发布 |
| DELETE | `/api/v1/admin/posts/:id/schedule` | 取消定时 |
| POST | `/api/v1/admin/posts/:id/archive` | 归档 |
| POST | `/api/v1/admin/posts/:id/restore` | 从回收站恢复 |
| DELETE | `/api/v1/admin/posts/:id/permanent?confirm=true` | 永久删除（需显式确认） |
| POST | `/api/v1/admin/posts/:id/duplicate` | 复制为新草稿 |
| POST | `/api/v1/admin/posts/batch` | 批量操作 |
| GET | `/api/v1/admin/posts/:id/revisions` | 版本列表 |
| GET | `/api/v1/admin/posts/:id/revisions/:revId` | 版本详情（含渲染 HTML） |
| POST | `/api/v1/admin/posts/:id/revisions/:revId/restore` | 恢复版本 |
| GET | `/api/v1/admin/posts/:id/adjacent` | 上下篇与相关文章 |
| GET | `/api/v1/admin/preview/:slug` | 预览草稿（仅登录用户） |

## 文章字段

```jsonc
{
  "title": "标题",              // 必填（内容为空时可留空，自动命名）
  "content": "Markdown 正文",    // 必填
  "slug": "custom-slug",        // 留空按标题生成
  "excerpt": "摘要",             // 留空自动提取
  "coverMediaId": 12,           // 封面媒体 ID
  "coverAlt": "封面描述",
  "type": "post",               // post | page
  "status": "draft",            // 仅新建时忽略，一律创建为草稿
  "isFeatured": false,
  "categoryIds": [1, 2],
  "tagNames": ["Vue", "Cloudflare"],   // 不存在的标签自动创建
  "seoTitle": null,             // 留空回退到 title
  "seoDescription": null,       // 留空回退到 excerpt
  "canonicalUrl": null,
  "robotsIndex": true,
  "scheduledAt": null,          // ISO 8601
  "baseRevision": 3,            // 并发编辑检测，见下
  "autoSave": false             // true 表示自动保存
}
```

## 并发编辑保护

更新时必须回传读取到的 `baseRevision`：

```json
{ "baseRevision": 3, "title": "新标题" }
```

若服务端当前 `revision` ≠ `baseRevision`，返回 **409**：

```json
{
  "code": 409,
  "message": "内容已被其他标签页或会话修改，请刷新后重试",
  "data": { "currentRevision": 5, "serverUpdatedAt": "2026-10-09 12:00:00" }
}
```

客户端应对策略二选一：
- **放弃本地** → 重新 GET 最新版本
- **强制覆盖** → 重新 GET 拿到最新 `revision` 后再次提交

## 状态机

```
draft ──────→ published ──────→ archived
  │               │                 │
  ├───────────────┼─────────────────┤
  ↓               ↓                 ↓
scheduled ──→ published         trashed
  │                               │
  └──────→ draft ←────────────────┘
```

服务端强制校验非法流转（返回 422）。新建文章一律为 `draft`，即使传了 `status: "published"`。

## 自动保存约定

- `autoSave: true` 只更新内容，**不会**让文章变为公开状态
- 自动保存产生的版本快照限量保留（10 个），手动保存保留 30 个
- 客户端应实现本地兜底：自动保存失败时把内容存入 `localStorage`，恢复网络后重试

---

# 分类与标签

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET/POST | `/api/v1/admin/categories` | 列表 / 新建 |
| PUT/DELETE | `/api/v1/admin/categories/:id` | 更新 / 删除 |
| GET/POST | `/api/v1/admin/tags` | 列表 / 新建 |
| PUT/DELETE | `/api/v1/admin/tags/:id` | 更新 / 删除 |
| POST | `/api/v1/admin/tags/merge` | 合并标签 |

**删除分类**默认 `mode=detach`（解除文章关联，保留文章）。
`mode=restrict` 时若仍有文章则返回 409；父分类有子分类时同样拦截。

**标签合并**：

```json
{ "sourceId": 3, "targetId": 5 }
```

把 `sourceId` 的所有文章改绑到 `targetId`，然后删除 `sourceId`。不可撤销。

---

# 媒体库

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/v1/admin/media` | 列表（`q` / `mime=image\|doc`） |
| POST | `/api/v1/admin/media/upload` | 上传（multipart/form-data） |
| PUT | `/api/v1/admin/media/:id` | 更新 alt / 图注 / 文件名 |
| DELETE | `/api/v1/admin/media/:id` | 删除（`?force=true` 跳过引用检查） |
| GET | `/api/v1/admin/media/:id/usage` | 引用检查 |
| GET | `/api/v1/admin/media/stats` | 统计信息 |

### 上传

```bash
curl -b jar.txt -X POST https://your-blog.com/api/v1/admin/media/upload \
  -H "X-CSRF-Token: $CSRF" \
  -F "file=@image.png" \
  -F "altText=图片描述"
```

响应：

```json
{
  "id": 12,
  "url": "https://your-blog.com/media/2026/10/xxx-image.png",
  "markdown": "![图片描述](https://your-blog.com/media/2026/10/xxx-image.png)",
  "width": 1200, "height": 800, "fileSize": 234567,
  "deduplicated": false
}
```

**安全策略**：

- 从文件二进制头部**嗅探真实类型**，不信任浏览器上报的 `Content-Type`
- 声明为图片但嗅探结果不是图片 → 拒绝（防伪装）
- 扩展名黑名单：`.exe .sh .bat .js .php .py .jar` 等 30+ 种可执行/脚本格式
- 默认大小上限 10MB（`MAX_UPLOAD_MB` 可调）
- **SVG 默认禁用**；即使 `ALLOW_SVG=true` 也会检查 `<script>` / `onload` / `javascript:` 等特征
- 相同内容（哈希+大小一致）自动复用，不重复占存储

**读取路径**：Worker 通过 `/media/<object_key>` 提供 R2 对象，带 1 年强缓存。

---

# 站点设置

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/v1/admin/settings` | 读取全部设置 |
| PUT | `/api/v1/admin/settings` | 更新 |

可用字段：站点名称/描述/URL、Logo、Favicon、主题色、默认主题、首页介绍（眉标题/主标题/简介/头像）、关于页内容、页脚文案、备案号、默认 SEO 标题/描述、每页文章数、评论开关、评论审核、统计开关、统计保留天数、robots 开关。

**敏感字段保护**：请求中包含 `sessionSecret` / `ipHashSalt` / `adminSetupToken` / `r2Secret` / `apiKey` 会返回 422 —— 这些只能通过 Wrangler Secret 设置。

---

# 菜单 / 友链 / 重定向

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET/POST | `/api/v1/admin/menus` | 菜单列表 / 新增 |
| PUT/DELETE | `/api/v1/admin/menus/:id` | 更新 / 删除 |
| POST | `/api/v1/admin/menus/reorder` | 批量排序 `{ ids: [3,1,2] }` |
| GET/POST | `/api/v1/admin/links` | 友链列表 / 新增 |
| PUT/DELETE | `/api/v1/admin/links/:id` | 更新 / 删除 |
| GET/POST | `/api/v1/admin/redirects` | 重定向列表 / 新增 |
| DELETE | `/api/v1/admin/redirects/:id` | 删除 |

菜单 `location`：`header`（顶部导航）/ `footer`（页脚）/ `social`（社交图标）。
外链必须以 `http(s)://` 开头，系统自动标记 `isExternal`。

---

# 评论

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/v1/posts/:id/comments` | 公开读取（仅已通过评论） |
| POST | `/api/v1/posts/:id/comments` | 提交评论 |
| GET | `/api/v1/admin/comments` | 管理列表（`status` 筛选） |
| PATCH | `/api/v1/admin/comments/:id` | 改状态 `{ status }` |
| POST | `/api/v1/admin/comments/batch` | 批量处理 |
| DELETE | `/api/v1/admin/comments/:id` | 永久删除 |

**公开响应不含邮箱字段**。

**限流**：同一 IP 60 秒内最多 2 条；同一文章下 60 秒内不得重复评论。

**垃圾识别**：链接数 > 3、命中关键词、13 个以上连续重复字符、字母数字比例异常 → 直接进垃圾箱。

**审核**：开启 `commentModeration` 时新评论进入 `pending`，管理员通过后才公开。

---

# 其他

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/v1/admin/me` | 当前登录用户 |
| PUT | `/api/v1/admin/profile` | 更新个人资料 |
| PUT | `/api/v1/admin/password` | 修改密码（会踢掉其他设备） |
| GET | `/api/v1/admin/logs` | 操作日志 |
| GET | `/api/v1/admin/slug-check` | slug 可用性检查 |
| POST | `/api/v1/admin/jobs/run` | 手动触发定时任务 |

---

# 前台页面路由（SSR HTML）

这些不是 JSON 接口，而是服务端渲染的 HTML 页面：

| 路径 | 页面 |
| --- | --- |
| `/` | 首页 |
| `/posts` | 文章列表（`?page=` / `?category=` / `?tag=` / `?q=`） |
| `/posts/:slug` | 文章详情 |
| `/archives` | 归档 |
| `/categories` `/categories/:slug` | 分类 |
| `/tags` `/tags/:slug` | 标签 |
| `/projects` `/about` `/links` `/privacy` | 独立页面（读取固定 slug） |
| `/p/:slug` | 其他自定义页面 |
| `/search?q=` | 搜索结果 |
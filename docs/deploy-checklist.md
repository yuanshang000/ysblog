# 部署到 Cloudflare —— 需要你提供什么

我已完成所有**不需要账户权限**的准备工作：配置校验、dry-run 验证、CI 工作流、构建校验。
剩下 4 项都需要你的 Cloudflare 访问权限。

---

## 必需项（缺一不可）

### 1. Cloudflare API Token

**为什么需要**：`wrangler deploy` / `d1 create` / `r2 bucket create` 都要调 Cloudflare API。

**怎么获取**：
1. 打开 https://dash.cloudflare.com/profile/api-tokens
2. 点 **Create Token**（若已有 token 且权限合适可跳过，注意保管好）
3. 模板选 **Edit Cloudflare Workers**
4. 确认 Account 权限包含这三项：
   - `Account: Workers Scripts` — Edit
   - `Account: D1` — Edit
   - `Account: R2` — Edit
   - `Account: Workers Tail` — Read（可选，用于查日志）
5. Account 选择你的账户，Zone 留 `All zones from the Cloudflare account`
6. 点 **Summary → Create Token**，复制生成的 token

**格式**：`xxxxxxxxxxxxxxxxxxxxxxxxxxxx`（约 40 位字符串）

> 建议用 API Token 而不是 Global API Key —— 前者可限定权限范围，后者是账户全权限，风险更高。

> **常见问题：部署在「确认 R2 存储桶存在」这一步失败**
>
> 该步骤依赖 `r2 bucket list` 与 `r2 bucket create`，两者都需要 Token 具备 `Account: R2 — Edit`。
> 若 Token 缺少 R2 权限，这一步会失败（查看日志会看到鉴权错误），而真正的部署其实并未执行。
>
> 处理方式：回到 <https://dash.cloudflare.com/profile/api-tokens> 编辑该 Token，补上 `Account: R2 — Edit` 后重新运行工作流。
>
> 另外注意，R2 桶在**生产环境**首次创建时，Cloudflare 可能要求先绑定支付方式（免费额度：10GB 存储、每月 1000 万次读写操作）。

---

### 2. Cloudflare Account ID

**为什么需要**：区分多账户时必需。

**怎么获取**：Cloudflare 控制台**右侧边栏**最下方，或登录后在任一域名页面 → Overview → Account ID。
格式为 32 位十六进制，如 `a1b2c3d4e5f6...`。

---

### 3. 确认使用哪个 Worker 名称

**默认**：`myblog`（已在 `wrangler.jsonc` 配置）
如果你想用别的名字，告诉我即可。

---

## 我拿到 Token 后会做的（可回滚）

| 步骤 | 命令 | 回滚方式 |
|---|---|---|
| 1. 创建 D1 库 | `wrangler d1 create myblog` | `wrangler d1 delete myblog`（会删数据，谨慎） |
| 2. 创建 R2 桶 | `wrangler r2 bucket create myblog-media` | `wrangler r2 bucket delete myblog-media` |
| 3. 把返回的 D1 ID 写入配置 | 编辑 `wrangler.jsonc` | 改回即可 |
| 4. 执行迁移（建 18 张表） | `wrangler d1 migrations apply myblog --remote` | 删表重建（生产前无数据，可忽略） |
| 5. 设置两个 Secret | `wrangler secret put SESSION_SECRET` 等 | `wrangler secret delete` |
| 6. 部署 | `wrangler deploy` | Dashboard → Deployments → Rollback |
| 7. 验证 | 访问 `.workers.dev` 域名实测 | — |

**风险说明**：
- 步骤 1-3 是**创建新资源**，不影响任何现有服务，可安全执行
- 步骤 4 是**新建表**，生产库为空，无数据风险
- 步骤 6 部署的是名为 `myblog` 的**新 Worker**，若该名称已被占用会失败（不会覆盖）
- 全程不改动任何现有 DNS、域名、WAF 规则

---

## Secret 的值我来生成

`SESSION_SECRET` 和 `IP_HASH_SALT` 是随机密钥，**我可以直接生成**，你不需要提供：

```bash
openssl rand -hex 32    # 我执行
```

你只需在执行 `secret put` 时确认即可。

---

## 可选项

| 项 | 用途 | 不做的后果 |
|---|---|---|
| 已有域名 | 绑定自定义域名 | 只能用 `*.workers.dev` 域名 |
| GitHub 仓库地址 | 配置 GitHub Actions 自动部署 | 每次部署需手动跑 `npm run deploy` |

建议**先不绑域名**，用 `workers.dev` 验证全部功能通过后再绑 —— 域名变更涉及 DNS 传播，回滚成本更高。

---

## 你需要提供的确切内容

```
1. Cloudflare API Token:  <粘贴到这里>
2. Cloudflare Account ID: <粘贴到这里>
3. Worker 名称: myblog（或你想要的）
```

**注意**：Token 属于凭据，粘贴到对话里后建议在部署完成后到 Cloudflare 控制台 **Revoke** 并重新生成一个，
再配置到 GitHub Secrets 里。这样对话记录里不会留下长期有效的凭据。

如果你更倾向不把 Token 粘到对话里，也可以自己在这台机器上执行：

```bash
cd my-blog
npx wrangler login          # 浏览器授权登录，无需手动贴 token
```

登录完成后告诉我，我继续后续步骤。
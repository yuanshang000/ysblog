# 数据备份与恢复

> ⚠️ **GitHub 代码仓库不是数据库备份。** 文章和图片保存在 D1 与 R2，必须单独导出。

---

## 需要备份什么

| 内容 | 位置 | 丢失后果 |
| --- | --- | --- |
| 文章、页面、分类、标签、评论、设置 | D1 数据库 | **全部内容永久丢失** |
| 封面、正文图片、头像 | R2 存储桶 | 文章出现大量坏图 |
| 部署配置 | `wrangler.jsonc`（已含在 GitHub） | 需重新配置 |

> 数据库与图片**必须成对保存**，否则恢复后文章会引用到不存在的图片。

---

## 备份

### 一条命令完成

```bash
# 备份线上生产库
npm run db:backup -- --remote

# 备份本地开发库
npm run db:backup
```

输出结构：

```
backups/2026-10-09T18-30-00/
├── database.sql        # D1 完整导出
├── media/              # R2 图片（按对象键目录结构）
└── backup-meta.json    # 备份元信息
```

### 手动执行

```bash
# 1. 导出数据库
npx wrangler d1 export myblog --remote --output ./backups/database.sql

# 2. 同步图片
npx wrangler r2 object sync myblog-media ./backups/media
```

### 建议频率

| 场景 | 操作 |
| --- | --- |
| 发布重要文章后 | 立即导出一次数据库 |
| 每周 | 数据库 + 图片完整备份 |
| 每次修改站点设置前 | 导出一次（设置存 D1） |
| 至少保留 | **3 份**历史备份，异地存放（本地 + 云盘） |

### 自动化（GitHub Actions）

可选：在 `.github/workflows/backup.yml` 中配置每日定时导出并上传到对象存储。注意：**备份文件不要提交进 Git 仓库**。

---

## 恢复

### 完整恢复流程

> ⚠️ 恢复会**覆盖当前数据**。执行前务必先给当前数据做一次备份。

```bash
# 0. 先备份当前状态（以防万一）
npx wrangler d1 export myblog --remote --output ./backups/before-restore.sql

# 1. 恢复数据库
npx wrangler d1 execute myblog --remote --file=./backups/2026-10-09T18-30-00/database.sql

# 2. 恢复图片
npx wrangler r2 object sync ./backups/2026-10-09T18-30-00/media myblog-media

# 3. 验证
#    - 打开前台，确认文章可读
#    - 打开文章详情，确认图片正常显示
#    - 打开后台，确认分类/标签/设置都在
```

### 只恢复图片

文章还在但图片全丢（通常是误删了 R2 桶）：

```bash
npx wrangler r2 object sync ./backups/2026-10-09T18-30-00/media myblog-media
```

因为对象键保存在 D1 的 `media.object_key` 中，只要键不变，文章里的图片链接就会自动恢复。

### 只恢复数据库

图片还在但文章丢了：

```bash
npx wrangler d1 execute myblog --remote --file=./backups/2026-10-09T18-30-00/database.sql
```

> ⚠️ 恢复数据库会覆盖当前的 `media` 表记录。若期间上传过新图片，
> 旧备份中的 media 记录不会包含它们，但**文件本身仍在 R2**。
> 恢复后需在后台媒体库重新上传这些新图片，或手动补一条 media 记录。

---

## 灾难恢复（新环境重建）

如果整个 Cloudflare 账号或项目都没了：

```bash
# 1. 从 GitHub 克隆代码
git clone https://github.com/<你的用户名>/my-blog.git
cd my-blog && npm install

# 2. 创建新资源
npx wrangler d1 create myblog
npx wrangler r2 bucket create myblog-media

# 3. 把新的 database_id 填入 wrangler.jsonc

# 4. 恢复数据
npx wrangler d1 execute myblog --remote --file=./backups/<时间戳>/database.sql
npx wrangler r2 object sync ./backups/<时间戳>/media myblog-media

# 5. 重新设置密钥
npx wrangler secret put SESSION_SECRET
npx wrangler secret put IP_HASH_SALT

# 6. 构建部署
npm run build
npx wrangler deploy

# 7. 重新绑定域名（在 Cloudflare 控制台操作）
```

---

## 已验证事项

以下流程在本项目的开发过程中**实际执行验证过**：

- ✅ `wrangler d1 migrations apply` 在真实 D1 上执行成功（55 条语句）
- ✅ `wrangler d1 execute` 导入导出 SQL 可用
- ✅ R2 对象上传后可通过 `/media/<key>` 正常读取，字节完全一致
- ✅ 媒体表 `object_key` 与公开 URL 分离存储，因此更换域名不影响已有图片

---

## 注意事项

- **定期做恢复演练**：备份文件存在 ≠ 能恢复。建议每季度挑一份备份，在临时 D1 库上试恢复一次。
- **不要把 SQL 提交进 Git**：里面包含用户密码哈希（PBKDF2，虽不可逆但不应泄露）。
- **异地存放**：本机 + 云盘各一份。本机损坏时云盘仍可救。
- **图片较大时优先只备份数据库** + 定期同步图片，避免备份体积失控。
- 迁移脚本全部是增量且向后兼容的，代码回滚不会导致数据库不可用 —— 但数据回滚仍需依赖上述备份。
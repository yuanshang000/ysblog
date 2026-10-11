# 数据备份与恢复

> ⚠️ **GitHub 代码仓库不是数据库备份。** 文章和图片保存在 Postgres 与 Vercel Blob，必须单独导出。

---

## 备份什么

| 内容 | 位置 | 丢失后果 |
| --- | --- | --- |
| 文章、页面、分类、标签、评论、设置 | Postgres 数据库 | **全部内容永久丢失** |
| 封面、正文图片、头像 | Vercel Blob | 文章出现大量坏图 |
| 环境变量（密钥） | Vercel 控制台 | 需重新生成 |

---

## 完整备份

### 1. 数据库导出

在项目页的 Vercel **Terminal** 中执行（需安装 `pg_dump`）：

```bash
# 导出为 SQL 文件
pg_dump "$POSTGRES_URL" --clean --no-owner > ./backup-$(date +%Y%m%d-%H%M%S).sql
```

或使用 Node 脚本（无需额外工具）：

```bash
npm run db:backup
```

该脚本会把数据库导出到 `backups/<时间戳>/database.sql`。

### 2. 图片导出

Vercel Blob 的图片需要单独处理。逐个下载 `media` 表中记录的 `object_key`：

```bash
# 导出 media 表拿到所有 object_key
psql "$POSTGRES_URL" -c "SELECT object_key FROM media" -t -A > keys.txt

# 逐个下载
mkdir -p media
while read -r key; do
  curl -sL "https://<你的blob域名>/$key" -o "media/$key"
done < keys.txt
```

> 更稳妥的做法是给 Blob 配置自定义域名后再下载，避免公开 URL 形式变化导致失效。

### 3. 打包

```bash
tar czf backup-$(date +%Y%m%d-%H%M%S).tar.gz backup-*.sql media/
```

---

## 什么时候需要备份

| 时机 | 原因 |
| --- | --- |
| 升级数据库 schema 前 | 迁移脚本可能不兼容旧数据 |
| 修改站点设置前 | 设置存于数据库 |
| 大批量导入/删除文章前 | 误操作可回滚 |
| 迁移平台前 | 跨平台数据格式会变 |

---

## 恢复

### 恢复数据库

```bash
psql "$POSTGRES_URL" < ./backup-20261011-120000.sql
```

若报「表已存在」，加 `--clean`：

```bash
psql "$POSTGRES_URL" --clean --if-exists < ./backup-20261011-120000.sql
```

### 恢复图片

确保 `media` 表中的 `object_key` 与恢复的目录结构一致。只要键不变，文章里的图片链接会自动恢复。

```bash
# 恢复后验证
psql "$POSTGRES_URL" -c "SELECT COUNT(*) FROM media"
```

---

## 灾难恢复

如果 Postgres 或整个 Vercel 项目都没了：

```bash
# 1. 在 Vercel 控制台重新创建 Postgres 与 Blob
#    Storage → Create Database / Create Store

# 2. 拉取新的环境变量
vercel env pull .env.local

# 3. 建表
npm run db:migrate

# 4. 导入备份数据
psql "$POSTGRES_URL" < ./backup/<时间戳>/database.sql

# 5. 上传图片文件到 Blob（需重新上传，Blob 不支持批量目录同步）
```

然后在 Vercel 控制台重新配置 `SESSION_SECRET`、`IP_HASH_SALT` 等环境变量并重新部署。

---

## 定期检查

建议每季度做一次恢复演练：

1. 新建一个测试数据库
2. 导入一份备份
3. 验证文章数、图片数与生产一致

**备份文件存在 ≠ 能恢复。** 演练才能发现备份损坏或格式过时的问题。

---

## 注意事项

- 备份文件**包含用户数据与 IP 哈希**，不要提交到 Git 仓库（`.gitignore` 已忽略 `backups/`）
- 备份本身也可能包含敏感信息，建议加密后再上传到云盘
- Postgres 免费额度足够个人博客，但要注意存储上限并定期清理历史备份
-- MyBlog 初始化迁移
-- 目标：Cloudflare D1（SQLite 兼容语法，禁止使用 MySQL 专属语法）
-- 说明：所有表结构必须通过迁移脚本管理，不得在开发环境手工建表。

-- ========== 1. 用户与会话 ==========

CREATE TABLE users (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  username       TEXT    NOT NULL UNIQUE,
  email          TEXT    UNIQUE,
  display_name   TEXT,
  avatar_url     TEXT,
  bio            TEXT,
  -- 算法名 + 迭代次数 + 盐 + 哈希，禁止明文或可逆加密
  password_hash  TEXT    NOT NULL,
  password_algo  TEXT    NOT NULL DEFAULT 'pbkdf2-sha256',
  role           TEXT    NOT NULL DEFAULT 'admin' CHECK (role IN ('admin','editor','author')),
  status         TEXT    NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  created_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S','now')),
  updated_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S','now')),
  last_login_at  TEXT
);
CREATE INDEX idx_users_status ON users(status);

-- 会话：只存 token 的 SHA-256 哈希，数据库泄露也无法反推原始会话
CREATE TABLE sessions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  token_hash  TEXT    NOT NULL UNIQUE,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  TEXT    NOT NULL,
  ip_hash     TEXT,
  user_agent  TEXT,
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S','now')),
  last_used_at TEXT   NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S','now'))
);
CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_sessions_expires ON sessions(expires_at);

-- 登录失败记录：用于频率限制与暴力破解防护
CREATE TABLE login_attempts (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  identifier   TEXT    NOT NULL,
  ip_hash      TEXT    NOT NULL,
  success      INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S','now'))
);
CREATE INDEX idx_login_attempts_ident ON login_attempts(identifier, created_at);
CREATE INDEX idx_login_attempts_ip ON login_attempts(ip_hash, created_at);

-- ========== 2. 内容：文章与独立页面 ==========

CREATE TABLE posts (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  author_id        INTEGER NOT NULL REFERENCES users(id),
  type             TEXT    NOT NULL DEFAULT 'post' CHECK (type IN ('post','page')),
  title            TEXT    NOT NULL,
  slug             TEXT    NOT NULL,
  excerpt          TEXT,
  content          TEXT    NOT NULL DEFAULT '',
  content_format   TEXT    NOT NULL DEFAULT 'markdown',
  cover_media_id   INTEGER REFERENCES media(id) ON DELETE SET NULL,
  cover_alt        TEXT,
  status           TEXT    NOT NULL DEFAULT 'draft'
                     CHECK (status IN ('draft','published','scheduled','archived','trashed')),
  is_featured      INTEGER NOT NULL DEFAULT 0,
  sort_order       INTEGER NOT NULL DEFAULT 0,
  word_count       INTEGER NOT NULL DEFAULT 0,
  reading_time     INTEGER NOT NULL DEFAULT 1,
  seo_title        TEXT,
  seo_description  TEXT,
  canonical_url    TEXT,
  robots_index     INTEGER NOT NULL DEFAULT 1,
  -- 并发编辑检测：客户端提交 base_revision，服务端不匹配即 409
  revision         INTEGER NOT NULL DEFAULT 1,
  published_at     TEXT,
  scheduled_at     TEXT,
  created_at       TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S','now')),
  updated_at       TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S','now')),
  deleted_at       TEXT
);

-- slug 全局唯一（软删除的条目同样占用 slug，保证历史 URL 不产生歧义）
CREATE UNIQUE INDEX idx_posts_slug_unique ON posts(slug);
CREATE INDEX idx_posts_listing ON posts(type, status, published_at DESC);
CREATE INDEX idx_posts_author   ON posts(author_id, status);
CREATE INDEX idx_posts_featured ON posts(is_featured, status, published_at DESC) WHERE is_featured = 1;
CREATE INDEX idx_posts_scheduled ON posts(scheduled_at) WHERE status = 'scheduled';
CREATE INDEX idx_posts_updated  ON posts(updated_at DESC);
CREATE INDEX idx_posts_deleted  ON posts(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX idx_posts_search   ON posts(status, published_at DESC) WHERE type = 'post';

-- 历史版本快照
CREATE TABLE post_revisions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id     INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  title       TEXT    NOT NULL,
  excerpt     TEXT,
  content     TEXT    NOT NULL,
  revision    INTEGER NOT NULL,
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S','now')),
  created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX idx_revisions_post ON post_revisions(post_id, revision DESC);
-- 同一文章同一版本号只保留一份快照，避免自动保存产生重复版本
CREATE UNIQUE INDEX idx_revisions_post_rev ON post_revisions(post_id, revision);

-- ========== 3. 分类与标签 ==========

CREATE TABLE categories (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  name            TEXT    NOT NULL,
  slug            TEXT    NOT NULL UNIQUE,
  description     TEXT,
  parent_id       INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  seo_title       TEXT,
  seo_description TEXT,
  created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S','now')),
  updated_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S','now'))
);
CREATE INDEX idx_categories_parent ON categories(parent_id);
CREATE INDEX idx_categories_sort   ON categories(sort_order);

CREATE TABLE tags (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  name            TEXT    NOT NULL,
  slug            TEXT    NOT NULL UNIQUE,
  description     TEXT,
  seo_title       TEXT,
  seo_description TEXT,
  created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S','now'))
);
CREATE INDEX idx_tags_name ON tags(name);

-- 关联表：唯一约束防止重复绑定
CREATE TABLE post_categories (
  post_id     INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  PRIMARY KEY (post_id, category_id)
);
CREATE INDEX idx_post_categories_cat ON post_categories(category_id);

CREATE TABLE post_tags (
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  tag_id  INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (post_id, tag_id)
);
CREATE INDEX idx_post_tags_tag ON post_tags(tag_id);

-- ========== 4. 媒体 ==========

CREATE TABLE media (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  original_name TEXT    NOT NULL,
  object_key    TEXT    NOT NULL UNIQUE,
  mime_type     TEXT    NOT NULL,
  file_size     INTEGER NOT NULL DEFAULT 0,
  width         INTEGER,
  height        INTEGER,
  alt_text      TEXT,
  caption       TEXT,
  -- SHA-256 内容哈希：用于秒传与重复文件识别
  file_hash     TEXT,
  created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S','now')),
  uploaded_by   INTEGER REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX idx_media_created ON media(created_at DESC);
CREATE INDEX idx_media_hash    ON media(file_hash);

-- ========== 5. 互动：评论与友情链接 ==========

CREATE TABLE comments (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id        INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  parent_id      INTEGER REFERENCES comments(id) ON DELETE CASCADE,
  author_name    TEXT    NOT NULL,
  author_email   TEXT,
  author_website TEXT,
  content        TEXT    NOT NULL,
  status         TEXT    NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending','approved','spam','deleted')),
  -- 只存 IP 哈希，不存原始 IP，降低隐私风险
  ip_hash        TEXT,
  user_agent     TEXT,
  created_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S','now')),
  moderated_at   TEXT,
  moderated_by   INTEGER REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX idx_comments_post   ON comments(post_id, status, created_at DESC);
CREATE INDEX idx_comments_status ON comments(status, created_at DESC);
CREATE INDEX idx_comments_parent ON comments(parent_id);

CREATE TABLE links (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    NOT NULL,
  url         TEXT    NOT NULL,
  avatar_url  TEXT,
  description TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  is_visible  INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S','now'))
);
CREATE INDEX idx_links_sort ON links(sort_order);

-- ========== 6. 配置：站点设置 / 菜单 / 重定向 ==========

-- 键值结构，便于后续新增设置项而不改表结构
CREATE TABLE site_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S','now'))
);

CREATE TABLE menus (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  label       TEXT    NOT NULL,
  href        TEXT    NOT NULL,
  location    TEXT    NOT NULL DEFAULT 'header' CHECK (location IN ('header','footer','social')),
  sort_order  INTEGER NOT NULL DEFAULT 0,
  is_visible  INTEGER NOT NULL DEFAULT 1,
  is_external INTEGER NOT NULL DEFAULT 0,
  -- 默认不在新窗口打开：站内栏目走页面内路由，跳出新标签页属于反直觉行为。
  -- 仅站外链接才应显式开启。
  open_in_new INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S','now')),
  updated_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S','now'))
);
CREATE INDEX idx_menus_location ON menus(location, sort_order, is_visible);

-- 旧 URL → 新 URL 永久重定向（301）
CREATE TABLE redirects (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  from_path   TEXT    NOT NULL UNIQUE,
  to_path     TEXT    NOT NULL,
  status_code INTEGER NOT NULL DEFAULT 301 CHECK (status_code IN (301,302)),
  is_active   INTEGER NOT NULL DEFAULT 1,
  hit_count   INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S','now'))
);
CREATE INDEX idx_redirects_active ON redirects(is_active);

-- ========== 7. 统计与日志 ==========

-- 说明：一次页面访问 = 一行记录；独立访客按 (path, day, ip_hash) 去重估算，
--       不把每次请求都当作独立访客，口径在工作台明确标注。
CREATE TABLE page_views (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  path          TEXT    NOT NULL,
  post_id       INTEGER REFERENCES posts(id) ON DELETE SET NULL,
  referrer      TEXT,
  -- 只保存 IP 的加盐哈希，不保存原始 IP
  ip_hash       TEXT,
  visitor_hash  TEXT,
  user_agent    TEXT,
  is_bot        INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S','now'))
);
CREATE INDEX idx_views_created ON page_views(created_at DESC);
CREATE INDEX idx_views_path    ON page_views(path, created_at DESC);
CREATE INDEX idx_views_post    ON page_views(post_id, created_at DESC);

CREATE TABLE operation_logs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  username    TEXT,
  action      TEXT    NOT NULL,
  target_type TEXT,
  target_id   INTEGER,
  detail      TEXT,
  ip          TEXT,
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S','now'))
);
CREATE INDEX idx_logs_created ON operation_logs(created_at DESC);
CREATE INDEX idx_logs_action  ON operation_logs(action, created_at DESC);
CREATE INDEX idx_logs_user    ON operation_logs(user_id, created_at DESC);

-- ========== 8. 导出（备份） ==========

-- 供 scripts/backup.mjs 导出一致性快照
CREATE TABLE IF NOT EXISTS schema_meta (
  key   TEXT PRIMARY KEY,
  value TEXT
);
INSERT OR REPLACE INTO schema_meta(key, value) VALUES ('init_version', '1.0.0');
INSERT OR REPLACE INTO schema_meta(key, value) VALUES ('init_at', strftime('%Y-%m-%d %H:%M:%S','now'));
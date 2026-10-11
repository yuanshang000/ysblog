-- 0002_menu_open_in_new.sql
--
-- 修正菜单「新窗口打开」的默认值与存量数据。
--
-- 背景：
-- 0001 中menus.open_in_new 的 DEFAULT 为 1，导致所有栏目（含站内栏目
-- 首页/归档/分类/标签等）都被渲染成 target="_blank"，点击后跳出独立标签页，
-- 与站点预期的「页面内路由跳转」体验割裂。
--
-- 处理：
-- 1) 把列默认值改为 0，新建菜单默认不再新开窗口；
-- 2) 修正存量数据——仅站内链接（以 / 开头的相对地址）置为 0，
--    站外链接（http/https 开头）保持管理员原有设置不变。
--
-- 说明：
-- - SQL 无法可靠地重建 SQLite 的 ALTER TABLE 列定义约束，
--   因此这里同时用 PRAGMA 重建表来落实 DEFAULT 0；
-- - 重建表会保留原有数据与自增主键，并重建索引；
-- - 若目标库缺少 d1_migrations 之外的任何外键依赖，请先确认再执行。

PRAGMA foreign_keys = OFF;

-- ---------- 1. 存量数据修正 ----------
-- 站内链接（相对路径）一律不在新窗口打开；
-- 站外链接保持原样，交由管理员在后台显式控制。
UPDATE menus
SET open_in_new = 0
WHERE open_in_new = 1
  AND is_external = 0
  AND href LIKE '/%'
  AND href NOT LIKE '//%';

-- ---------- 2. 列默认值修正（重建表以落实 DEFAULT 0） ----------
CREATE TABLE menus_new (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  label      TEXT    NOT NULL,
  href       TEXT    NOT NULL,
  location   TEXT    NOT NULL DEFAULT 'header' CHECK (location IN ('header','footer','social')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_visible INTEGER NOT NULL DEFAULT 1,
  is_external INTEGER NOT NULL DEFAULT 0,
  -- 默认不在新窗口打开：站内栏目走页面内路由，仅站外链接才应显式开启。
  open_in_new INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S','now')),
  updated_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S','now'))
);

INSERT INTO menus_new (
  id, label, href, location, sort_order, is_visible, is_external, open_in_new, created_at, updated_at
)
SELECT
  id, label, href, location, sort_order, is_visible, is_external, open_in_new, created_at, updated_at
FROM menus;

DROP TABLE menus;
ALTER TABLE menus_new RENAME TO menus;

CREATE INDEX idx_menus_location ON menus(location, sort_order, is_visible);

PRAGMA foreign_keys = ON;
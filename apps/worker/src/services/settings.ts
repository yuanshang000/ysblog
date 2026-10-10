/** 站点设置读写 —— 键值表 + 共享 schema 的类型强制 */
import type { Env } from '../lib/env';
import type { SiteSettings } from '@myblog/shared';
import { coerceSettings, SETTINGS_FIELDS } from '@myblog/shared';
import type { SettingKey } from '@myblog/shared';

export async function getSettings(env: Env): Promise<SiteSettings> {
  const rows = await env.DB.prepare('SELECT key, value FROM site_settings').all<{
    key: string;
    value: string | null;
  }>();
  const map: Record<string, string | null> = {};
  for (const r of rows.results) map[r.key] = r.value;
  return coerceSettings(map);
}

export async function getPublicSettings(env: Env): Promise<SiteSettings> {
  return getSettings(env);
}

export async function saveSettings(env: Env, patch: Record<string, unknown>): Promise<SiteSettings> {
  const current = await getSettings(env);
  const next: Record<string, unknown> = { ...current, ...patch };

  const statements = (Object.keys(SETTINGS_FIELDS) as SettingKey[]).map((key) => {
    const value = next[key];
    const kind = SETTINGS_FIELDS[key];
    let stored: string | null;
    if (value === null || value === undefined || value === '') {
      stored = kind === 'string' ? '' : null;
    } else if (kind === 'boolean') {
      stored = value === true || value === 'true' ? 'true' : 'false';
    } else if (kind === 'number') {
      stored = String(Math.trunc(Number(value)));
    } else {
      stored = String(value);
    }
    return env.DB.prepare(
      `INSERT INTO site_settings (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    ).bind(key, stored, new Date().toISOString().replace('T', ' ').slice(0, 19));
  });

  for (const st of statements) {
    await st.run();
  }
  return getSettings(env);
}

export async function ensureDefaultSettings(env: Env): Promise<void> {
  // 设置项与菜单各自独立判断：用户可能清空过其中一张表，
  // 若只看 site_settings 非空就早退，会导致菜单永远补不上（顶栏空白）。
  const settingsCount = await env.DB.prepare('SELECT COUNT(*) AS n FROM site_settings').first<{ n: number }>();
  const menusCount = await env.DB.prepare('SELECT COUNT(*) AS n FROM menus').first<{ n: number }>();
  const hasSettings = (settingsCount?.n ?? 0) > 0;
  const hasMenus = (menusCount?.n ?? 0) > 0;
  if (hasSettings && hasMenus) return;
  if (hasSettings) {
    await seedMenus(env);
    return;
  }
  const defaults: Record<string, string> = {
    siteName: '我的博客',
    siteDescription: '技术文章、项目记录与个人随笔',
    siteUrl: '',
    accentColor: '#4f46e5',
    defaultTheme: 'light',
    heroTitle: '你好，我是一名开发者',
    heroSubtitle: '写代码，也写字',
    heroDescription: '在这里记录技术实践、项目经验与生活点滴。',
    footerText: '© 2026 保留所有权利',
    postsPerPage: '10',
    commentEnabled: 'false',
    commentModeration: 'true',
    analyticsEnabled: 'true',
    analyticsRetentionDays: '180',
    robotsIndex: 'true'
  };
  await env.DB.batch(
    Object.entries(defaults).map(([k, v]) =>
      env.DB.prepare('INSERT OR IGNORE INTO site_settings (key, value) VALUES (?, ?)').bind(k, v)
    )
  );

  await seedMenus(env);
}

/**
 * 补齐缺失的默认菜单。
 * 用「不存在才插入」而非无条件插入：menus 表可能被用户清空过，
 * 无条件插入会导致导航项重复（首页出现两次）。
 */
async function seedMenus(env: Env): Promise<void> {
  const defaults = [
    ['首页', '/', 'header', 1],
    ['文章', '/posts', 'header', 2],
    ['归档', '/archives', 'header', 3],
    ['分类', '/categories', 'header', 4],
    ['标签', '/tags', 'header', 5],
    ['项目', '/projects', 'header', 6],
    ['关于我', '/about', 'header', 7],
    ['友链', '/links', 'header', 8]
  ] as const;
  await env.DB.batch(
    defaults.map(([label, href, location, sortOrder]) =>
      env.DB.prepare(
        `INSERT INTO menus (label, href, location, sort_order, is_visible, is_external, open_in_new, created_at, updated_at)
         SELECT ?, ?, ?, ?, 1, 0, 1, datetime('now'), datetime('now')
         WHERE NOT EXISTS (SELECT 1 FROM menus WHERE href = ? AND location = ?)`
      ).bind(label, href, location, sortOrder, href, location)
    )
  );
}
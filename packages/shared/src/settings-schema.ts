/**
 * 站点设置字段的单一事实来源 —— Worker 校验、后台表单、前台渲染共用。
 */
import type { SiteSettings } from './types';
import { DEFAULT_SITE_SETTINGS } from './types';

export const SETTINGS_FIELDS = {
  siteName: 'string',
  siteDescription: 'string',
  siteUrl: 'string',
  logoUrl: 'string?',
  faviconUrl: 'string?',
  accentColor: 'string',
  defaultTheme: 'enum:light,dark,system',
  heroTitle: 'string',
  heroSubtitle: 'string',
  heroDescription: 'string',
  heroAvatarUrl: 'string?',
  aboutContent: 'string',
  footerText: 'string',
  footerIcp: 'string?',
  defaultSeoTitle: 'string?',
  defaultSeoDescription: 'string?',
  postsPerPage: 'number',
  commentEnabled: 'boolean',
  commentModeration: 'boolean',
  analyticsEnabled: 'boolean',
  analyticsRetentionDays: 'number',
  robotsIndex: 'boolean',
  icpBeian: 'string?'
} as const;

export type SettingKey = keyof typeof SETTINGS_FIELDS;
export type SettingKind = (typeof SETTINGS_FIELDS)[SettingKey];

export function parseSettingValue(kind: SettingKind, raw: unknown): string | null {
  switch (kind) {
    case 'number': {
      const n = Number(raw);
      return Number.isFinite(n) ? String(Math.trunc(n)) : null;
    }
    case 'boolean':
      return raw === true || raw === 'true' || raw === '1' ? 'true' : 'false';
    case 'string?':
      if (raw === null || raw === undefined) return null;
      const s = String(raw);
      return s.length ? s : null;
    case 'enum:light,dark,system': {
      const s = String(raw);
      return ['light', 'dark', 'system'].includes(s) ? s : 'light';
    }
    case 'string':
    default: {
      if (raw === null || raw === undefined) return '';
      return String(raw);
    }
  }
}

export function coerceSettings(rows: Record<string, string | null>): SiteSettings {
  const out: Record<string, unknown> = { ...DEFAULT_SITE_SETTINGS };
  for (const key of Object.keys(SETTINGS_FIELDS) as SettingKey[]) {
    const raw = rows[key];
    if (raw === undefined) continue;
    const parsed = parseSettingValue(SETTINGS_FIELDS[key], raw);
    if (key === 'postsPerPage') {
      const n = Number(parsed);
      out[key] = Number.isFinite(n) ? Math.min(50, Math.max(1, n)) : DEFAULT_SITE_SETTINGS.postsPerPage;
    } else if (key === 'analyticsRetentionDays') {
      const n = Number(parsed);
      out[key] = Number.isFinite(n) ? Math.min(3650, Math.max(7, n)) : DEFAULT_SITE_SETTINGS.analyticsRetentionDays;
    } else if (key === 'defaultTheme') {
      out[key] = parsed as SiteSettings['defaultTheme'];
    } else if (SETTINGS_FIELDS[key] === 'boolean') {
      out[key] = parsed === 'true';
    } else {
      out[key] = parsed;
    }
  }
  return out as unknown as SiteSettings;
}

export const BOOLEAN_SETTING_KEYS: SettingKey[] = (Object.keys(SETTINGS_FIELDS) as SettingKey[]).filter(
  (k) => SETTINGS_FIELDS[k] === 'boolean'
);

export const NUMBER_SETTING_KEYS: SettingKey[] = (Object.keys(SETTINGS_FIELDS) as SettingKey[]).filter(
  (k) => SETTINGS_FIELDS[k] === 'number'
);
/** 通用工具函数 —— 三端共用 */

export function formatDate(input: string | null | undefined, withTime = false): string {
  if (!input) return '';
  const d = new Date(input.includes('T') ? input : input.replace(' ', 'T') + 'Z');
  if (Number.isNaN(d.getTime())) return '';
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  if (!withTime) return `${y}-${m}-${day}`;
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${y}-${m}-${day} ${hh}:${mm}`;
}

export function formatRelative(input: string | null | undefined): string {
  if (!input) return '';
  const d = new Date(input.includes('T') ? input : input.replace(' ', 'T') + 'Z');
  const diff = Date.now() - d.getTime();
  if (Number.isNaN(diff)) return '';
  const min = Math.floor(diff / 60000);
  if (min < 1) return '刚刚';
  if (min < 60) return `${min} 分钟前`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} 小时前`;
  const day = Math.floor(h / 24);
  if (day < 30) return `${day} 天前`;
  return formatDate(input);
}

export function formatBytes(bytes: number | null | undefined): string {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let n = bytes;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(n >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

const SLUG_STRIP = /[^\p{Letter}\p{Number}\s-]/gu;
const HAS_CJK = /[\u3400-\u9FFF\uF900-\uFAFF\u3040-\u30FF\uAC00-\uD7AF]/;
/** 替换字符 U+FFFD，通常意味着上游编码已损坏 */
const REPLACEMENT_CHAR = /\uFFFD/;

/**
 * 生成 URL slug。
 *
 * 中文标题保留中文（现代搜索引擎能正确索引中文 URL），
 * 但会做三件事：
 * 1. 去掉标点、空格转连字符；
 * 2. 纯中文超过 40 字符时截断，避免 URL 过长；
 * 3. 若结果为空或含编码损坏字符（U+FFFD），回退到稳定的 ASCII 前缀，
 *    绝不让乱码进入数据库与公开 URL。
 */
export function slugify(input: string): string {
  const s = (input ?? '')
    .trim()
    .replace(SLUG_STRIP, '')
    .replace(/\s+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();

  // 编码已损坏（出现替换字符）或清洗后为空：回退
  if (!s || REPLACEMENT_CHAR.test(s)) return '';

  if (HAS_CJK.test(s) && s.length > 40) return s.slice(0, 40).replace(/-+$/, '');
  return s;
}

/** slug 为空时生成带前缀的稳定兜底值 */
export function slugOrFallback(input: string, prefix: string): string {
  const s = slugify(input);
  if (s) return s;
  return `${prefix}-${Date.now().toString(36)}`;
}

export function truncate(input: string, max: number): string {
  const s = (input ?? '').trim();
  return s.length <= max ? s : s.slice(0, max).trimEnd() + '…';
}

export function classNames(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

/** 生成本地唯一后缀 */
export function shortId(): string {
  return Math.random().toString(36).slice(2, 10);
}

export function isBrowser(): boolean {
  return typeof globalThis !== 'undefined' && typeof (globalThis as { window?: unknown }).window !== 'undefined';
}

export function debounce<F extends (...args: never[]) => void>(fn: F, wait: number): F & { cancel: () => void } {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const wrapped = ((...args: Parameters<F>) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn(...(args as never[])), wait);
  }) as F & { cancel: () => void };
  wrapped.cancel = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };
  return wrapped;
}

/** 从 URL 中提取文件名与扩展名 */
export function fileMeta(name: string): { base: string; ext: string } {
  const i = name.lastIndexOf('.');
  if (i <= 0) return { base: name, ext: '' };
  return { base: name.slice(0, i), ext: name.slice(i + 1).toLowerCase() };
}

export function safeJsonParse<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function htmlEscape(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** 简易节流 */
export function throttle<F extends (...args: never[]) => void>(fn: F, wait: number): F {
  let last = 0;
  let pending: Parameters<F> | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  return ((...args: Parameters<F>) => {
    const now = Date.now();
    if (now - last >= wait) {
      last = now;
      fn(...(args as never[]));
    } else {
      pending = args;
      if (!timer) {
        timer = setTimeout(() => {
          last = Date.now();
          timer = null;
          if (pending) fn(...(pending as never[]));
          pending = null;
        }, wait - (now - last));
      }
    }
  }) as F;
}

/** 数字缩写：1234 → 1.2k */
export function compactNumber(n: number): string {
  if (n < 1000) return String(n);
  if (n < 10000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 10000).toFixed(1)}w`;
}
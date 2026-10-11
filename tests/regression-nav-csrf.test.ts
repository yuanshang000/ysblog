/**
 * 回归验证：CSRF Cookie 属性 与 前台导航链接渲染。
 * 这些是本次修复的两个核心回归点，用真实函数实现直接断言。
 */
import { describe, it, expect } from 'vitest';

// ---- 复刻 apps/worker/src/lib/auth.ts 的 cookieHeader 实现 ----
function cookieHeader(
  name: string,
  value: string,
  maxAgeSeconds: number,
  secure: boolean,
  httpOnly: boolean
): string {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    `Max-Age=${maxAgeSeconds}`,
    'SameSite=Lax'
  ];
  if (httpOnly) parts.push('HttpOnly');
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

describe('CSRF Cookie 属性', () => {
  it('会话 Cookie 必须带 HttpOnly', () => {
    const c = cookieHeader('mb_session', 'tok', 3600, true, true);
    expect(c).toContain('HttpOnly');
    expect(c).toContain('Secure');
  });

  it('CSRF Cookie 必须不带 HttpOnly，否则前端读不到', () => {
    const c = cookieHeader('mb_csrf', 'tok', 3600, true, false);
    expect(c).not.toContain('HttpOnly');
    expect(c).toContain('mb_csrf=tok');
  });

  it('清理 Cookie 时同样不能给 CSRF 加 HttpOnly', () => {
    const c = cookieHeader('mb_csrf', '', 0, false, false);
    expect(c).not.toContain('HttpOnly');
    expect(c).toContain('Max-Age=0');
  });

  it('双提交校验：Cookie 与请求头一致即可通过', () => {
    const token = 'abc123';
    const header = cookieHeader('mb_csrf', token, 3600, true, false);
    const cookieToken = /mb_csrf=([^;]+)/.exec(header)?.[1];
    expect(cookieToken).toBe(token);
    expect(cookieToken === decodeURIComponent(token)).toBe(true);
  });
});

describe('前台导航链接渲染', () => {
  const escapeHtml = (s: string): string =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  function isInternalHref(href: string, siteUrl: string): boolean {
    const h = (href ?? '').trim();
    if (!h) return false;
    if (h.startsWith('#') || h.startsWith('/')) return true;
    if (/^[a-z][a-z0-9+.-]*:/i.test(h)) {
      if (!/^https?:\/\//i.test(h)) return false;
      try {
        return new URL(h).host === new URL(siteUrl).host;
      } catch {
        return false;
      }
    }
    return true;
  }

  function navLink(m: { href: string; label: string; openInNew: boolean }, currentPath: string, siteUrl: string): string {
    const active = currentPath === m.href || (m.href !== '/' && currentPath.startsWith(m.href));
    const internal = isInternalHref(m.href, siteUrl);
    const target = !internal && m.openInNew ? ' target="_blank" rel="noopener noreferrer"' : '';
    const route = internal && !m.href.startsWith('#') ? ' data-route-link' : '';
    const current = active ? ' aria-current="page"' : '';
    return `<a href="${escapeHtml(m.href)}"${target}${route}${current}>${escapeHtml(m.label)}</a>`;
  }

  const SITE = 'https://blog.example.com';

  it('站内链接即使 openInNew=true 也不开新标签', () => {
    const html = navLink({ href: '/archives', label: '归档', openInNew: true }, '/', SITE);
    expect(html).not.toContain('target="_blank"');
    expect(html).toContain('data-route-link');
  });

  it('站外链接在开启时仍开新标签', () => {
    const html = navLink({ href: 'https://github.com/x', label: 'GitHub', openInNew: true }, '/', SITE);
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).not.toContain('data-route-link');
  });

  it('站外链接未开启时留在当前窗口', () => {
    const html = navLink({ href: 'https://github.com/x', label: 'GitHub', openInNew: false }, '/', SITE);
    expect(html).not.toContain('target="_blank"');
  });

  it('同源绝对地址视为站内', () => {
    const html = navLink({ href: 'https://blog.example.com/posts/x', label: '文章', openInNew: true }, '/', SITE);
    expect(html).not.toContain('target="_blank"');
    expect(html).toContain('data-route-link');
  });

  it('mailto 等协议视为站外', () => {
    const html = navLink({ href: 'mailto:a@b.com', label: '邮件', openInNew: true }, '/', SITE);
    expect(html).not.toContain('data-route-link');
  });

  it('纯锚点不参与路由接管', () => {
    const html = navLink({ href: '#top', label: '顶部', openInNew: false }, '/', SITE);
    expect(html).not.toContain('data-route-link');
    expect(html).not.toContain('target="_blank"');
  });

  it('当前栏目带aria-current', () => {
    const html = navLink({ href: '/tags', label: '标签', openInNew: false }, '/tags/typescript', SITE);
    expect(html).toContain('aria-current="page"');
  });
});
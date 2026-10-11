/**
 * 会话认证 —— 服务端权威校验，后台每个接口都必须经过这里。
 *
 * 安全设计：
 * - 会话令牌为 32 字节 CSPRNG 随机值，数据库仅存 SHA-256 哈希；
 * - Cookie 设置 HttpOnly + Secure + SameSite=Lax，前端 JS 无法读取；
 * - 同时下发非 HttpOnly 的 mb_csrf 双提交令牌，写操作需回传 X-CSRF-Token；
 * - Origin/Referer 白名单校验，阻断跨站请求伪造；
 * - 会话滑动续期，绝对过期上限 14 天。
 */
import type { Ctx } from './context';
import { requireUser } from './context';
import { HttpError } from './http';
import { randomToken, sha256Hex } from './crypto';
import { CSRF_COOKIE, SESSION_COOKIE, SESSION_TTL_DAYS, SESSION_TTL_MS } from './env';
import type { SessionUser } from './env';

function parseCookies(request: Request): Map<string, string> {
  const header = request.headers.get('cookie') ?? '';
  const map = new Map<string, string>();
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    // 注意：key 必须是 '=' 之前的部分，value 是之后的部分。
    // 若误用 part.trim() 会把 "name=value" 整体当作 key，导致永远取不到会话。
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k) map.set(k, decodeURIComponent(v));
  }
  return map;
}

export function getCookie(request: Request, name: string): string | null {
  return parseCookies(request).get(name) ?? null;
}

/**
 * 构造 Set-Cookie。
 *
 * httpOnly 必须按 cookie 区分：
 * - 会话 Cookie 需要 HttpOnly，前端 JS 读不到，避免被 XSS 窃取；
 * - CSRF Cookie 必须「非」HttpOnly，否则前端读不到令牌，所有写操作都会被
 *   判定为「缺少 CSRF 令牌」。双提交令牌的安全性依赖的是「攻击者无法跨站读取
 *   本站 Cookie」，而不是令牌本身保密，因此这里刻意不设 HttpOnly。
 */
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

function isSecure(ctx: Ctx): boolean {
  return ctx.url.protocol === 'https:' || ctx.request.headers.get('X-Forwarded-Proto') === 'https';
}

export async function createSession(ctx: Ctx, userId: number): Promise<void> {
  const token = randomToken();
  const tokenHash = await sha256Hex(`${ctx.env.SESSION_SECRET ?? ''}:${token}`);
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString().replace('T', ' ').slice(0, 19);

  await ctx.env.DB.prepare(
    `INSERT INTO sessions (token_hash, user_id, expires_at, ip_hash, user_agent)
     VALUES (?, ?, ?, ?, ?)`
  )
    .bind(
      tokenHash,
      userId,
      expiresAt,
      ctx.ipHash,
      (ctx.request.headers.get('user-agent') ?? '').slice(0, 300)
    )
    .run();

  const secure = isSecure(ctx);
  const maxAge = Math.floor(SESSION_TTL_MS / 1000);
  ctx.setCookies.push(
    cookieHeader(SESSION_COOKIE, token, maxAge, secure, true),
    // CSRF 令牌必须可被前端 JS 读取，否则写操作一律报「缺少 CSRF 令牌」
    cookieHeader(CSRF_COOKIE, token, maxAge, secure, false)
  );
}

export async function destroySession(ctx: Ctx): Promise<boolean> {
  const token = getCookie(ctx.request, SESSION_COOKIE);
  if (token) {
    const tokenHash = await sha256Hex(`${ctx.env.SESSION_SECRET ?? ''}:${token}`);
    await ctx.env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(tokenHash).run();
  }
  const secure = isSecure(ctx);
  ctx.setCookies.push(
    cookieHeader(SESSION_COOKIE, '', 0, secure, true),
    cookieHeader(CSRF_COOKIE, '', 0, secure, false)
  );
  return true;
}

/** 解析会话并挂到 ctx.user；过期会话自动清理 */
export async function loadSession(ctx: Ctx): Promise<void> {
  const token = getCookie(ctx.request, SESSION_COOKIE);
  if (!token) return;
  const tokenHash = await sha256Hex(`${ctx.env.SESSION_SECRET ?? ''}:${token}`);

  const row = await ctx.env.DB.prepare(
    `SELECT s.id AS sid, s.expires_at, u.id, u.username, u.role, u.status
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ?`
  )
    .bind(tokenHash)
    .first<{
      sid: number;
      expires_at: string;
      id: number;
      username: string;
      role: SessionUser['role'];
      status: SessionUser['status'];
    }>();

  if (!row) return;

  if (row.expires_at <= ctx.now) {
    await ctx.env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(row.sid).run();
    return;
  }

  ctx.user = {
    id: row.id,
    username: row.username,
    role: row.role,
    status: row.status
  };

  // 自愈：CSRF Cookie 缺失或与当前会话不匹配时重新下发。
  // 这既修复了升级前遗留的 HttpOnly 令牌，也让「刷新页面后重试」真正有效，
  // 用户不必为了拿回令牌而重新登录。
  if (getCookie(ctx.request, CSRF_COOKIE) !== token) {
    ctx.setCookies.push(
      cookieHeader(CSRF_COOKIE, token, Math.floor(SESSION_TTL_MS / 1000), isSecure(ctx), false)
    );
  }

  // 滑动续期：剩余不足一半时刷新过期时间
  const expiresMs = Date.parse(row.expires_at.replace(' ', 'T') + 'Z');
  if (expiresMs - Date.now() < SESSION_TTL_MS / 2) {
    const next = new Date(Date.now() + SESSION_TTL_MS).toISOString().replace('T', ' ').slice(0, 19);
    ctx.env.DB.prepare('UPDATE sessions SET last_used_at = ?, expires_at = ? WHERE id = ?')
      .bind(ctx.now, next, row.sid)
      .run()
      .catch(() => {});
  }
}

/** 写操作前置校验：Origin 白名单 + 双提交 CSRF 令牌 */
export function assertCsrf(ctx: Ctx): void {
  if (['GET', 'HEAD', 'OPTIONS'].includes(ctx.request.method)) return;

  const origin = ctx.request.headers.get('origin');
  const referer = ctx.request.headers.get('referer');
  const source = origin ?? referer;
  if (source) {
    let sourceHost: string;
    try {
      sourceHost = new URL(source).host;
    } catch {
      throw new HttpError(403, '请求来源无效');
    }
    const allowed = new Set<string>();
    allowed.add(ctx.url.host);
    for (const o of (ctx.env.ALLOWED_ORIGINS ?? '').split(',')) {
      const t = o.trim();
      if (!t) continue;
      try {
        allowed.add(new URL(t).host);
      } catch {
        allowed.add(t);
      }
    }
    if (!allowed.has(sourceHost)) throw new HttpError(403, '请求来源不被允许（CSRF 防护）');
  }

  const cookieToken = getCookie(ctx.request, CSRF_COOKIE);
  const headerToken = ctx.request.headers.get('x-csrf-token');
  if (!cookieToken || !headerToken) {
    throw new HttpError(403, '缺少 CSRF 令牌，请刷新页面后重试');
  }
  if (cookieToken !== headerToken) {
    throw new HttpError(403, 'CSRF 令牌校验失败');
  }
}

/** 登录频率限制：同账号与同 IP 双维度滑动窗口 */
export async function assertLoginAllowed(ctx: Ctx, identifier: string): Promise<void> {
  const since = new Date(Date.now() - 15 * 60 * 1000).toISOString().replace('T', ' ').slice(0, 19);

  const byIdent = await ctx.env.DB.prepare(
    `SELECT COUNT(*) AS n FROM login_attempts
      WHERE identifier = ? AND success = 0 AND created_at > ?`
  )
    .bind(identifier, since)
    .first<{ n: number }>();
  if ((byIdent?.n ?? 0) >= 8) {
    throw new HttpError(429, '登录失败次数过多，请 15 分钟后再试');
  }

  const byIp = await ctx.env.DB.prepare(
    `SELECT COUNT(*) AS n FROM login_attempts
      WHERE ip_hash = ? AND success = 0 AND created_at > ?`
  )
    .bind(ctx.ipHash, since)
    .first<{ n: number }>();
  if ((byIp?.n ?? 0) >= 20) {
    throw new HttpError(429, '当前 IP 登录失败次数过多，请稍后再试');
  }
}

export async function recordLoginAttempt(
  ctx: Ctx,
  identifier: string,
  success: boolean
): Promise<void> {
  await ctx.env.DB.prepare(
    'INSERT INTO login_attempts (identifier, ip_hash, success) VALUES (?, ?, ?)'
  )
    .bind(identifier.slice(0, 120), ctx.ipHash, success ? 1 : 0)
    .run();
}

export async function requireAdminSession(ctx: Ctx): Promise<SessionUser> {
  return requireUser(ctx);
}

export { SESSION_TTL_DAYS };
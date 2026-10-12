/** 请求上下文 —— 在 Worker 与路由之间传递已解析的环境、用户与工具方法 */
import type { Env, SessionUser } from './env';
import { sha256Hex } from './crypto';
import { HttpError } from './http';

export interface Ctx {
  env: Env;
  request: Request;
  url: URL;
  params: Record<string, string>;
  user: SessionUser | null;
  /** 真实客户端 IP（Cloudflare 提供的 CF-Connecting-IP） */
  ip: string;
  ipHash: string;
  now: string;
  waitUntil: (p: Promise<unknown>) => void;
  /**
   * 需要下发到最终响应的 Set-Cookie 列表。
   * 之所以用数组而不是 Headers：Headers 会把多个 Set-Cookie 合并成一个
   * 逗号分隔字符串，导致 HttpOnly 的 session 与 csrf 两个 cookie 无法正确分离。
   */
  setCookies: string[];
}

export async function createCtx(
  request: Request,
  env: Env,
  params: Record<string, string> = {},
  waitUntil: (p: Promise<unknown>) => void = () => {}
): Promise<Ctx> {
  const url = new URL(request.url);
  const ip =
    request.headers.get('CF-Connecting-IP') ??
    request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() ??
    '0.0.0.0';
  // IP 哈希盐必须来自环境变量。绝不能回退到固定默认值：
  // 固定盐是公开的，攻击者可用彩虹表反推出访客真实 IP，
  // 且所有站点的哈希都可跨站比对，等同于没有做匿名化。
  const salt = env.IP_HASH_SALT || env.SESSION_SECRET;
  if (!salt) {
    throw new Error(
      '缺少 IP_HASH_SALT（或 SESSION_SECRET）环境变量：' +
        '为保证访客 IP 不可反推，配置缺失时直接拒绝服务而不使用默认值。'
    );
  }
  const ipHash = (await sha256Hex(`${salt}:${ip}`)).slice(0, 32);
  return {
    env,
    request,
    url,
    params,
    user: null,
    ip,
    ipHash,
    now: new Date().toISOString().replace('T', ' ').slice(0, 19),
    waitUntil,
    setCookies: []
  };
}

/** 校验请求体大小上限，避免超大 JSON 打爆内存 */
export async function readJson<T>(ctx: Ctx, maxBytes = 1024 * 1024): Promise<T> {
  const ct = ctx.request.headers.get('content-type') ?? '';
  if (!ct.includes('application/json')) {
    throw new HttpError(400, '请求必须为 application/json');
  }
  const text = await ctx.request.text();
  if (text.length > maxBytes) throw new HttpError(413, '请求体过大');
  if (!text.trim()) throw new HttpError(400, '请求体为空');
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new HttpError(400, 'JSON 格式错误');
  }
}

export function requireUser(ctx: Ctx): SessionUser {
  if (!ctx.user) throw new HttpError(401, '未登录或登录已过期');
  if (ctx.user.status === 'disabled') throw new HttpError(403, '账号已被禁用');
  return ctx.user;
}

export function requireRole(ctx: Ctx, roles: SessionUser['role'][]): SessionUser {
  const user = requireUser(ctx);
  if (!roles.includes(user.role)) throw new HttpError(403, '权限不足');
  return user;
}

export function requireAdmin(ctx: Ctx): SessionUser {
  const user = requireUser(ctx);
  if (user.role !== 'admin') throw new HttpError(403, '需要管理员权限');
  return user;
}

export function intParam(raw: string | undefined | null, fallback: number, min: number, max: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

/** 可选数字参数：null / 空字符串返回 undefined */
export function optInt(raw: string | null | undefined, min: number, max: number): number | undefined {
  if (raw === null || raw === undefined || raw === '') return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n)) return undefined;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

export function boolParam(raw: string | null): boolean {
  return raw === '1' || raw === 'true';
}

/**
 * 从媒体表记录生成公开 URL：对象键与公开 URL 分离存储。
 * Worker 通过 /media/<object_key> 提供 R2 对象，因此必须带该前缀。
 */
export function mediaUrl(objectKey: string, origin: string): string {
  return `${origin.replace(/\/$/, '')}/media/${objectKey}`;
}
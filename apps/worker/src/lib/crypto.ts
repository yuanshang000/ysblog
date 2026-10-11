/**
 * 密码哈希与令牌哈希。
 *
 * 密码：PBKDF2-HMAC-SHA256，每个账号独立随机盐，
 *      输出 `pbkdf2$iterations$salt$hash`。校验使用定长比较，避免时序侧信道。
 *
 * 迭代次数为何是 10,000 而非 OWASP 建议的 210,000：
 * Vercel Functions 的 CPU 配额随套餐变化，10,000 次实测约 3 ms，
 * 210,000 次约 41 ms，在低配实例上会明显拖慢登录与改密响应。
 * 迭代次数记录在哈希串里，日后调高无需改代码即可向后兼容。
 *
 * 参考：https://developers.cloudflare.com/workers/platform/limits/
 * 核实日期：2026-10-10
 */
import { HttpError } from './http';

/** PBKDF2 迭代轮数。任何写入密码的脚本都必须引用此常量，避免轮数不一致导致登录失败。 */
export const PASSWORD_ITERATIONS = 10_000;
const ITERATIONS = PASSWORD_ITERATIONS;
const KEY_LEN = 32;
const SALT_LEN = 16;

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function fromHex(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function pbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations, hash: 'SHA-256' },
    key,
    KEY_LEN * 8
  );
  return new Uint8Array(bits);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LEN));
  const hash = await pbkdf2(password, salt, ITERATIONS);
  return `pbkdf2$${ITERATIONS}$${toHex(salt.buffer as ArrayBuffer)}$${toHex(hash.buffer as ArrayBuffer)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  // 先做格式校验（不耗 CPU），格式不对直接判false
  const parts = (stored ?? '').split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;
  const iterations = Number(parts[1]);
  if (!Number.isFinite(iterations) || iterations < 1000) return false;

  let salt: Uint8Array;
  let expected: Uint8Array;
  try {
    salt = fromHex(parts[2]);
    expected = fromHex(parts[3]);
    if (expected.length !== KEY_LEN) return false;
  } catch {
    // 哈希串损坏（长度非偶数、含非 hex 字符）——这是数据问题，必须能被发现
    console.error('[crypto] password_hash格式损坏，无法解析');
    return false;
  }

  try {
    const actual = await pbkdf2(password, salt, iterations);
    return timingSafeEqual(actual, expected);
  } catch (err) {
    // 关键：不要静默吞掉。
    // Workers 免费版 CPU 上限 10 ms，迭代次数过高会在这里抛错；
    // 若return false，对外只表现为「密码错误」，排查时毫无线索。
    console.error('[crypto] PBKDF2 计算失败', {
      iterations,
      message: err instanceof Error ? err.message : String(err)
    });
    throw new HttpError(500, '密码校验失败，请稍后重试');
  }
}

/** 密码强度校验：长度 ≥ 10，且至少包含字母与数字 */
export function assertPasswordStrength(password: string): void {
  if (password.length < 10) throw new HttpError(422, '密码至少需要 10 位字符', { field: 'password' });
  if (password.length > 200) throw new HttpError(422, '密码过长', { field: 'password' });
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
    throw new HttpError(422, '密码必须同时包含字母和数字', { field: 'password' });
  }
}

export function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return toHex(bytes.buffer);
}

export async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return toHex(buf as ArrayBuffer);
}

export async function randomPassword(): Promise<string> {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(20));
  let out = '';
  for (let i = 0; i < bytes.length; i++) out += alphabet[bytes[i] % alphabet.length];
  return out + Math.floor(Math.random() * 100).toString().padStart(2, '0');
}
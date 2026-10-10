/** 认证相关 API：登录、退出、当前用户、修改密码 */
import type { Ctx } from '../lib/context';
import { readJson } from '../lib/context';
import { HttpError, jsonOk } from '../lib/http';
import {
  assertLoginAllowed,
  createSession,
  destroySession,
  recordLoginAttempt
} from '../lib/auth';
import { hashPassword, verifyPassword, assertPasswordStrength } from '../lib/crypto';
import { logOperation } from '../repositories/db';
import type { User } from '@myblog/shared';

function mapUser(r: Record<string, unknown>): User {
  return {
    id: Number(r.id),
    username: String(r.username),
    email: (r.email as string) ?? null,
    role: r.role as User['role'],
    status: r.status as User['status'],
    avatarUrl: (r.avatar_url as string) ?? null,
    bio: (r.bio as string) ?? null,
    displayName: (r.display_name as string) ?? null,
    createdAt: String(r.created_at),
    lastLoginAt: (r.last_login_at as string) ?? null
  };
}

export async function handleLogin(ctx: Ctx): Promise<Response> {
  const body = await readJson<{ username?: string; password?: string }>(ctx);
  const username = (body.username ?? '').trim();
  const password = body.password ?? '';

  if (!username || !password) {
    throw new HttpError(422, '请输入用户名和密码');
  }

  // 无论账号是否存在都走同一分支，避免账号枚举
  await assertLoginAllowed(ctx, username);

  const row = await ctx.env.DB.prepare('SELECT * FROM users WHERE username = ?')
    .bind(username)
    .first<Record<string, unknown>>();

  const valid = row ? await verifyPassword(password, String(row.password_hash)) : false;

  if (!valid || !row) {
    await recordLoginAttempt(ctx, username, false);
    throw new HttpError(401, '用户名或密码错误');
  }
  if (row.status === 'disabled') {
    await recordLoginAttempt(ctx, username, false);
    throw new HttpError(403, '该账号已被禁用');
  }

  await recordLoginAttempt(ctx, username, true);
  await createSession(ctx, Number(row.id));
  await ctx.env.DB.prepare('UPDATE users SET last_login_at = ? WHERE id = ?')
    .bind(ctx.now, row.id)
    .run();
  await logOperation(ctx.env, Number(row.id), username, 'auth.login', 'user', Number(row.id));

  // 登录成功后清除该账号的历史失败记录
  await ctx.env.DB.prepare(
    'DELETE FROM login_attempts WHERE identifier = ? AND success = 0'
  ).bind(username).run();

  return jsonOk(mapUser(row), 200, '登录成功');
}

export async function handleLogout(ctx: Ctx): Promise<Response> {
  if (ctx.user) {
    await logOperation(ctx.env, ctx.user.id, ctx.user.username, 'auth.logout', 'user', ctx.user.id);
  }
  await destroySession(ctx);
  return jsonOk({ ok: true }, 200, '已退出登录');
}

export async function handleMe(ctx: Ctx): Promise<Response> {
  if (!ctx.user) throw new HttpError(401, '未登录');
  const row = await ctx.env.DB.prepare('SELECT * FROM users WHERE id = ?')
    .bind(ctx.user.id)
    .first<Record<string, unknown>>();
  if (!row) throw new HttpError(401, '用户不存在');
  return jsonOk(mapUser(row));
}

export async function handleUpdateProfile(ctx: Ctx): Promise<Response> {
  if (!ctx.user) throw new HttpError(401, '未登录');
  const body = await readJson<{
    displayName?: string;
    email?: string;
    avatarUrl?: string;
    bio?: string;
  }>(ctx);

  await ctx.env.DB.prepare(
    `UPDATE users SET display_name = ?, email = ?, avatar_url = ?, bio = ?, updated_at = ? WHERE id = ?`
  )
    .bind(
      body.displayName?.trim() || null,
      body.email?.trim() || null,
      body.avatarUrl || null,
      body.bio?.trim() || null,
      ctx.now,
      ctx.user.id
    )
    .run();

  await logOperation(ctx.env, ctx.user.id, ctx.user.username, 'user.profile_update', 'user', ctx.user.id);
  const row = await ctx.env.DB.prepare('SELECT * FROM users WHERE id = ?')
    .bind(ctx.user.id)
    .first<Record<string, unknown>>();
  return jsonOk(mapUser(row!), 200, '资料已更新');
}

export async function handleChangePassword(ctx: Ctx): Promise<Response> {
  if (!ctx.user) throw new HttpError(401, '未登录');
  const body = await readJson<{ currentPassword?: string; newPassword?: string }>(ctx);
  if (!body.currentPassword || !body.newPassword) {
    throw new HttpError(422, '请填写当前密码和新密码');
  }
  const row = await ctx.env.DB.prepare('SELECT password_hash FROM users WHERE id = ?')
    .bind(ctx.user.id)
    .first<{ password_hash: string }>();
  if (!row) throw new HttpError(404, '用户不存在');

  if (!(await verifyPassword(body.currentPassword, row.password_hash))) {
    await recordLoginAttempt(ctx, ctx.user.username, false);
    throw new HttpError(401, '当前密码不正确');
  }
  assertPasswordStrength(body.newPassword);

  const hash = await hashPassword(body.newPassword);
  await ctx.env.DB.prepare(
    'UPDATE users SET password_hash = ?, password_algo = ?, updated_at = ? WHERE id = ?'
  )
    .bind(hash, 'pbkdf2-sha256', ctx.now, ctx.user.id)
    .run();

  // 改密后使该用户其他会话失效，仅保留当前会话
  await ctx.env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(ctx.user.id).run();
  await createSession(ctx, ctx.user.id);
  await logOperation(ctx.env, ctx.user.id, ctx.user.username, 'user.password_change', 'user', ctx.user.id);
  return jsonOk({ ok: true }, 200, '密码已更新，其他设备需重新登录');
}

/** 首次部署：创建初始管理员（需要 setup token 保护） */
export async function handleSetup(ctx: Ctx): Promise<Response> {
  const expected = ctx.env.ADMIN_SETUP_TOKEN;
  if (!expected) {
    throw new HttpError(403, '未配置 ADMIN_SETUP_TOKEN，已禁用初始化接口');
  }
  const body = await readJson<{
    token?: string;
    username?: string;
    password?: string;
    email?: string;
  }>(ctx);
  if (body.token !== expected) throw new HttpError(403, '初始化令牌无效');

  const countRow = await ctx.env.DB.prepare('SELECT COUNT(*) AS n FROM users').first<{ n: number }>();
  if ((countRow?.n ?? 0) > 0) {
    throw new HttpError(409, '系统已存在用户，请通过登录后修改密码来管理账号');
  }

  const username = (body.username ?? '').trim();
  const password = body.password ?? '';
  if (!username || !/^[A-Za-z0-9_.-]{3,32}$/.test(username)) {
    throw new HttpError(422, '用户名需为 3-32 位字母、数字、下划线、点或连字符', { field: 'username' });
  }
  assertPasswordStrength(password);

  const hash = await hashPassword(password);
  const now = ctx.now;
  const result = await ctx.env.DB.prepare(
    `INSERT INTO users (username, email, password_hash, password_algo, role, status, display_name, created_at, updated_at)
     VALUES (?, ?, ?, 'pbkdf2-sha256', 'admin', 'active', ?, ?, ?)`
  )
    .bind(username, body.email?.trim() || null, hash, username, now, now)
    .run();

  const id = Number(result.meta.last_row_id);
  await logOperation(ctx.env, id, username, 'system.setup', 'user', id);
  return jsonOk({ id, username }, 201, '管理员已创建，请立即登录并修改密码');
}

/** 站点是否已完成初始化 */
export async function handleSetupStatus(ctx: Ctx): Promise<Response> {
  const row = await ctx.env.DB.prepare('SELECT COUNT(*) AS n FROM users').first<{ n: number }>();
  return jsonOk({ initialized: (row?.n ?? 0) > 0 });
}
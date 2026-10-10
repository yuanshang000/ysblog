/** 评论 API —— 公开提交 + 管理端审核 */
import type { Ctx } from '../lib/context';
import { readJson, requireUser, intParam, optInt } from '../lib/context';
import { HttpError, jsonOk } from '../lib/http';
import { getPostById, listComments, logOperation } from '../repositories/db';
import { getSettings } from '../services/settings';
import { escapeHtml } from '@myblog/shared';

const MAX_NAME = 40;
const MAX_CONTENT = 2000;
const MAX_LINKS = 3;

/** 垃圾评论启发式检测 */
function looksLikeSpam(text: string): boolean {
  const linkCount = (text.match(/https?:\/\//g) ?? []).length;
  if (linkCount > MAX_LINKS) return true;
  if (/(viagra|casino|crypto\s*airdrop|free\s*money|加微信|代开发票|色情|博彩)/i.test(text)) return true;
  if (/(.)\1{12,}/.test(text)) return true;
  const letters = text.match(/[A-Za-z]/g)?.length ?? 0;
  const digits = text.match(/[0-9]/g)?.length ?? 0;
  if (letters > 12 && digits / Math.max(1, letters) > 0.5) return true;
  return false;
}

/** 提交频率限制：同 IP 60 秒内最多 2 条 */
async function assertCommentRate(ctx: Ctx, postId: number): Promise<void> {
  const since = new Date(Date.now() - 60 * 1000).toISOString().replace('T', ' ').slice(0, 19);
  const row = await ctx.env.DB.prepare(
    'SELECT COUNT(*) AS n FROM comments WHERE ip_hash = ? AND created_at > ?'
  )
    .bind(ctx.ipHash, since)
    .first<{ n: number }>();
  if ((row?.n ?? 0) >= 2) throw new HttpError(429, '评论提交过于频繁，请稍后再试');
  const dup = await ctx.env.DB.prepare(
    'SELECT COUNT(*) AS n FROM comments WHERE ip_hash = ? AND post_id = ? AND created_at > ?'
  )
    .bind(ctx.ipHash, postId, since)
    .first<{ n: number }>();
  if ((dup?.n ?? 0) >= 1) throw new HttpError(429, '请勿在同一篇文章下重复评论');
}

/** 读取某篇文章的已公开评论（构建两级树） */
export async function handleCommentList(ctx: Ctx): Promise<Response> {
  const postId = intParam(ctx.params.id, 0, 1, 1e9);
  const settings = await getSettings(ctx.env);
  if (!settings.commentEnabled) return jsonOk({ enabled: false, items: [], count: 0 });

  const all = await listComments(ctx.env, { postId, status: 'approved', pageSize: 100 });
  const items = all.items.map((c) => ({
    id: c.id,
    parentId: c.parentId,
    authorName: c.authorName,
    // 邮箱绝不返回给前端
    content: c.content,
    createdAt: c.createdAt,
    website: c.authorWebsite
  }));

  const byParent = new Map<number | null, typeof items>();
  for (const c of items) {
    const parentId = c.parentId ?? null;
    const list = byParent.get(parentId) ?? [];
    list.push(c);
    byParent.set(parentId, list);
  }
  const tree = byParent.get(null) ?? [];

  return jsonOk({ enabled: true, items: tree, count: all.total, moderated: settings.commentModeration });
}

/** 提交评论 */
export async function handleCommentCreate(ctx: Ctx): Promise<Response> {
  const postId = intParam(ctx.params.id, 0, 1, 1e9);
  const settings = await getSettings(ctx.env);
  if (!settings.commentEnabled) throw new HttpError(403, '本站评论功能已关闭');

  const post = await getPostById(ctx.env, postId, ctx.url.origin);
  if (!post || post.status !== 'published' || post.deletedAt) {
    throw new HttpError(404, '文章不存在');
  }

  const body = await readJson<{
    authorName?: string;
    authorEmail?: string;
    authorWebsite?: string;
    content?: string;
    parentId?: number | null;
  }>(ctx);

  const name = (body.authorName ?? '').trim().slice(0, MAX_NAME);
  const content = (body.content ?? '').trim().slice(0, MAX_CONTENT);
  if (!name) throw new HttpError(422, '请填写昵称', { field: 'authorName' });
  if (content.length < 2) throw new HttpError(422, '评论内容太短', { field: 'content' });

  // 邮箱格式校验（可选字段）
  if (body.authorEmail && !/^[\w.+-]+@[\w-]+\.[\w.-]+$/.test(body.authorEmail.trim())) {
    throw new HttpError(422, '邮箱格式不正确', { field: 'authorEmail' });
  }
  // 只允许 http/https 链接
  let website: string | null = null;
  if (body.authorWebsite?.trim()) {
    const w = body.authorWebsite.trim();
    if (!/^https?:\/\/[\w.-]+\.[a-z]{2,}/i.test(w)) {
      throw new HttpError(422, '网站地址必须以 http(s):// 开头', { field: 'authorWebsite' });
    }
    website = w.slice(0, 200);
  }

  let parentId: number | null = null;
  if (body.parentId) {
    const parent = await ctx.env.DB.prepare('SELECT id, status FROM comments WHERE id = ? AND post_id = ?')
      .bind(body.parentId, postId)
      .first<{ id: number; status: string }>();
    if (!parent || parent.status !== 'approved') throw new HttpError(422, '回复的评论不存在');
    parentId = parent.id;
  }

  await assertCommentRate(ctx, postId);

  const isSpam = looksLikeSpam(content) || looksLikeSpam(name);
  // 开启审核时一律进待审核；命中垃圾规则直接进垃圾箱
  const status = isSpam ? 'spam' : settings.commentModeration ? 'pending' : 'approved';

  const result = await ctx.env.DB.prepare(
    `INSERT INTO comments
      (post_id, parent_id, author_name, author_email, author_website, content, status, ip_hash, user_agent, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      postId,
      parentId,
      name,
      body.authorEmail?.trim() || null,
      website,
      content,
      status,
      ctx.ipHash,
      (ctx.request.headers.get('user-agent') ?? '').slice(0, 300),
      ctx.now
    )
    .run();

  const message =
    status === 'approved'
      ? '评论已提交'
      : status === 'spam'
        ? '评论已提交，检测到可疑内容，已转入垃圾箱'
        : '评论已提交，等待管理员审核后显示';

  return jsonOk(
    { id: Number(result.meta.last_row_id), status, message },
    201,
    message
  );
}

/** 管理端评论列表 */
export async function handleAdminCommentList(ctx: Ctx): Promise<Response> {
  requireUser(ctx);
  const statusParam = ctx.url.searchParams.get('status');
  const status =
    statusParam === 'pending' || statusParam === 'approved' || statusParam === 'spam' || statusParam === 'deleted'
      ? statusParam
      : undefined;
  const postId = optInt(ctx.url.searchParams.get('postId'), 1, 1e9);
  const page = intParam(ctx.url.searchParams.get('page'), 1, 1, 10000);
  const pageSize = intParam(ctx.url.searchParams.get('pageSize'), 20, 1, 100);

  const result = await listComments(ctx.env, { postId, status, page, pageSize });

  // 批量取文章标题，避免 N+1
  const postIds = [...new Set(result.items.map((c) => c.postId))];
  const titles = new Map<number, string>();
  if (postIds.length) {
    const placeholders = postIds.map(() => '?').join(',');
    const rows = await ctx.env.DB.prepare(`SELECT id, title FROM posts WHERE id IN (${placeholders})`)
      .bind(...postIds)
      .all<{ id: number; title: string }>();
    for (const r of rows.results) titles.set(r.id, r.title);
  }

  // 管理端可见邮箱与 IP 哈希（不返回原始 IP）
  return jsonOk({
    ...result,
    items: result.items.map((c) => ({
      ...c,
      postTitle: titles.get(c.postId) ?? '（文章已删除）'
    }))
  });
}

/** 审核 / 状态变更 */
export async function handleCommentUpdate(ctx: Ctx): Promise<Response> {
  const user = requireUser(ctx);
  const id = intParam(ctx.params.id, 0, 1, 1e9);
  const body = await readJson<{ status?: 'pending' | 'approved' | 'spam' | 'deleted' }>(ctx);
  const status = body.status;
  if (!status || !['pending', 'approved', 'spam', 'deleted'].includes(status)) {
    throw new HttpError(422, '无效的评论状态');
  }
  await ctx.env.DB.prepare(
    'UPDATE comments SET status = ?, moderated_at = ?, moderated_by = ? WHERE id = ?'
  )
    .bind(status, ctx.now, user.id, id)
    .run();
  await logOperation(ctx.env, user.id, user.username, `comment.${status}`, 'comment', id);
  return jsonOk({ id, status }, 200, '评论状态已更新');
}

/** 批量审核 */
export async function handleCommentBatch(ctx: Ctx): Promise<Response> {
  const user = requireUser(ctx);
  const body = await readJson<{ ids: number[]; status: string }>(ctx);
  if (!Array.isArray(body.ids) || !body.ids.length) throw new HttpError(422, '请选择评论');
  if (!['approved', 'spam', 'deleted', 'pending'].includes(body.status)) throw new HttpError(422, '无效状态');

  const placeholders = body.ids.map(() => '?').join(',');
  await ctx.env.DB.prepare(
    `UPDATE comments SET status = ?, moderated_at = ?, moderated_by = ? WHERE id IN (${placeholders})`
  )
    .bind(body.status, ctx.now, user.id, ...body.ids)
    .run();
  await logOperation(ctx.env, user.id, user.username, `comment.batch_${body.status}`, 'comment', null, `${body.ids.length} 条`);
  return jsonOk({ affected: body.ids.length });
}

export async function handleCommentDelete(ctx: Ctx): Promise<Response> {
  const user = requireUser(ctx);
  const id = intParam(ctx.params.id, 0, 1, 1e9);
  await ctx.env.DB.prepare('DELETE FROM comments WHERE id = ?').bind(id).run();
  await logOperation(ctx.env, user.id, user.username, 'comment.delete', 'comment', id);
  return jsonOk({ id, deleted: true }, 200, '评论已删除');
}

export { escapeHtml };
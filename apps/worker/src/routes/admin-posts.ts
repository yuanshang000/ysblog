/**
 * 文章与页面管理 API。
 *
 * 关键设计：
 * - 状态机在服务端校验，非法流转直接 422；
 * - 更新走「乐观锁」：客户端回传 baseRevision，与库中 revision 不一致即 409，
 *   防止多标签页互相覆盖；
 * - 自动保存只写草稿，绝不自动公开；
 * - 发布前生成版本快照，可回滚。
 */
import type { Ctx } from '../lib/context';
import { readJson, requireUser, intParam, optInt } from '../lib/context';
import { HttpError, jsonOk } from '../lib/http';
import {
  getPostById,
  getPostBySlug,
  listPosts,
  saveRevision,
  setPostCategories,
  setPostTags,
  findOrCreateTag,
  uniqueSlug,
  slugExists,
  getPostCategories,
  getRevision,
  listRevisions,
  adjacentPosts,
  relatedPosts,
  logOperation,
  countPostsByStatus
} from '../repositories/db';
import { countWords, excerptFrom, readingTime, renderMarkdown, slugify, slugOrFallback } from '@myblog/shared';
import type { PostStatus, PostType } from '@myblog/shared';

const VALID_STATUS: PostStatus[] = ['draft', 'published', 'scheduled', 'archived', 'trashed'];

/** 允许的状态流转 */
const TRANSITIONS: Record<PostStatus, PostStatus[]> = {
  draft: ['draft', 'published', 'archived', 'trashed'],
  published: ['published', 'draft', 'archived', 'trashed'],
  scheduled: ['scheduled', 'published', 'draft', 'archived', 'trashed'],
  archived: ['archived', 'published', 'draft', 'trashed'],
  trashed: ['trashed', 'draft', 'archived']
};

function assertTransition(from: PostStatus, to: PostStatus): void {
  if (!VALID_STATUS.includes(to)) throw new HttpError(422, `非法的文章状态：${to}`);
  if (!TRANSITIONS[from].includes(to)) {
    throw new HttpError(422, `不允许的状态流转：${from} → ${to}`);
  }
}

interface PostInput {
  title?: string;
  slug?: string;
  content?: string;
  excerpt?: string;
  coverMediaId?: number | null;
  coverAlt?: string | null;
  status?: PostStatus;
  type?: PostType;
  isFeatured?: boolean;
  sortOrder?: number;
  seoTitle?: string | null;
  seoDescription?: string | null;
  canonicalUrl?: string | null;
  robotsIndex?: boolean;
  categoryIds?: number[];
  tagNames?: string[];
  scheduledAt?: string | null;
  publishedAt?: string | null;
  baseRevision?: number;
  /** true 表示这是自动保存（跳过快照生成与状态变更） */
  autoSave?: boolean;
}

function normalize(input: PostInput): { title: string; content: string; excerpt: string } {
  const title = (input.title ?? '').trim();
  const content = input.content ?? '';
  if (!title && content) {
    throw new HttpError(422, '请填写文章标题', { field: 'title' });
  }
  if (title.length > 200) throw new HttpError(422, '标题过长（最多 200 字符）', { field: 'title' });
  const excerpt = (input.excerpt ?? '').trim() || excerptFrom(content, 160);
  return { title, content, excerpt: excerpt.slice(0, 500) };
}

function metrics(content: string): { wordCount: number; readingTime: number } {
  const wordCount = countWords(content);
  return { wordCount, readingTime: readingTime(wordCount) };
}

/** 管理端文章列表（支持全部状态与筛选） */
export async function handleAdminPostList(ctx: Ctx): Promise<Response> {
  requireUser(ctx);
  const statusParam = ctx.url.searchParams.get('status') ?? 'any';
  const status =
    statusParam === 'any'
      ? 'any'
      : VALID_STATUS.includes(statusParam as PostStatus)
        ? (statusParam as PostStatus)
        : 'any';

  const page = intParam(ctx.url.searchParams.get('page'), 1, 1, 10000);
  const pageSize = intParam(ctx.url.searchParams.get('pageSize'), 20, 1, 50);
  const typeParam = ctx.url.searchParams.get('type');
  const { items, total } = await listPosts(
    ctx.env,
    {
      type: typeParam === 'page' ? 'page' : typeParam === 'post' ? 'post' : undefined,
      status,
      keyword: ctx.url.searchParams.get('q')?.trim() || undefined,
      categoryId: optInt(ctx.url.searchParams.get('categoryId'), 1, 1e9),
      tagId: optInt(ctx.url.searchParams.get('tagId'), 1, 1e9),
      page,
      pageSize
    },
    ctx.url.origin
  );
  return jsonOk({
    items,
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    counts: await countPostsByStatus(ctx.env)
  });
}

/** 新建文章 */
export async function handleCreatePost(ctx: Ctx): Promise<Response> {
  const user = requireUser(ctx);
  const input = await readJson<PostInput>(ctx);
  const type: PostType = input.type === 'page' ? 'page' : 'post';
  const { title, content, excerpt } = normalize(input);
  const now = ctx.now;
  const m = metrics(content);

  // 未命名文章给一个占位标题，避免空标题破坏 URL
  const finalTitle = title || '无标题文章';
  const baseSlug = slugOrFallback(input.slug?.trim() || finalTitle, 'post');
  const slug = await uniqueSlug(ctx.env, 'posts', baseSlug);

  // 新建一律为草稿，绝不因填写了状态就直接公开
  const publishedAt = input.publishedAt ?? null;

  const result = await ctx.env.DB.prepare(
    `INSERT INTO posts
      (author_id, type, title, slug, excerpt, content, content_format, cover_media_id, cover_alt,
       status, is_featured, sort_order, word_count, reading_time, seo_title, seo_description,
       canonical_url, robots_index, revision, published_at, scheduled_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'markdown', ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`
  )
    .bind(
      user.id,
      type,
      finalTitle,
      slug,
      excerpt,
      content,
      input.coverMediaId ?? null,
      input.coverAlt ?? null,
      input.isFeatured ? 1 : 0,
      input.sortOrder ?? 0,
      m.wordCount,
      m.readingTime,
      input.seoTitle ?? null,
      input.seoDescription ?? null,
      input.canonicalUrl ?? null,
      input.robotsIndex === false ? 0 : 1,
      publishedAt,
      input.scheduledAt ?? null,
      now,
      now
    )
    .run();

  const id = Number(result.meta.last_row_id);

  if (input.categoryIds?.length) await setPostCategories(ctx.env, id, input.categoryIds);
  if (input.tagNames?.length) {
    const tagIds: number[] = [];
    for (const name of input.tagNames) {
      const clean = name.trim();
      if (!clean) continue;
      tagIds.push(await findOrCreateTag(ctx.env, clean, slugOrFallback(clean, 'tag')));
    }
    await setPostTags(ctx.env, id, tagIds);
  }

  await saveRevision(ctx.env, id, {
    title: finalTitle,
    excerpt,
    content,
    revision: 1,
    userId: user.id
  });
  await logOperation(ctx.env, user.id, user.username, 'post.create', 'post', id, finalTitle);

  const post = await getPostById(ctx.env, id, ctx.url.origin);
  return jsonOk(post, 201, '已创建草稿');
}

/** 更新文章（含自动保存） */
export async function handleUpdatePost(ctx: Ctx): Promise<Response> {
  const user = requireUser(ctx);
  const id = intParam(ctx.params.id, 0, 1, 1e9);
  if (!id) throw new HttpError(400, '无效的文章 ID');

  const existing = await getPostById(ctx.env, id, ctx.url.origin);
  if (!existing) throw new HttpError(404, '文章不存在');

  const input = await readJson<PostInput>(ctx);
  const isAutoSave = input.autoSave === true;

  // 乐观锁：客户端必须回传它读到的版本号
  if (typeof input.baseRevision === 'number' && input.baseRevision !== existing.revision) {
    throw new HttpError(409, '内容已被其他标签页或会话修改，请刷新后重试', {
      currentRevision: existing.revision,
      serverUpdatedAt: existing.updatedAt
    });
  }

  const { title, content, excerpt } = normalize({
    ...input,
    title: input.title ?? existing.title,
    content: input.content ?? existing.content
  });
  const m = metrics(content);

  let slug = existing.slug;
  if (input.slug !== undefined && input.slug.trim()) {
    const desired = slugify(input.slug);
    if (desired && desired !== existing.slug) {
      if (await slugExists(ctx.env, 'posts', desired, id)) {
        throw new HttpError(409, `URL 别名 ${desired} 已被其他文章占用`, { field: 'slug' });
      }
      slug = desired;
    }
  }

  // 状态变更必须显式声明并通过状态机校验
  let status = existing.status;
  if (input.status && input.status !== existing.status) {
    assertTransition(existing.status, input.status);
    status = input.status;
  }

  const now = ctx.now;
  let publishedAt = existing.publishedAt;
  if (status === 'published' && !publishedAt) {
    publishedAt = input.publishedAt ?? now;
  }

  await ctx.env.DB.prepare(
    `UPDATE posts SET
      title = ?, slug = ?, excerpt = ?, content = ?, cover_media_id = ?, cover_alt = ?,
      status = ?, is_featured = ?, sort_order = ?, word_count = ?, reading_time = ?,
      seo_title = ?, seo_description = ?, canonical_url = ?, robots_index = ?,
      scheduled_at = ?, published_at = ?, updated_at = ?, revision = revision + 1,
      deleted_at = CASE WHEN ? = 'trashed' THEN ? ELSE deleted_at END
    WHERE id = ?`
  )
    .bind(
      title,
      slug,
      excerpt,
      content,
      input.coverMediaId !== undefined ? input.coverMediaId : existing.coverMediaId,
      input.coverAlt !== undefined ? input.coverAlt : existing.coverAlt,
      status,
      input.isFeatured !== undefined ? (input.isFeatured ? 1 : 0) : existing.isFeatured ? 1 : 0,
      input.sortOrder ?? existing.sortOrder,
      m.wordCount,
      m.readingTime,
      input.seoTitle !== undefined ? input.seoTitle : existing.seoTitle,
      input.seoDescription !== undefined ? input.seoDescription : existing.seoDescription,
      input.canonicalUrl !== undefined ? input.canonicalUrl : existing.canonicalUrl,
      input.robotsIndex !== undefined ? (input.robotsIndex ? 1 : 0) : existing.robotsIndex ? 1 : 0,
      input.scheduledAt !== undefined ? input.scheduledAt : existing.scheduledAt,
      publishedAt,
      now,
      status,
      status === 'trashed' ? now : null,
      id
    )
    .run();

  if (input.categoryIds !== undefined) {
    await setPostCategories(ctx.env, id, input.categoryIds);
  }
  if (input.tagNames !== undefined) {
    const tagIds: number[] = [];
    for (const name of input.tagNames) {
      const clean = name.trim();
      if (!clean) continue;
      tagIds.push(await findOrCreateTag(ctx.env, clean, slugOrFallback(clean, 'tag')));
    }
    await setPostTags(ctx.env, id, tagIds);
  }

  const updated = await getPostById(ctx.env, id, ctx.url.origin);

  // 自动保存只保留有限快照，避免版本表膨胀
  if (!isAutoSave) {
    await saveRevision(
      ctx.env,
      id,
      { title, excerpt, content, revision: updated!.revision, userId: user.id },
      isAutoSave ? 10 : 30
    );
  } else {
    await ctx.env.DB.prepare(
      `INSERT INTO post_revisions (post_id, title, excerpt, content, revision, created_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(post_id, revision) DO NOTHING`
    )
      .bind(id, title, excerpt, content, updated!.revision, now, user.id)
      .run();
  }

  if (!isAutoSave) {
    await logOperation(ctx.env, user.id, user.username, 'post.update', 'post', id, title);
  }

  return jsonOk(updated);
}

/** 发布 */
export async function handlePublishPost(ctx: Ctx): Promise<Response> {
  const user = requireUser(ctx);
  const id = intParam(ctx.params.id, 0, 1, 1e9);
  const existing = await getPostById(ctx.env, id, ctx.url.origin);
  if (!existing) throw new HttpError(404, '文章不存在');

  if (existing.status === 'trashed') throw new HttpError(422, '回收站中的文章无法直接发布');
  if (!existing.title.trim() || !existing.content.trim()) {
    throw new HttpError(422, '标题和正文不能为空，无法发布', { field: 'content' });
  }
  assertTransition(existing.status, 'published');

  const now = ctx.now;
  await ctx.env.DB.prepare(
    `UPDATE posts SET status = 'published', published_at = COALESCE(published_at, ?),
      scheduled_at = NULL, deleted_at = NULL, updated_at = ?, revision = revision + 1
     WHERE id = ?`
  )
    .bind(now, now, id)
    .run();

  const post = await getPostById(ctx.env, id, ctx.url.origin);
  await saveRevision(ctx.env, id, {
    title: post!.title,
    excerpt: post!.excerpt,
    content: post!.content,
    revision: post!.revision,
    userId: user.id
  });
  await logOperation(ctx.env, user.id, user.username, 'post.publish', 'post', id, post!.title);

  return jsonOk(post, 200, '发布成功');
}

/** 定时发布 */
export async function handleSchedulePost(ctx: Ctx): Promise<Response> {
  const user = requireUser(ctx);
  const id = intParam(ctx.params.id, 0, 1, 1e9);
  const existing = await getPostById(ctx.env, id, ctx.url.origin);
  if (!existing) throw new HttpError(404, '文章不存在');

  const body = await readJson<{ scheduledAt?: string }>(ctx);
  if (!body.scheduledAt) throw new HttpError(422, '请指定定时发布时间', { field: 'scheduledAt' });
  const at = new Date(body.scheduledAt.replace(' ', 'T') + (body.scheduledAt.includes('Z') ? '' : 'Z'));
  if (Number.isNaN(at.getTime())) throw new HttpError(422, '定时发布时间格式无效', { field: 'scheduledAt' });
  if (at.getTime() <= Date.now()) {
    throw new HttpError(422, '定时发布时间必须晚于当前时间', { field: 'scheduledAt' });
  }
  assertTransition(existing.status, 'scheduled');

  const scheduledAt = at.toISOString().replace('T', ' ').slice(0, 19);
  await ctx.env.DB.prepare(
    `UPDATE posts SET status='scheduled', scheduled_at=?, updated_at=?, revision = revision + 1 WHERE id=?`
  )
    .bind(scheduledAt, ctx.now, id)
    .run();

  const post = await getPostById(ctx.env, id, ctx.url.origin);
  await logOperation(ctx.env, user.id, user.username, 'post.schedule', 'post', id, scheduledAt);
  return jsonOk(post, 200, '已设定定时发布');
}

/** 取消定时 */
export async function handleUnschedulePost(ctx: Ctx): Promise<Response> {
  const user = requireUser(ctx);
  const id = intParam(ctx.params.id, 0, 1, 1e9);
  const existing = await getPostById(ctx.env, id, ctx.url.origin);
  if (!existing) throw new HttpError(404, '文章不存在');
  assertTransition(existing.status, 'draft');
  await ctx.env.DB.prepare(
    `UPDATE posts SET status='draft', scheduled_at=NULL, updated_at=?, revision=revision+1 WHERE id=?`
  )
    .bind(ctx.now, id)
    .run();
  await logOperation(ctx.env, user.id, user.username, 'post.unschedule', 'post', id);
  return jsonOk(await getPostById(ctx.env, id, ctx.url.origin), 200, '已取消定时发布');
}

/** 归档 */
export async function handleArchivePost(ctx: Ctx): Promise<Response> {
  const user = requireUser(ctx);
  const id = intParam(ctx.params.id, 0, 1, 1e9);
  const existing = await getPostById(ctx.env, id, ctx.url.origin);
  if (!existing) throw new HttpError(404, '文章不存在');
  assertTransition(existing.status, 'archived');
  await ctx.env.DB.prepare(
    `UPDATE posts SET status='archived', updated_at=?, revision=revision+1 WHERE id=?`
  )
    .bind(ctx.now, id)
    .run();
  await logOperation(ctx.env, user.id, user.username, 'post.archive', 'post', id, existing.title);
  return jsonOk(await getPostById(ctx.env, id, ctx.url.origin));
}

/** 移入回收站（软删除） */
export async function handleTrashPost(ctx: Ctx): Promise<Response> {
  const user = requireUser(ctx);
  const id = intParam(ctx.params.id, 0, 1, 1e9);
  const existing = await getPostById(ctx.env, id, ctx.url.origin);
  if (!existing) throw new HttpError(404, '文章不存在');
  assertTransition(existing.status, 'trashed');
  await ctx.env.DB.prepare(
    `UPDATE posts SET status='trashed', deleted_at=?, updated_at=?, revision=revision+1 WHERE id=?`
  )
    .bind(ctx.now, ctx.now, id)
    .run();
  await logOperation(ctx.env, user.id, user.username, 'post.trash', 'post', id, existing.title);
  return jsonOk({ id, status: 'trashed' });
}

/** 从回收站恢复 */
export async function handleRestorePost(ctx: Ctx): Promise<Response> {
  const user = requireUser(ctx);
  const id = intParam(ctx.params.id, 0, 1, 1e9);
  const existing = await getPostById(ctx.env, id, ctx.url.origin);
  if (!existing) throw new HttpError(404, '文章不存在');
  assertTransition(existing.status, 'draft');
  await ctx.env.DB.prepare(
    `UPDATE posts SET status='draft', deleted_at=NULL, updated_at=?, revision=revision+1 WHERE id=?`
  )
    .bind(ctx.now, id)
    .run();
  await logOperation(ctx.env, user.id, user.username, 'post.restore', 'post', id, existing.title);
  return jsonOk(await getPostById(ctx.env, id, ctx.url.origin), 200, '已恢复到草稿箱');
}

/** 永久删除（需显式确认） */
export async function handleDeleteForever(ctx: Ctx): Promise<Response> {
  const user = requireUser(ctx);
  const id = intParam(ctx.params.id, 0, 1, 1e9);
  const existing = await getPostById(ctx.env, id, ctx.url.origin);
  if (!existing) throw new HttpError(404, '文章不存在');

  // 二次确认：必须显式传 confirm=true
  const confirm = ctx.url.searchParams.get('confirm') === 'true';
  if (!confirm) throw new HttpError(400, '永久删除需要 confirm=true 参数');

  await ctx.env.DB.prepare('DELETE FROM posts WHERE id = ?').bind(id).run();
  await logOperation(ctx.env, user.id, user.username, 'post.delete_forever', 'post', id, existing.title);
  return jsonOk({ id, deleted: true }, 200, '已永久删除');
}

/** 复制文章 */
export async function handleDuplicatePost(ctx: Ctx): Promise<Response> {
  const user = requireUser(ctx);
  const id = intParam(ctx.params.id, 0, 1, 1e9);
  const src = await getPostById(ctx.env, id, ctx.url.origin);
  if (!src) throw new HttpError(404, '文章不存在');

  const title = `${src.title}（副本）`.slice(0, 200);
  const slug = await uniqueSlug(ctx.env, 'posts', slugOrFallback(`${src.slug}-copy`, 'copy'));
  const m = metrics(src.content);
  const result = await ctx.env.DB.prepare(
    `INSERT INTO posts
      (author_id, type, title, slug, excerpt, content, content_format, cover_media_id, cover_alt,
       status, word_count, reading_time, seo_title, seo_description, created_at, updated_at, revision)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, 1)`
  )
    .bind(
      user.id,
      src.type,
      title,
      slug,
      src.excerpt,
      src.content,
      src.contentFormat,
      src.coverMediaId,
      src.coverAlt,
      m.wordCount,
      m.readingTime,
      src.seoTitle,
      src.seoDescription,
      ctx.now,
      ctx.now
    )
    .run();
  const newId = Number(result.meta.last_row_id);
  const cats = await getPostCategories(ctx.env, src.id);
  if (cats.length) await setPostCategories(ctx.env, newId, cats.map((c) => c.id));
  if (src.tags.length) await setPostTags(ctx.env, newId, src.tags.map((t) => t.id));
  await logOperation(ctx.env, user.id, user.username, 'post.duplicate', 'post', newId, title);
  return jsonOk(await getPostById(ctx.env, newId, ctx.url.origin), 201, '已复制为新草稿');
}

/** 版本历史列表 */
export async function handleRevisionList(ctx: Ctx): Promise<Response> {
  requireUser(ctx);
  const id = intParam(ctx.params.id, 0, 1, 1e9);
  const revisions = await listRevisions(ctx.env, id);
  return jsonOk(revisions);
}

/** 版本详情（含正文，供差异对比） */
export async function handleRevisionDetail(ctx: Ctx): Promise<Response> {
  requireUser(ctx);
  const id = intParam(ctx.params.id, 0, 1, 1e9);
  const revId = intParam(ctx.params.revId, 0, 1, 1e9);
  const rev = await getRevision(ctx.env, id, revId);
  if (!rev) throw new HttpError(404, '版本不存在');
  const { html } = renderMarkdown(rev.content);
  return jsonOk({ ...rev, html });
}

/** 恢复历史版本：先把当前内容备份为快照，再回滚 */
export async function handleRestoreRevision(ctx: Ctx): Promise<Response> {
  const user = requireUser(ctx);
  const id = intParam(ctx.params.id, 0, 1, 1e9);
  const revId = intParam(ctx.params.revId, 0, 1, 1e9);
  const current = await getPostById(ctx.env, id, ctx.url.origin);
  if (!current) throw new HttpError(404, '文章不存在');
  const rev = await getRevision(ctx.env, id, revId);
  if (!rev) throw new HttpError(404, '版本不存在');

  // 恢复前先备份当前状态，避免误操作丢失内容
  await saveRevision(ctx.env, id, {
    title: current.title,
    excerpt: current.excerpt,
    content: current.content,
    revision: current.revision,
    userId: user.id
  });

  const m = metrics(rev.content);
  await ctx.env.DB.prepare(
    `UPDATE posts SET title=?, excerpt=?, content=?, word_count=?, reading_time=?,
      updated_at=?, revision = revision + 1 WHERE id=?`
  )
    .bind(rev.title, rev.excerpt, rev.content, m.wordCount, m.readingTime, ctx.now, id)
    .run();

  await logOperation(ctx.env, user.id, user.username, 'post.restore_revision', 'post', id, `恢复到 v${rev.revision}`);
  return jsonOk(await getPostById(ctx.env, id, ctx.url.origin), 200, `已恢复到版本 v${rev.revision}`);
}

/** 预览：仅管理员可读草稿，且禁止索引 */
export async function handlePreview(ctx: Ctx): Promise<Response> {
  const user = requireUser(ctx);
  const slug = ctx.params.slug!;
  const post = await getPostBySlug(ctx.env, slug, ctx.url.origin, true);
  if (!post) throw new HttpError(404, '文章不存在');
  if (post.status === 'published' && post.authorId !== user.id && user.role !== 'admin') {
    throw new HttpError(403, '无权预览该文章');
  }
  const { html, toc } = renderMarkdown(post.content);
  return jsonOk({ ...post, html, toc }, 200, '预览内容');
}

/** 批量操作 */
export async function handleBatchPost(ctx: Ctx): Promise<Response> {
  const user = requireUser(ctx);
  const body = await readJson<{ ids: number[]; action: string; categoryIds?: number[] }>(ctx);
  if (!Array.isArray(body.ids) || !body.ids.length) {
    throw new HttpError(422, '请选择要操作的文章');
  }
  if (body.ids.length > 200) throw new HttpError(422, '单次最多操作 200 篇');

  const ids = body.ids.map((i) => intParam(String(i), 0, 1, 1e9)).filter(Boolean);
  if (!ids.length) throw new HttpError(422, '无效的文章 ID');

  const placeholders = ids.map(() => '?').join(',');
  let affected = 0;
  switch (body.action) {
    case 'publish':
      await ctx.env.DB.prepare(
        `UPDATE posts SET status='published', published_at=COALESCE(published_at, ?), deleted_at=NULL,
          updated_at=?, revision=revision+1
         WHERE id IN (${placeholders}) AND status IN ('draft','archived','scheduled') AND title != '' AND content != ''`
      )
        .bind(ctx.now, ctx.now, ...ids)
        .run();
      break;
    case 'archive':
      await ctx.env.DB.prepare(
        `UPDATE posts SET status='archived', updated_at=?, revision=revision+1
         WHERE id IN (${placeholders}) AND status IN ('published','draft')`
      )
        .bind(ctx.now, ...ids)
        .run();
      break;
    case 'trash':
      await ctx.env.DB.prepare(
        `UPDATE posts SET status='trashed', deleted_at=?, updated_at=?, revision=revision+1
         WHERE id IN (${placeholders}) AND status != 'trashed'`
      )
        .bind(ctx.now, ctx.now, ...ids)
        .run();
      break;
    case 'category':
      for (const id of ids) {
        await setPostCategories(ctx.env, id, body.categoryIds ?? []);
      }
      break;
    default:
      throw new HttpError(422, `不支持的批量操作：${body.action}`);
  }
  const countRow = await ctx.env.DB.prepare(
    `SELECT COUNT(*) AS n FROM posts WHERE id IN (${placeholders})`
  )
    .bind(...ids)
    .first<{ n: number }>();
  affected = countRow?.n ?? 0;
  await logOperation(ctx.env, user.id, user.username, `post.batch_${body.action}`, 'post', null, `${ids.length} 篇`);
  return jsonOk({ affected, action: body.action });
}

/** 文章上下篇（后台预览用） */
export async function handleAdjacent(ctx: Ctx): Promise<Response> {
  const id = intParam(ctx.params.id, 0, 1, 1e9);
  const post = await getPostById(ctx.env, id, ctx.url.origin);
  if (!post) throw new HttpError(404, '文章不存在');
  const [adj, rel] = await Promise.all([
    adjacentPosts(ctx.env, post.publishedAt ?? post.createdAt, id, ctx.url.origin),
    relatedPosts(ctx.env, post, 5, ctx.url.origin)
  ]);
  return jsonOk({ ...adj, related: rel });
}
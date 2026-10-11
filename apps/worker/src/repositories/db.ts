/**
 * 数据仓储层 —— 所有 SQL 集中在此，统一使用参数化查询（禁止字符串拼接）。
 * 业务逻辑与 SQL 解耦，便于审计与测试。
 */
import { mediaUrl } from '../lib/context';
import type { Env } from '../lib/env';
import type { DbLike } from '../lib/db-adapter';
import type {
  Category,
  Comment,
  LinkItem,
  MenuItem,
  Media,
  OperationLog,
  Paginated,
  Post,
  PostStatus,
  PostSummary,
  Redirect,
  Revision,
  Tag,
  TrendPoint
} from '@myblog/shared';

// ============ 行类型（数据库 snake_case → 领域 camelCase）============

interface PostRow {
  id: number;
  author_id: number;
  author_name: string | null;
  type: 'post' | 'page';
  title: string;
  slug: string;
  excerpt: string | null;
  content: string;
  content_format: string;
  cover_media_id: number | null;
  cover_url: string | null;
  cover_alt: string | null;
  status: PostStatus;
  is_featured: number;
  sort_order: number;
  word_count: number;
  reading_time: number;
  seo_title: string | null;
  seo_description: string | null;
  canonical_url: string | null;
  robots_index: number;
  revision: number;
  published_at: string | null;
  scheduled_at: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

interface CategoryRow {
  id: number;
  name: string;
  slug: string;
  description: string | null;
  parent_id: number | null;
  sort_order: number;
  seo_title: string | null;
  seo_description: string | null;
  created_at: string;
  updated_at: string;
  post_count?: number;
}

interface TagRow {
  id: number;
  name: string;
  slug: string;
  description: string | null;
  seo_title: string | null;
  seo_description: string | null;
  created_at: string;
  post_count?: number;
}

interface MediaRow {
  id: number;
  original_name: string;
  object_key: string;
  mime_type: string;
  file_size: number;
  width: number | null;
  height: number | null;
  alt_text: string | null;
  caption: string | null;
  file_hash: string | null;
  created_at: string;
}

export function mapCategory(r: CategoryRow): Category {
  return {
    id: r.id,
    name: r.name,
    slug: r.slug,
    description: r.description,
    parentId: r.parent_id,
    sortOrder: r.sort_order,
    seoTitle: r.seo_title,
    seoDescription: r.seo_description,
    postCount: r.post_count ?? 0,
    createdAt: r.created_at,
    updatedAt: r.updated_at
  };
}

export function mapTag(r: TagRow): Tag {
  return {
    id: r.id,
    name: r.name,
    slug: r.slug,
    description: r.description,
    seoTitle: r.seo_title,
    seoDescription: r.seo_description,
    postCount: r.post_count ?? 0,
    createdAt: r.created_at
  };
}

export function mapMedia(r: MediaRow, publicBase: string): Media {
  return {
    id: r.id,
    originalName: r.original_name,
    objectKey: r.object_key,
    mimeType: r.mime_type,
    fileSize: r.file_size,
    width: r.width,
    height: r.height,
    altText: r.alt_text,
    caption: r.caption,
    fileHash: r.file_hash,
    url: mediaUrl(r.object_key, publicBase),
    createdAt: r.created_at
  };
}

export function mapPost(r: PostRow, cats: Category[] = [], tags: Tag[] = []): Post {
  return {
    id: r.id,
    authorId: r.author_id,
    authorName: r.author_name ?? undefined,
    type: r.type,
    title: r.title,
    slug: r.slug,
    excerpt: r.excerpt,
    content: r.content,
    contentFormat: r.content_format,
    coverMediaId: r.cover_media_id,
    coverUrl: r.cover_url,
    coverAlt: r.cover_alt,
    status: r.status,
    isFeatured: Boolean(r.is_featured),
    sortOrder: r.sort_order,
    wordCount: r.word_count,
    readingTime: r.reading_time,
    seoTitle: r.seo_title,
    seoDescription: r.seo_description,
    canonicalUrl: r.canonical_url,
    robotsIndex: Boolean(r.robots_index),
    revision: r.revision,
    publishedAt: r.published_at,
    scheduledAt: r.scheduled_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    deletedAt: r.deleted_at,
    categories: cats,
    tags
  };
}

export function mapSummary(r: PostRow & { category_name?: string | null; category_slug?: string | null }): PostSummary {
  return {
    id: r.id,
    title: r.title,
    slug: r.slug,
    excerpt: r.excerpt,
    status: r.status,
    type: r.type,
    isFeatured: Boolean(r.is_featured),
    wordCount: r.word_count,
    readingTime: r.reading_time,
    publishedAt: r.published_at,
    updatedAt: r.updated_at,
    coverUrl: r.cover_url,
    coverAlt: r.cover_alt,
    authorName: r.author_name ?? undefined,
    categoryName: r.category_name ?? null,
    categorySlug: r.category_slug ?? null,
    tags: []
  };
}

// ============ 通用 ============

/**
 * 事务包装。
 *
 * 原实现依赖 D1 的 batch（原子批量执行），现由适配层以事务实现，
 * 因此这里只需把 db 句柄交给调用方。
 */
export async function withBatch<T>(env: Env, fn: (db: DbLike) => Promise<T>): Promise<T> {
  return fn(env.DB);
}

/** 分页计算 */
export function paging(page: number, pageSize: number): { offset: number; limit: number } {
  const p = Math.max(1, page);
  const s = Math.min(50, Math.max(1, pageSize));
  return { offset: (p - 1) * s, limit: s };
}

export function paginate<T>(items: T[], total: number, page: number, pageSize: number): Paginated<T> {
  return {
    items,
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize))
  };
}

// ============ 文章 ============

const POST_SELECT = `
  SELECT p.*, u.username AS author_name, m.object_key AS cover_key
    FROM posts p
    LEFT JOIN users u ON u.id = p.author_id
    LEFT JOIN media m ON m.id = p.cover_media_id`;

function attachCover(row: PostRow & { cover_key?: string | null }, publicBase: string): PostRow {
  return {
    ...row,
    cover_url: row.cover_key ? mediaUrl(row.cover_key, publicBase) : null
  };
}

export async function getPostById(env: Env, id: number, publicBase: string): Promise<Post | null> {
  const row = await env.DB.prepare(`${POST_SELECT} WHERE p.id = ?`)
    .bind(id)
    .first<Parameters<typeof attachCover>[0]>();
  if (!row) return null;
  const [cats, tags] = await Promise.all([getPostCategories(env, id), getPostTags(env, id)]);
  return mapPost(attachCover(row, publicBase), cats, tags);
}

export async function getPostBySlug(
  env: Env,
  slug: string,
  publicBase: string,
  includeUnpublished = false
): Promise<Post | null> {
  const conditions = includeUnpublished ? '' : "AND p.status = 'published' AND p.deleted_at IS NULL";
  const row = await env.DB.prepare(`${POST_SELECT} WHERE p.slug = ? ${conditions}`)
    .bind(slug)
    .first<Parameters<typeof attachCover>[0]>();
  if (!row) return null;
  const [cats, tags] = await Promise.all([getPostCategories(env, row.id), getPostTags(env, row.id)]);
  return mapPost(attachCover(row, publicBase), cats, tags);
}

export async function getPostCategories(env: Env, postId: number): Promise<Category[]> {
  const rows = await env.DB.prepare(
    `SELECT c.* FROM categories c
       JOIN post_categories pc ON pc.category_id = c.id
      WHERE pc.post_id = ? ORDER BY c.sort_order, c.id`
  )
    .bind(postId)
    .all<CategoryRow>();
  return rows.results.map(mapCategory);
}

export async function getPostTags(env: Env, postId: number): Promise<Tag[]> {
  const rows = await env.DB.prepare(
    `SELECT t.* FROM tags t
       JOIN post_tags pt ON pt.tag_id = t.id
      WHERE pt.post_id = ? ORDER BY t.name`
  )
    .bind(postId)
    .all<TagRow>();
  return rows.results.map(mapTag);
}

export interface PostListQuery {
  type?: 'post' | 'page';
  status?: PostStatus | 'any';
  categoryId?: number;
  tagId?: number;
  keyword?: string;
  featured?: boolean;
  page: number;
  pageSize: number;
}

export interface PostListResult {
  items: PostSummary[];
  total: number;
}

export async function listPosts(
  env: Env,
  q: PostListQuery,
  publicBase: string
): Promise<PostListResult> {
  const where: string[] = [];
  const binds: unknown[] = [];

  if (q.status === 'trashed') {
    where.push("p.status = 'trashed'");
  } else {
    where.push("p.deleted_at IS NULL");
    if (q.status && q.status !== 'any') {
      where.push('p.status = ?');
      binds.push(q.status);
    }
  }
  if (q.type) {
    where.push('p.type = ?');
    binds.push(q.type);
  }
  if (q.featured !== undefined) {
    where.push('p.is_featured = ?');
    binds.push(q.featured ? 1 : 0);
  }
  if (q.categoryId) {
    where.push('p.id IN (SELECT post_id FROM post_categories WHERE category_id = ?)');
    binds.push(q.categoryId);
  }
  if (q.tagId) {
    where.push('p.id IN (SELECT post_id FROM post_tags WHERE tag_id = ?)');
    binds.push(q.tagId);
  }
  if (q.keyword) {
    where.push('(p.title LIKE ? OR p.excerpt LIKE ?)');
    const like = `%${q.keyword}%`;
    binds.push(like, like);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const totalRow = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM posts p ${whereSql}`
  )
    .bind(...binds)
    .first<{ n: number }>();
  const total = totalRow?.n ?? 0;

  const { offset, limit } = paging(q.page, q.pageSize);
  const rows = await env.DB.prepare(
    `${POST_SELECT} ${whereSql}
      ORDER BY p.is_featured DESC,
               COALESCE(p.published_at, p.created_at) DESC,
               p.id DESC
      LIMIT ? OFFSET ?`
  )
    .bind(...binds, limit, offset)
    .all<Parameters<typeof attachCover>[0]>();

  const items: PostSummary[] = [];
  for (const row of rows.results) {
    const withCover = attachCover(row, publicBase);
    items.push(mapSummary(withCover));
    // 批量回填标签（避免 N+1）
    if (items.length) {
      const id = withCover.id;
      const tagRows = await env.DB.prepare(
        `SELECT t.id, t.name, t.slug FROM tags t
           JOIN post_tags pt ON pt.tag_id = t.id WHERE pt.post_id = ? ORDER BY t.name`
      )
        .bind(id)
        .all<{ id: number; name: string; slug: string }>();
      items[items.length - 1].tags = tagRows.results;
    }
  }
  return { items, total };
}

export async function countPostsByStatus(env: Env): Promise<Record<string, number>> {
  const rows = await env.DB.prepare(
    `SELECT status, COUNT(*) AS n FROM posts WHERE deleted_at IS NULL GROUP BY status`
  ).all<{ status: string; n: number }>();
  const out: Record<string, number> = {
    draft: 0,
    published: 0,
    scheduled: 0,
    archived: 0,
    trashed: 0
  };
  for (const r of rows.results) out[r.status] = r.n;
  return out;
}

export async function adjacentPosts(
  env: Env,
  publishedAt: string,
  postId: number,
  publicBase: string
): Promise<{ prev: PostSummary | null; next: PostSummary | null }> {
  const prevRow = await env.DB.prepare(
    `${POST_SELECT} WHERE p.type='post' AND p.status='published' AND p.published_at < ?
      ORDER BY p.published_at DESC LIMIT 1`
  )
    .bind(publishedAt)
    .first<Parameters<typeof attachCover>[0]>();
  const nextRow = await env.DB.prepare(
    `${POST_SELECT} WHERE p.type='post' AND p.status='published' AND p.published_at > ?
      ORDER BY p.published_at ASC LIMIT 1`
  )
    .bind(publishedAt)
    .first<Parameters<typeof attachCover>[0]>();
  return {
    prev: prevRow ? mapSummary(attachCover(prevRow, publicBase)) : null,
    next: nextRow ? mapSummary(attachCover(nextRow, publicBase)) : null
  };
}

export async function relatedPosts(
  env: Env,
  post: Post,
  limit: number,
  publicBase: string
): Promise<PostSummary[]> {
  const ids = [...post.categories.map((c) => c.id), ...post.tags.map((t) => t.id)];
  if (!ids.length) {
    const rows = await env.DB.prepare(
      `${POST_SELECT} WHERE p.type='post' AND p.status='published' AND p.id != ?
        ORDER BY p.published_at DESC LIMIT ?`
    )
      .bind(post.id, limit)
      .all<Parameters<typeof attachCover>[0]>();
    return rows.results.map((r) => mapSummary(attachCover(r, publicBase)));
  }
  const placeholders = ids.map(() => '?').join(',');
  const rows = await env.DB.prepare(
    `${POST_SELECT}
      WHERE p.type='post' AND p.status='published' AND p.id != ?
        AND (p.id IN (SELECT post_id FROM post_categories WHERE category_id IN (${placeholders}))
          OR p.id IN (SELECT post_id FROM post_tags WHERE tag_id IN (${placeholders})))
      GROUP BY p.id
      ORDER BY p.published_at DESC LIMIT ?`
  )
    .bind(post.id, ...ids, ...ids, limit)
    .all<Parameters<typeof attachCover>[0]>();
  return rows.results.map((r) => mapSummary(attachCover(r, publicBase)));
}

export async function archives(env: Env, publicBase: string) {
  const rows = await env.DB.prepare(
    `${POST_SELECT} WHERE p.type='post' AND p.status='published'
      ORDER BY p.published_at DESC`
  ).all<Parameters<typeof attachCover>[0]>();
  const items = rows.results.map((r) => mapSummary(attachCover(r, publicBase)));
  const groups: { year: number; month: number; count: number; posts: PostSummary[] }[] = [];
  for (const p of items) {
    if (!p.publishedAt) continue;
    const d = new Date(p.publishedAt.replace(' ', 'T') + 'Z');
    const year = d.getUTCFullYear();
    const month = d.getUTCMonth() + 1;
    let g = groups.find((x) => x.year === year && x.month === month);
    if (!g) {
      g = { year, month, count: 0, posts: [] };
      groups.push(g);
    }
    g.posts.push(p);
    g.count++;
  }
  return groups;
}

export async function searchPosts(
  env: Env,
  keyword: string,
  publicBase: string,
  limit: number
): Promise<{ items: PostSummary[]; total: number }> {
  const like = `%${keyword.toLowerCase()}%`;
  const rows = await env.DB.prepare(
    `${POST_SELECT}
      WHERE p.type='post' AND p.status='published' AND p.deleted_at IS NULL
        AND (LOWER(p.title) LIKE ? OR LOWER(IFNULL(p.excerpt,'')) LIKE ? OR LOWER(p.content) LIKE ?)
      ORDER BY p.published_at DESC LIMIT ?`
  )
    .bind(like, like, like, limit)
    .all<Parameters<typeof attachCover>[0]>();
  const total = rows.results.length;
  return { items: rows.results.map((r) => mapSummary(attachCover(r, publicBase))), total };
}

// ============ 分类 ============

export async function listCategories(
  env: Env,
  opts: { withCount?: boolean; onlyPublic?: boolean } = {}
): Promise<Category[]> {
  const countJoin = opts.withCount
    ? `LEFT JOIN post_categories pc ON pc.category_id = c.id
       LEFT JOIN posts p ON p.id = pc.post_id AND p.status='published' AND p.deleted_at IS NULL`
    : '';
  const countExpr = opts.withCount ? 'COUNT(DISTINCT p.id)' : '0';
  const having = opts.withCount ? 'GROUP BY c.id' : '';
  const rows = await env.DB.prepare(
    `SELECT c.*, ${countExpr} AS post_count FROM categories c ${countJoin} ${having}
      ORDER BY c.sort_order ASC, c.id ASC`
  ).all<CategoryRow>();
  return rows.results.map(mapCategory);
}

export async function getCategoryBySlug(env: Env, slug: string): Promise<Category | null> {
  const row = await env.DB.prepare('SELECT * FROM categories WHERE slug = ?')
    .bind(slug)
    .first<CategoryRow>();
  return row ? mapCategory(row) : null;
}

export async function getCategoryById(env: Env, id: number): Promise<Category | null> {
  const row = await env.DB.prepare('SELECT * FROM categories WHERE id = ?')
    .bind(id)
    .first<CategoryRow>();
  return row ? mapCategory(row) : null;
}

export async function slugExists(
  env: Env,
  table: 'posts' | 'categories' | 'tags',
  slug: string,
  excludeId?: number
): Promise<boolean> {
  const row = await env.DB.prepare(
    `SELECT id FROM ${table} WHERE slug = ?${excludeId ? ' AND id != ?' : ''}`
  )
    .bind(...(excludeId ? [slug, excludeId] : [slug]))
    .first<{ id: number }>();
  return Boolean(row);
}

/** 生成不冲突的 slug：冲突时追加 -2、-3… */
export async function uniqueSlug(
  env: Env,
  table: 'posts' | 'categories' | 'tags',
  base: string,
  excludeId?: number
): Promise<string> {
  const root = base || 'untitled';
  let candidate = root;
  let i = 2;
  while (await slugExists(env, table, candidate, excludeId)) {
    candidate = `${root}-${i++}`;
    if (i > 500) {
      candidate = `${root}-${Date.now().toString(36)}`;
      break;
    }
  }
  return candidate;
}

// ============ 标签 ============

export async function listTags(env: Env, withCount = true): Promise<Tag[]> {
  const join = withCount
    ? `LEFT JOIN post_tags pt ON pt.tag_id = t.id
       LEFT JOIN posts p ON p.id = pt.post_id AND p.status='published' AND p.deleted_at IS NULL`
    : '';
  const expr = withCount ? 'COUNT(DISTINCT p.id)' : '0';
  const group = withCount ? 'GROUP BY t.id' : '';
  const rows = await env.DB.prepare(
    `SELECT t.*, ${expr} AS post_count FROM tags t ${join} ${group} ORDER BY post_count DESC, t.name`
  ).all<TagRow>();
  return rows.results.map(mapTag);
}

export async function getTagBySlug(env: Env, slug: string): Promise<Tag | null> {
  const row = await env.DB.prepare('SELECT * FROM tags WHERE slug = ?').bind(slug).first<TagRow>();
  return row ? mapTag(row) : null;
}

/** 按名称查找或创建标签，写文章时自动补齐 */
export async function findOrCreateTag(env: Env, name: string, slug: string): Promise<number> {
  const existing = await env.DB.prepare('SELECT id FROM tags WHERE slug = ? OR name = ?')
    .bind(slug, name)
    .first<{ id: number }>();
  if (existing) return existing.id;
  const created = await env.DB.prepare('INSERT INTO tags (name, slug) VALUES (?, ?)')
    .bind(name, slug)
    .run();
  return Number(created.meta.last_row_id);
}

// ============ 关联写入 ============

export async function setPostCategories(env: Env, postId: number, ids: number[]): Promise<void> {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM post_categories WHERE post_id = ?').bind(postId),
    ...ids.map((cid) =>
      env.DB.prepare('INSERT OR IGNORE INTO post_categories (post_id, category_id) VALUES (?, ?)').bind(
        postId,
        cid
      )
    )
  ]);
}

export async function setPostTags(env: Env, postId: number, ids: number[]): Promise<void> {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM post_tags WHERE post_id = ?').bind(postId),
    ...ids.map((tid) =>
      env.DB.prepare('INSERT OR IGNORE INTO post_tags (post_id, tag_id) VALUES (?, ?)').bind(postId, tid)
    )
  ]);
}

// ============ 版本历史 ============

export async function listRevisions(env: Env, postId: number): Promise<Revision[]> {
  const rows = await env.DB.prepare(
    `SELECT r.id, r.post_id, r.title, r.excerpt, r.revision, r.created_at, u.username AS created_by
       FROM post_revisions r LEFT JOIN users u ON u.id = r.created_by
      WHERE r.post_id = ? ORDER BY r.revision DESC`
  )
    .bind(postId)
    .all<{
      id: number;
      post_id: number;
      title: string;
      excerpt: string | null;
      revision: number;
      created_at: string;
      created_by: string | null;
    }>();
  return rows.results.map((r) => ({
    id: r.id,
    postId: r.post_id,
    title: r.title,
    excerpt: r.excerpt,
    content: '',
    revision: r.revision,
    createdAt: r.created_at,
    createdBy: r.created_by
  }));
}

export async function getRevision(env: Env, postId: number, revisionId: number): Promise<Revision | null> {
  const row = await env.DB.prepare(
    `SELECT r.*, u.username AS created_by FROM post_revisions r
       LEFT JOIN users u ON u.id = r.created_by
      WHERE r.post_id = ? AND r.id = ?`
  )
    .bind(postId, revisionId)
    .first<{
      id: number;
      post_id: number;
      title: string;
      excerpt: string | null;
      content: string;
      revision: number;
      created_at: string;
      created_by: string | null;
    }>();
  if (!row) return null;
  return {
    id: row.id,
    postId: row.post_id,
    title: row.title,
    excerpt: row.excerpt,
    content: row.content,
    revision: row.revision,
    createdAt: row.created_at,
    createdBy: row.created_by
  };
}

export async function saveRevision(
  env: Env,
  postId: number,
  data: { title: string; excerpt: string | null; content: string; revision: number; userId: number },
  maxKeep = 30
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO post_revisions (post_id, title, excerpt, content, revision, created_at, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(post_id, revision) DO UPDATE SET
       title=excluded.title, excerpt=excluded.excerpt, content=excluded.content, created_at=excluded.created_at`
  )
    .bind(postId, data.title, data.excerpt, data.content, data.revision, new Date().toISOString().replace('T', ' ').slice(0, 19), data.userId)
    .run();

  // 限量保留，防止自动保存产生大量重复版本
  await env.DB.prepare(
    `DELETE FROM post_revisions WHERE post_id = ? AND id NOT IN (
       SELECT id FROM post_revisions WHERE post_id = ? ORDER BY revision DESC LIMIT ?
     )`
  )
    .bind(postId, postId, maxKeep)
    .run();
}

// ============ 菜单 / 友链 / 重定向 ============

interface MenuRow {
  id: number;
  label: string;
  href: string;
  location: MenuItem['location'];
  sort_order: number;
  is_visible: number;
  is_external: number;
  open_in_new: number;
}

export async function listMenus(env: Env, location?: MenuItem['location']): Promise<MenuItem[]> {
  const sql = location
    ? 'SELECT * FROM menus WHERE location = ? AND is_visible = 1 ORDER BY sort_order, id'
    : 'SELECT * FROM menus WHERE is_visible = 1 ORDER BY location, sort_order, id';
  const stmt = location ? env.DB.prepare(sql).bind(location) : env.DB.prepare(sql);
  const rows = await stmt.all<MenuRow>();
  return rows.results.map((r) => ({
    id: r.id,
    label: r.label,
    href: r.href,
    location: r.location,
    sortOrder: r.sort_order,
    isVisible: Boolean(r.is_visible),
    isExternal: Boolean(r.is_external),
    openInNew: Boolean(r.open_in_new)
  }));
}

export async function listLinks(env: Env): Promise<LinkItem[]> {
  const rows = await env.DB.prepare(
    'SELECT * FROM links WHERE is_visible = 1 ORDER BY sort_order, id'
  ).all<{
    id: number;
    name: string;
    url: string;
    avatar_url: string | null;
    description: string | null;
    sort_order: number;
    is_visible: number;
  }>();
  return rows.results.map((r) => ({
    id: r.id,
    name: r.name,
    url: r.url,
    avatarUrl: r.avatar_url,
    description: r.description,
    sortOrder: r.sort_order,
    isVisible: Boolean(r.is_visible)
  }));
}

export async function findRedirect(env: Env, fromPath: string): Promise<Redirect | null> {
  const row = await env.DB.prepare(
    'SELECT * FROM redirects WHERE from_path = ? AND is_active = 1'
  )
    .bind(fromPath)
    .first<{
      id: number;
      from_path: string;
      to_path: string;
      status_code: number;
      is_active: number;
      hit_count: number;
      created_at: string;
    }>();
  if (!row) return null;
  return {
    id: row.id,
    fromPath: row.from_path,
    toPath: row.to_path,
    statusCode: row.status_code,
    isActive: Boolean(row.is_active),
    hitCount: row.hit_count,
    createdAt: row.created_at
  };
}

// ============ 评论 ============

interface CommentRow {
  id: number;
  post_id: number;
  parent_id: number | null;
  author_name: string;
  author_email: string | null;
  author_website: string | null;
  content: string;
  status: Comment['status'];
  ip_hash: string | null;
  user_agent: string | null;
  created_at: string;
}

export function mapComment(r: CommentRow): Comment {
  return {
    id: r.id,
    postId: r.post_id,
    parentId: r.parent_id,
    authorName: r.author_name,
    authorEmail: r.author_email,
    authorWebsite: r.author_website,
    content: r.content,
    status: r.status,
    ipHash: r.ip_hash,
    userAgent: r.user_agent,
    createdAt: r.created_at
  };
}

export async function listComments(
  env: Env,
  opts: { postId?: number; status?: Comment['status']; page?: number; pageSize?: number } = {}
): Promise<Paginated<Comment>> {
  const where: string[] = [];
  const binds: unknown[] = [];
  if (opts.postId) {
    where.push('post_id = ?');
    binds.push(opts.postId);
  }
  if (opts.status) {
    where.push('status = ?');
    binds.push(opts.status);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const totalRow = await env.DB.prepare(`SELECT COUNT(*) AS n FROM comments ${whereSql}`)
    .bind(...binds)
    .first<{ n: number }>();
  const { offset, limit } = paging(opts.page ?? 1, opts.pageSize ?? 20);
  const rows = await env.DB.prepare(
    `SELECT * FROM comments ${whereSql} ORDER BY created_at DESC LIMIT ? OFFSET ?`
  )
    .bind(...binds, limit, offset)
    .all<CommentRow>();
  return paginate(rows.results.map(mapComment), totalRow?.n ?? 0, opts.page ?? 1, opts.pageSize ?? 20);
}

export async function countCommentsByStatus(env: Env): Promise<Record<string, number>> {
  const rows = await env.DB.prepare('SELECT status, COUNT(*) AS n FROM comments GROUP BY status')
    .all<{ status: string; n: number }>();
  const out = { pending: 0, approved: 0, spam: 0, deleted: 0 };
  for (const r of rows.results) out[r.status as keyof typeof out] = r.n;
  return out;
}

// ============ 统计 ============

export async function viewStats(env: Env) {
  const totals = await env.DB.prepare(
    `SELECT
       COUNT(*) AS total_views,
       COUNT(DISTINCT visitor_hash) AS total_visitors,
       COUNT(DISTINCT ip_hash) AS total_ips
     FROM page_views WHERE is_bot = 0`
  ).first<{ total_views: number; total_visitors: number; total_ips: number }>();

  const today = await env.DB.prepare(
    `SELECT COUNT(*) AS views, COUNT(DISTINCT visitor_hash) AS visitors
       FROM page_views WHERE is_bot = 0 AND date(created_at) = date('now')`
  ).first<{ views: number; visitors: number }>();

  return {
    totalViews: totals?.total_views ?? 0,
    totalVisitors: totals?.total_visitors ?? 0,
    totalIps: totals?.total_ips ?? 0,
    todayViews: today?.views ?? 0,
    todayVisitors: today?.visitors ?? 0
  };
}

export async function viewTrend(env: Env, days: number): Promise<TrendPoint[]> {
  const rows = await env.DB.prepare(
    `SELECT date(created_at) AS date, COUNT(*) AS views, COUNT(DISTINCT visitor_hash) AS visitors
       FROM page_views WHERE is_bot = 0 AND created_at >= date('now', ?)
      GROUP BY date(created_at) ORDER BY date ASC`
  )
    .bind(`-${Math.min(90, Math.max(7, days))} days`)
    .all<{ date: string; views: number; visitors: number }>();
  const map = new Map(rows.results.map((r) => [r.date, r]));
  const out: TrendPoint[] = [];
  const today = new Date();
  for (let i = Math.min(90, Math.max(7, days)) - 1; i >= 0; i--) {
    const d = new Date(today.getTime() - i * 86400000).toISOString().slice(0, 10);
    const hit = map.get(d);
    out.push({ date: d, views: hit?.views ?? 0, visitors: hit?.visitors ?? 0 });
  }
  return out;
}

export async function topPosts(env: Env, limit = 10) {
  const rows = await env.DB.prepare(
    `SELECT p.slug, p.title, COUNT(v.id) AS views
       FROM page_views v JOIN posts p ON p.id = v.post_id
      WHERE v.is_bot = 0
      GROUP BY p.id ORDER BY views DESC LIMIT ?`
  )
    .bind(limit)
    .all<{ slug: string; title: string; views: number }>();
  return rows.results;
}

export async function recordView(
  env: Env,
  data: { path: string; postId: number | null; referrer: string | null; visitorHash: string; userAgent: string | null; isBot: boolean }
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO page_views (path, post_id, referrer, ip_hash, visitor_hash, user_agent, is_bot)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      data.path.slice(0, 300),
      data.postId,
      data.referrer?.slice(0, 300) ?? null,
      data.visitorHash.slice(0, 32),
      data.visitorHash,
      data.userAgent?.slice(0, 300) ?? null,
      data.isBot ? 1 : 0
    )
    .run();
}

export async function topPaths(env: Env, limit = 10) {
  const rows = await env.DB.prepare(
    `SELECT path, COUNT(*) AS views FROM page_views WHERE is_bot = 0
      GROUP BY path ORDER BY views DESC LIMIT ?`
  )
    .bind(limit)
    .all<{ path: string; views: number }>();
  return rows.results;
}

// ============ 操作日志 ============

export async function logOperation(
  env: Env,
  userId: number | null,
  username: string | null,
  action: string,
  targetType?: string | null,
  targetId?: number | null,
  detail?: string
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO operation_logs (user_id, username, action, target_type, target_id, detail)
     VALUES (?, ?, ?, ?, ?, ?)`
  )
    .bind(userId, username, action, targetType ?? null, targetId ?? null, detail?.slice(0, 500) ?? null)
    .run();
}

export async function listLogs(env: Env, limit = 30): Promise<OperationLog[]> {
  const rows = await env.DB.prepare(
    'SELECT * FROM operation_logs ORDER BY created_at DESC, id DESC LIMIT ?'
  )
    .bind(limit)
    .all<{
      id: number;
      user_id: number | null;
      username: string | null;
      action: string;
      target_type: string | null;
      target_id: number | null;
      detail: string | null;
      ip: string | null;
      created_at: string;
    }>();
  return rows.results.map((r) => ({
    id: r.id,
    userId: r.user_id,
    username: r.username,
    action: r.action,
    targetType: r.target_type,
    targetId: r.target_id,
    detail: r.detail,
    ip: r.ip,
    createdAt: r.created_at
  }));
}
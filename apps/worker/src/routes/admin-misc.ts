/** 分类、标签、菜单、友链、重定向、设置、工作台、日志 —— 管理 API */
import type { Ctx } from '../lib/context';
import { readJson, requireUser, intParam } from '../lib/context';
import { HttpError, jsonOk } from '../lib/http';
import {
  getCategoryById,
  getCategoryBySlug,
  getTagBySlug,
  listCategories,
  listLinks,
  listLogs,
  listMenus,
  listTags,
  logOperation,
  uniqueSlug,
  countPostsByStatus,
  countCommentsByStatus,
  viewStats,
  viewTrend,
  topPosts,
  topPaths,
  listComments,
  listPosts
} from '../repositories/db';
import { getSettings, saveSettings } from '../services/settings';
import { slugify, slugOrFallback } from '@myblog/shared';
import type { LinkItem, Redirect } from '@myblog/shared';

// ============ 分类 ============

export async function handleCategoryList(ctx: Ctx): Promise<Response> {
  requireUser(ctx);
  return jsonOk(await listCategories(ctx.env, { withCount: true }));
}

export async function handleCategoryCreate(ctx: Ctx): Promise<Response> {
  const user = requireUser(ctx);
  const body = await readJson<Partial<{
    name: string;
    slug: string;
    description: string;
    parentId: number | null;
    sortOrder: number;
    seoTitle: string;
    seoDescription: string;
  }>>(ctx);
  const name = (body.name ?? '').trim();
  if (!name) throw new HttpError(422, '请填写分类名称', { field: 'name' });
  if (name.length > 60) throw new HttpError(422, '分类名称过长', { field: 'name' });

  // 父分类必须真实存在，否则会触发外键约束报 500
  if (body.parentId !== undefined && body.parentId !== null) {
    const parent = await getCategoryById(ctx.env, body.parentId);
    if (!parent) throw new HttpError(422, '父级分类不存在', { field: 'parentId' });
  }

  const slug = await uniqueSlug(ctx.env, 'categories', slugOrFallback(body.slug?.trim() || name, 'cat'));
  const now = ctx.now;
  const result = await ctx.env.DB.prepare(
    `INSERT INTO categories (name, slug, description, parent_id, sort_order, seo_title, seo_description, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      name,
      slug,
      body.description?.trim() || null,
      body.parentId ?? null,
      body.sortOrder ?? 0,
      body.seoTitle?.trim() || null,
      body.seoDescription?.trim() || null,
      now,
      now
    )
    .run();
  const id = Number(result.meta.last_row_id);
  await logOperation(ctx.env, user.id, user.username, 'category.create', 'category', id, name);
  return jsonOk(await getCategoryById(ctx.env, id), 201, '分类已创建');
}

export async function handleCategoryUpdate(ctx: Ctx): Promise<Response> {
  const user = requireUser(ctx);
  const id = intParam(ctx.params.id, 0, 1, 1e9);
  const existing = await getCategoryById(ctx.env, id);
  if (!existing) throw new HttpError(404, '分类不存在');

  const body = await readJson<Partial<{
    name: string;
    slug: string;
    description: string;
    parentId: number | null;
    sortOrder: number;
    seoTitle: string;
    seoDescription: string;
  }>>(ctx);

  let slug = existing.slug;
  if (body.slug !== undefined && body.slug.trim()) {
    const desired = slugify(body.slug);
    if (desired && desired !== existing.slug) {
      slug = await uniqueSlug(ctx.env, 'categories', desired, id);
    }
  }
  if (body.parentId === existing.id) {
    throw new HttpError(422, '分类不能作为自己的父级', { field: 'parentId' });
  }
  if (body.parentId) {
    const parent = await getCategoryById(ctx.env, body.parentId);
    if (!parent) throw new HttpError(422, '父级分类不存在', { field: 'parentId' });
    // 防止形成环
    let cursor = parent.parentId;
    let guard = 0;
    while (cursor && guard++ < 20) {
      if (cursor === id) throw new HttpError(422, '不能将子分类设为父级（会形成循环）', { field: 'parentId' });
      const p = await getCategoryById(ctx.env, cursor);
      cursor = p?.parentId ?? null;
    }
  }

  await ctx.env.DB.prepare(
    `UPDATE categories SET name=?, slug=?, description=?, parent_id=?, sort_order=?,
      seo_title=?, seo_description=?, updated_at=? WHERE id=?`
  )
    .bind(
      body.name?.trim() ?? existing.name,
      slug,
      body.description !== undefined ? body.description.trim() || null : existing.description,
      body.parentId !== undefined ? body.parentId : existing.parentId,
      body.sortOrder ?? existing.sortOrder,
      body.seoTitle !== undefined ? body.seoTitle.trim() || null : existing.seoTitle,
      body.seoDescription !== undefined ? body.seoDescription.trim() || null : existing.seoDescription,
      ctx.now,
      id
    )
    .run();
  await logOperation(ctx.env, user.id, user.username, 'category.update', 'category', id);
  return jsonOk(await getCategoryById(ctx.env, id), 200, '分类已更新');
}

export async function handleCategoryDelete(ctx: Ctx): Promise<Response> {
  const user = requireUser(ctx);
  const id = intParam(ctx.params.id, 0, 1, 1e9);
  const existing = await getCategoryById(ctx.env, id);
  if (!existing) throw new HttpError(404, '分类不存在');

  const used = await ctx.env.DB.prepare('SELECT COUNT(*) AS n FROM post_categories WHERE category_id = ?')
    .bind(id)
    .first<{ n: number }>();
  const children = await ctx.env.DB.prepare('SELECT COUNT(*) AS n FROM categories WHERE parent_id = ?')
    .bind(id)
    .first<{ n: number }>();

  const mode = ctx.url.searchParams.get('mode') ?? 'detach';
  if ((used?.n ?? 0) > 0 && mode === 'restrict') {
    throw new HttpError(409, `该分类下仍有 ${used!.n} 篇文章，请先移动或删除这些文章`, { count: used!.n });
  }
  if ((children?.n ?? 0) > 0 && mode !== 'cascade') {
    throw new HttpError(409, `该分类下仍有 ${children!.n} 个子分类，请先处理子分类`, { count: children!.n });
  }

  // detach：保留文章，仅解除关联
  await ctx.env.DB.prepare('DELETE FROM post_categories WHERE category_id = ?').bind(id).run();
  await ctx.env.DB.prepare('DELETE FROM categories WHERE id = ?').bind(id).run();
  await logOperation(
    ctx.env,
    user.id,
    user.username,
    'category.delete',
    'category',
    id,
    `${existing.name}（关联文章 ${used?.n ?? 0} 篇已解除）`
  );
  return jsonOk({ id, detachedPosts: used?.n ?? 0 }, 200, '分类已删除');
}

// ============ 标签 ============

export async function handleTagList(ctx: Ctx): Promise<Response> {
  requireUser(ctx);
  return jsonOk(await listTags(ctx.env, true));
}

export async function handleTagCreate(ctx: Ctx): Promise<Response> {
  const user = requireUser(ctx);
  const body = await readJson<Partial<{
    name: string;
    slug: string;
    description: string;
    seoTitle: string;
    seoDescription: string;
  }>>(ctx);
  const name = (body.name ?? '').trim();
  if (!name) throw new HttpError(422, '请填写标签名称', { field: 'name' });

  const slug = await uniqueSlug(ctx.env, 'tags', slugOrFallback(body.slug?.trim() || name, 'tag'));
  const result = await ctx.env.DB.prepare(
    `INSERT INTO tags (name, slug, description, seo_title, seo_description, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  )
    .bind(
      name,
      slug,
      body.description?.trim() || null,
      body.seoTitle?.trim() || null,
      body.seoDescription?.trim() || null,
      ctx.now
    )
    .run();
  const id = Number(result.meta.last_row_id);
  await logOperation(ctx.env, user.id, user.username, 'tag.create', 'tag', id, name);
  return jsonOk(await getTagBySlug(ctx.env, slug), 201, '标签已创建');
}

export async function handleTagUpdate(ctx: Ctx): Promise<Response> {
  const user = requireUser(ctx);
  const id = intParam(ctx.params.id, 0, 1, 1e9);
  const body = await readJson<Partial<{ name: string; slug: string; description: string; seoTitle: string; seoDescription: string }>>(ctx);
  const existing = await ctx.env.DB.prepare('SELECT * FROM tags WHERE id = ?')
    .bind(id)
    .first<Record<string, unknown>>();
  if (!existing) throw new HttpError(404, '标签不存在');

  let slug = String(existing.slug);
  if (body.slug !== undefined && body.slug.trim()) {
    const desired = slugify(body.slug);
    if (desired && desired !== existing.slug) slug = await uniqueSlug(ctx.env, 'tags', desired, id);
  }
  await ctx.env.DB.prepare(
    'UPDATE tags SET name=?, slug=?, description=?, seo_title=?, seo_description=? WHERE id=?'
  )
    .bind(
      body.name?.trim() ?? existing.name,
      slug,
      body.description !== undefined ? body.description.trim() || null : existing.description,
      body.seoTitle !== undefined ? body.seoTitle.trim() || null : existing.seo_title,
      body.seoDescription !== undefined ? body.seoDescription.trim() || null : existing.seo_description,
      id
    )
    .run();
  await logOperation(ctx.env, user.id, user.username, 'tag.update', 'tag', id);
  return jsonOk(await getTagBySlug(ctx.env, slug), 200, '标签已更新');
}

export async function handleTagDelete(ctx: Ctx): Promise<Response> {
  const user = requireUser(ctx);
  const id = intParam(ctx.params.id, 0, 1, 1e9);
  const used = await ctx.env.DB.prepare('SELECT COUNT(*) AS n FROM post_tags WHERE tag_id = ?')
    .bind(id)
    .first<{ n: number }>();
  const mode = ctx.url.searchParams.get('mode') ?? 'detach';
  if ((used?.n ?? 0) > 0 && mode === 'restrict') {
    throw new HttpError(409, `该标签仍被 ${used!.n} 篇文章使用`, { count: used!.n });
  }
  await ctx.env.DB.prepare('DELETE FROM tags WHERE id = ?').bind(id).run();
  await logOperation(ctx.env, user.id, user.username, 'tag.delete', 'tag', id, `关联 ${used?.n ?? 0} 篇`);
  return jsonOk({ id }, 200, '标签已删除');
}

/** 标签合并：把 sourceId 合并进 targetId */
export async function handleTagMerge(ctx: Ctx): Promise<Response> {
  const user = requireUser(ctx);
  const body = await readJson<{ sourceId: number; targetId: number }>(ctx);
  if (!body.sourceId || !body.targetId) throw new HttpError(422, '请提供源标签与目标标签');
  if (body.sourceId === body.targetId) throw new HttpError(422, '源标签与目标标签不能相同');

  const source = await ctx.env.DB.prepare('SELECT * FROM tags WHERE id = ?').bind(body.sourceId).first<{ id: number; name: string }>();
  const target = await ctx.env.DB.prepare('SELECT * FROM tags WHERE id = ?').bind(body.targetId).first<{ id: number; name: string }>();
  if (!source || !target) throw new HttpError(404, '标签不存在');

  // 先取出源标签的所有文章，重新绑定到目标标签（去重），再删源标签
  const posts = await ctx.env.DB.prepare('SELECT post_id FROM post_tags WHERE tag_id = ?')
    .bind(body.sourceId)
    .all<{ post_id: number }>();
  const statements = posts.results.map((p) =>
    ctx.env.DB.prepare('INSERT OR IGNORE INTO post_tags (post_id, tag_id) VALUES (?, ?)').bind(
      p.post_id,
      body.targetId
    )
  );
  statements.push(ctx.env.DB.prepare('DELETE FROM tags WHERE id = ?').bind(body.sourceId));
  await ctx.env.DB.batch(statements);

  await logOperation(ctx.env, user.id, user.username, 'tag.merge', 'tag', body.targetId, `${source.name} → ${target.name}`);
  return jsonOk({ merged: posts.results.length }, 200, `已合并 ${posts.results.length} 篇关联文章`);
}

// ============ 菜单 ============

export async function handleMenuList(ctx: Ctx): Promise<Response> {
  requireUser(ctx);
  return jsonOk(await listMenus(ctx.env));
}

export async function handleMenuCreate(ctx: Ctx): Promise<Response> {
  const user = requireUser(ctx);
  const body = await readJson<Partial<{
    label: string;
    href: string;
    location: 'header' | 'footer' | 'social';
    sortOrder: number;
    isVisible: boolean;
    isExternal: boolean;
    openInNew: boolean;
  }>>(ctx);
  const label = (body.label ?? '').trim();
  const href = (body.href ?? '').trim();
  if (!label) throw new HttpError(422, '请填写菜单名称', { field: 'label' });
  if (!href) throw new HttpError(422, '请填写链接地址', { field: 'href' });
const isExternal = /^https?:\/\//i.test(href);
if (body.isExternal !== undefined && body.isExternal !== isExternal) {
    throw new HttpError(422, '外部链接标记与链接地址不一致', { field: 'isExternal' });
  }
  if (isExternal) {
    if (!/^https?:\/\/[\w.-]+\.[a-z]{2,}/i.test(href)) {
      throw new HttpError(422, '外部链接必须以 http(s):// 开头且域名合法', { field: 'href' });
    }
  } else if (!href.startsWith('/')) {
    // 站内链接必须以 / 开头，否则 notaurl、javascript:alert(1) 这类会被当作相对路径入库，
    // 前端渲染成 href 后即成为 XSS 载体。
    throw new HttpError(422, '站内链接必须以 / 开头', { field: 'href' });
  }

  const result = await ctx.env.DB.prepare(
    `INSERT INTO menus (label, href, location, sort_order, is_visible, is_external, open_in_new, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      label,
      href,
      body.location ?? 'header',
      body.sortOrder ?? 0,
      body.isVisible === false ? 0 : 1,
      isExternal ? 1 : 0,
      body.openInNew === false ? 0 : 1,
      ctx.now,
      ctx.now
    )
    .run();
  await logOperation(ctx.env, user.id, user.username, 'menu.create', 'menu', Number(result.meta.last_row_id), label);
  return jsonOk(await listMenus(ctx.env), 201, '菜单已添加');
}

export async function handleMenuUpdate(ctx: Ctx): Promise<Response> {
  const user = requireUser(ctx);
  const id = intParam(ctx.params.id, 0, 1, 1e9);
  const existing = await ctx.env.DB.prepare('SELECT * FROM menus WHERE id = ?').bind(id).first<Record<string, unknown>>();
  if (!existing) throw new HttpError(404, '菜单项不存在');
  const body = await readJson<Partial<{
    label: string;
    href: string;
    location: 'header' | 'footer' | 'social';
    sortOrder: number;
    isVisible: boolean;
    openInNew: boolean;
  }>>(ctx);

  const href = body.href?.trim() ?? String(existing.href);
  if (!href) throw new HttpError(422, '请填写链接地址', { field: 'href' });
  const isExternal = /^https?:\/\//i.test(href);
  // 与新建保持同一套校验规则，避免绕过创建接口直接 PUT 写入非法地址
  if (isExternal) {
    if (!/^https?:\/\/[\w.-]+\.[a-z]{2,}/i.test(href)) {
      throw new HttpError(422, '外部链接必须以 http(s):// 开头且域名合法', { field: 'href' });
    }
  } else if (!href.startsWith('/')) {
    throw new HttpError(422, '站内链接必须以 / 开头', { field: 'href' });
  }
  await ctx.env.DB.prepare(
    `UPDATE menus SET label=?, href=?, location=?, sort_order=?, is_visible=?, is_external=?, open_in_new=?, updated_at=? WHERE id=?`
  )
    .bind(
      body.label?.trim() ?? existing.label,
      href,
      body.location ?? existing.location,
      body.sortOrder ?? existing.sort_order,
      body.isVisible !== undefined ? (body.isVisible ? 1 : 0) : existing.is_visible,
      isExternal ? 1 : 0,
      body.openInNew !== undefined ? (body.openInNew ? 1 : 0) : existing.open_in_new,
      ctx.now,
      id
    )
    .run();
  await logOperation(ctx.env, user.id, user.username, 'menu.update', 'menu', id);
  return jsonOk(await listMenus(ctx.env), 200, '菜单已更新');
}

export async function handleMenuDelete(ctx: Ctx): Promise<Response> {
  const user = requireUser(ctx);
  const id = intParam(ctx.params.id, 0, 1, 1e9);
  await ctx.env.DB.prepare('DELETE FROM menus WHERE id = ?').bind(id).run();
  await logOperation(ctx.env, user.id, user.username, 'menu.delete', 'menu', id);
  return jsonOk(await listMenus(ctx.env), 200, '菜单已删除');
}

/** 菜单排序 */
export async function handleMenuReorder(ctx: Ctx): Promise<Response> {
  const user = requireUser(ctx);
  const body = await readJson<{ ids: number[] }>(ctx);
  if (!Array.isArray(body.ids) || !body.ids.length) throw new HttpError(422, '请提供排序后的菜单 ID 列表');
  await ctx.env.DB.batch(
    body.ids.map((id, index) =>
      ctx.env.DB.prepare('UPDATE menus SET sort_order = ?, updated_at = ? WHERE id = ?')
        .bind(index, ctx.now, id)
    )
  );
  await logOperation(ctx.env, user.id, user.username, 'menu.reorder', 'menu');
  return jsonOk(await listMenus(ctx.env), 200, '排序已保存');
}

// ============ 友情链接 ============

async function listLinkData(ctx: Ctx): Promise<LinkItem[]> {
  const rows = await ctx.env.DB.prepare('SELECT * FROM links ORDER BY sort_order, id').all<Record<string, unknown>>();
  return rows.results.map((r) => ({
    id: Number(r.id),
    name: String(r.name),
    url: String(r.url),
    avatarUrl: (r.avatar_url as string) ?? null,
    description: (r.description as string) ?? null,
    sortOrder: Number(r.sort_order ?? 0),
    isVisible: Boolean(r.is_visible)
  }));
}

export async function handleLinkList(ctx: Ctx): Promise<Response> {
  requireUser(ctx);
  return jsonOk(await listLinkData(ctx));
}

export async function handleLinkCreate(ctx: Ctx): Promise<Response> {
  const user = requireUser(ctx);
  const body = await readJson<Partial<{ name: string; url: string; avatarUrl: string; description: string; sortOrder: number; isVisible: boolean }>>(ctx);
  if (!body.name?.trim()) throw new HttpError(422, '请填写友链名称', { field: 'name' });
  if (!/^https?:\/\/[\w.-]+\.[a-z]{2,}/i.test(body.url ?? '')) {
    throw new HttpError(422, '友链地址必须为合法的 http(s) 链接', { field: 'url' });
  }
  const result = await ctx.env.DB.prepare(
    `INSERT INTO links (name, url, avatar_url, description, sort_order, is_visible, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      body.name.trim(),
      body.url!.trim(),
      body.avatarUrl || null,
      body.description?.trim() || null,
      body.sortOrder ?? 0,
      body.isVisible === false ? 0 : 1,
      ctx.now
    )
    .run();
  await logOperation(ctx.env, user.id, user.username, 'link.create', 'link', Number(result.meta.last_row_id), body.name);
  return jsonOk(await listLinkData(ctx), 201, '友链已添加');
}

export async function handleLinkUpdate(ctx: Ctx): Promise<Response> {
  const user = requireUser(ctx);
  const id = intParam(ctx.params.id, 0, 1, 1e9);
  const existing = await ctx.env.DB.prepare('SELECT * FROM links WHERE id = ?').bind(id).first<Record<string, unknown>>();
  if (!existing) throw new HttpError(404, '友链不存在');
  const body = await readJson<Partial<{ name: string; url: string; avatarUrl: string; description: string; sortOrder: number; isVisible: boolean }>>(ctx);
  const url = body.url?.trim() ?? String(existing.url);
  if (!/^https?:\/\/[\w.-]+\.[a-z]{2,}/i.test(url)) {
    throw new HttpError(422, '友链地址必须为合法的 http(s) 链接', { field: 'url' });
  }
  await ctx.env.DB.prepare(
    'UPDATE links SET name=?, url=?, avatar_url=?, description=?, sort_order=?, is_visible=? WHERE id=?'
  )
    .bind(
      body.name?.trim() ?? existing.name,
      url,
      body.avatarUrl !== undefined ? body.avatarUrl || null : existing.avatar_url,
      body.description !== undefined ? body.description.trim() || null : existing.description,
      body.sortOrder ?? existing.sort_order,
      body.isVisible !== undefined ? (body.isVisible ? 1 : 0) : existing.is_visible,
      id
    )
    .run();
  await logOperation(ctx.env, user.id, user.username, 'link.update', 'link', id);
  return jsonOk(await listLinkData(ctx), 200, '友链已更新');
}

export async function handleLinkDelete(ctx: Ctx): Promise<Response> {
  const user = requireUser(ctx);
  const id = intParam(ctx.params.id, 0, 1, 1e9);
  await ctx.env.DB.prepare('DELETE FROM links WHERE id = ?').bind(id).run();
  await logOperation(ctx.env, user.id, user.username, 'link.delete', 'link', id);
  return jsonOk(await listLinkData(ctx), 200, '友链已删除');
}

// ============ URL 重定向 ============

async function listRedirectData(ctx: Ctx): Promise<Redirect[]> {
  const rows = await ctx.env.DB.prepare('SELECT * FROM redirects ORDER BY id DESC').all<Record<string, unknown>>();
  return rows.results.map((r) => ({
    id: Number(r.id),
    fromPath: String(r.from_path),
    toPath: String(r.to_path),
    statusCode: Number(r.status_code ?? 301),
    isActive: Boolean(r.is_active),
    hitCount: Number(r.hit_count ?? 0),
    createdAt: String(r.created_at)
  }));
}

export async function handleRedirectList(ctx: Ctx): Promise<Response> {
  requireUser(ctx);
  return jsonOk(await listRedirectData(ctx));
}

export async function handleRedirectCreate(ctx: Ctx): Promise<Response> {
  const user = requireUser(ctx);
  const body = await readJson<Partial<{ fromPath: string; toPath: string; statusCode: number; isActive: boolean }>>(ctx);
  const from = (body.fromPath ?? '').trim();
  const to = (body.toPath ?? '').trim();
  if (!from.startsWith('/')) throw new HttpError(422, '源路径必须以 / 开头', { field: 'fromPath' });
  if (!to.startsWith('/') && !/^https?:\/\//i.test(to)) {
    throw new HttpError(422, '目标路径必须以 / 开头或为完整链接', { field: 'toPath' });
  }
  if (from === to) throw new HttpError(422, '源路径与目标路径不能相同', { field: 'toPath' });

  const dup = await ctx.env.DB.prepare('SELECT id FROM redirects WHERE from_path = ?').bind(from).first<{ id: number }>();
  if (dup) throw new HttpError(409, '该源路径已存在重定向规则', { field: 'fromPath' });

  const result = await ctx.env.DB.prepare(
    'INSERT INTO redirects (from_path, to_path, status_code, is_active, created_at) VALUES (?, ?, ?, ?, ?)'
  )
    .bind(
      from,
      to,
      body.statusCode === 302 ? 302 : 301,
      body.isActive === false ? 0 : 1,
      ctx.now
    )
    .run();
  await logOperation(ctx.env, user.id, user.username, 'redirect.create', 'redirect', Number(result.meta.last_row_id), `${from} → ${to}`);
  return jsonOk(await listRedirectData(ctx), 201, '重定向已创建');
}

export async function handleRedirectDelete(ctx: Ctx): Promise<Response> {
  const user = requireUser(ctx);
  const id = intParam(ctx.params.id, 0, 1, 1e9);
  await ctx.env.DB.prepare('DELETE FROM redirects WHERE id = ?').bind(id).run();
  await logOperation(ctx.env, user.id, user.username, 'redirect.delete', 'redirect', id);
  return jsonOk(await listRedirectData(ctx), 200, '重定向已删除');
}

// ============ 设置 ============

export async function handleSettingsGet(ctx: Ctx): Promise<Response> {
  requireUser(ctx);
  return jsonOk(await getSettings(ctx.env));
}

export async function handleSettingsUpdate(ctx: Ctx): Promise<Response> {
  const user = requireUser(ctx);
  const body = await readJson<Record<string, unknown>>(ctx);

  // 敏感字段禁止从前端写入
  for (const forbidden of ['sessionSecret', 'ipHashSalt', 'adminSetupToken', 'r2Secret', 'apiKey']) {
    if (forbidden in body) {
      throw new HttpError(422, `敏感配置 ${forbidden} 必须通过 Cloudflare Secrets 设置，不能在后台修改`);
    }
  }
  if (body.accentColor !== undefined) {
    const color = String(body.accentColor);
    if (!/^#[0-9a-fA-F]{6}$/.test(color)) {
      throw new HttpError(422, '主题色必须是 #RRGGBB 格式', { field: 'accentColor' });
    }
  }
  if (body.siteUrl !== undefined && body.siteUrl) {
    if (!/^https?:\/\//i.test(String(body.siteUrl))) {
      throw new HttpError(422, '站点地址必须以 http(s):// 开头', { field: 'siteUrl' });
    }
  }

  const next = await saveSettings(ctx.env, body);
  await logOperation(ctx.env, user.id, user.username, 'settings.update', 'settings');
  return jsonOk(next, 200, '设置已保存');
}

// ============ 工作台 ============

export async function handleDashboard(ctx: Ctx): Promise<Response> {
  requireUser(ctx);
  const base = ctx.url.origin;
  const [postCounts, commentCounts, views, trend, top, logs, recent, paths] = await Promise.all([
    countPostsByStatus(ctx.env),
    countCommentsByStatus(ctx.env),
    viewStats(ctx.env),
    viewTrend(ctx.env, 14),
    topPosts(ctx.env, 8),
    listLogs(ctx.env, 12),
    listPosts(ctx.env, { page: 1, pageSize: 6 }, base),
    topPaths(ctx.env, 8)
  ]);

  return jsonOk({
    stats: {
      totalPosts: Object.values(postCounts).reduce((a, b) => a + b, 0),
      publishedPosts: postCounts.published ?? 0,
      draftPosts: postCounts.draft ?? 0,
      scheduledCount: postCounts.scheduled ?? 0,
      archivedPosts: postCounts.archived ?? 0,
      trashedPosts: postCounts.trashed ?? 0,
      pendingComments: commentCounts.pending ?? 0,
      totalViews: views.totalViews,
      totalVisitors: views.totalVisitors,
      todayViews: views.todayViews,
      todayVisitors: views.todayVisitors
    },
    trend,
    topPosts: top,
    topPaths: paths,
    recentPosts: recent.items,
    recentLogs: logs
  });
}

// ============ 操作日志 ============

export async function handleLogList(ctx: Ctx): Promise<Response> {
  requireUser(ctx);
  const limit = intParam(ctx.url.searchParams.get('limit'), 50, 1, 200);
  return jsonOk(await listLogs(ctx.env, limit));
}

// ============ 分类/标签 slug 检查（编辑器实时提示） ============

export async function handleSlugCheck(ctx: Ctx): Promise<Response> {
  requireUser(ctx);
  const type = ctx.url.searchParams.get('type') ?? 'posts';
  const slug = ctx.url.searchParams.get('slug') ?? '';
  const excludeId = intParam(ctx.url.searchParams.get('excludeId'), 0, 0, 1e9) || undefined;
  if (!slug) return jsonOk({ available: true, slug });
  if (!['posts', 'categories', 'tags'].includes(type)) throw new HttpError(400, '无效的类型');
  const exists = await ctx.env.DB.prepare(
    `SELECT id FROM ${type} WHERE slug = ?${excludeId ? ' AND id != ?' : ''}`
  )
    .bind(...(excludeId ? [slug, excludeId] : [slug]))
    .first<{ id: number }>();
  return jsonOk({ available: !exists, slug });
}

export { getCategoryById, getCategoryBySlug, listCategories, listLinks, listTags };
/** 公开 API —— /api/v1/*，服务端强制过滤非公开内容 */
import type { Ctx } from '../lib/context';
import { jsonOk } from '../lib/http';
import { intParam } from '../lib/context';
import {
  archives,
  getPostBySlug,
  listCategories,
  listPosts,
  listTags,
  searchPosts,
  countPostsByStatus
} from '../repositories/db';
import { getSettings } from '../services/settings';
import { listMenus } from '../repositories/db';
import type { PostSummary } from '@myblog/shared';

export function publicBase(ctx: Ctx): string {
  return ctx.url.origin;
}

/** 站点信息：前台启动时拉取一次 */
export async function handleSite(ctx: Ctx): Promise<Response> {
  const settings = await getSettings(ctx.env);
  const menus = await listMenus(ctx.env, 'header');
  const footerMenus = await listMenus(ctx.env, 'footer');
  return jsonOk({
    ...settings,
    menus,
    footerMenus
  });
}

/** 文章列表：只返回已发布且未删除的文章 */
export async function handlePostList(ctx: Ctx): Promise<Response> {
  const settings = await getSettings(ctx.env);
  const page = intParam(ctx.url.searchParams.get('page'), 1, 1, 10000);
  const pageSize = intParam(ctx.url.searchParams.get('pageSize'), settings.postsPerPage, 1, 50);
  const keyword = ctx.url.searchParams.get('q')?.trim() ?? '';
  const categorySlug = ctx.url.searchParams.get('category') ?? '';
  const tagSlug = ctx.url.searchParams.get('tag') ?? '';

  let categoryId: number | undefined;
  if (categorySlug) {
    const cats = await listCategories(ctx.env, { withCount: true });
    categoryId = cats.find((c) => c.slug === categorySlug)?.id;
    if (categoryId === undefined) {
      return jsonOk({ items: [], total: 0, page, pageSize, totalPages: 1 });
    }
  }
  let tagId: number | undefined;
  if (tagSlug) {
    const tags = await listTags(ctx.env, true);
    tagId = tags.find((t) => t.slug === tagSlug)?.id;
    if (tagId === undefined) {
      return jsonOk({ items: [], total: 0, page, pageSize, totalPages: 1 });
    }
  }

  const { items, total } = await listPosts(
    ctx.env,
    {
      type: 'post',
      status: 'published',
      categoryId,
      tagId,
      keyword: keyword || undefined,
      page,
      pageSize
    },
    publicBase(ctx)
  );

  return jsonOk({
    items,
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize))
  });
}

/** 文章详情 */
export async function handlePostDetail(ctx: Ctx): Promise<Response> {
  const post = await getPostBySlug(ctx.env, ctx.params.slug!, publicBase(ctx), false);
  if (!post) return jsonOk(null, 404, '文章不存在或未发布');
  return jsonOk(post);
}

/** 首页聚合数据 */
export async function handleHome(ctx: Ctx): Promise<Response> {
  const settings = await getSettings(ctx.env);
  const base = publicBase(ctx);
  const [featured, latest, categories, counts] = await Promise.all([
    listPosts(ctx.env, { type: 'post', status: 'published', featured: true, page: 1, pageSize: 3 }, base),
    listPosts(ctx.env, { type: 'post', status: 'published', page: 1, pageSize: settings.postsPerPage }, base),
    listCategories(ctx.env, { withCount: true }),
    countPostsByStatus(ctx.env)
  ]);

  return jsonOk({
    site: settings,
    menus: await listMenus(ctx.env, 'header'),
    featured: featured.items,
    latest: latest.items,
    categories: categories.filter((c) => (c.postCount ?? 0) > 0),
    totalPosts: counts.published ?? 0
  });
}

/** 分类列表 */
export async function handleCategories(ctx: Ctx): Promise<Response> {
  const categories = await listCategories(ctx.env, { withCount: true });
  return jsonOk(categories.filter((c) => (c.postCount ?? 0) > 0 || ctx.url.searchParams.get('all') === '1'));
}

/** 某分类下的文章 */
export async function handleCategoryPosts(ctx: Ctx): Promise<Response> {
  const slug = ctx.params.slug!;
  const base = publicBase(ctx);
  const cats = await listCategories(ctx.env, { withCount: true });
  const category = cats.find((c) => c.slug === slug);
  if (!category) return jsonOk(null, 404, '分类不存在');

  const page = intParam(ctx.url.searchParams.get('page'), 1, 1, 10000);
  const pageSize = intParam(ctx.url.searchParams.get('pageSize'), 10, 1, 50);
  const { items, total } = await listPosts(
    ctx.env,
    { type: 'post', status: 'published', categoryId: category.id, page, pageSize },
    base
  );
  return jsonOk({ category, items, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) });
}

export async function handleTags(ctx: Ctx): Promise<Response> {
  const tags = await listTags(ctx.env, true);
  return jsonOk(tags.filter((t) => (t.postCount ?? 0) > 0));
}

export async function handleTagPosts(ctx: Ctx): Promise<Response> {
  const slug = ctx.params.slug!;
  const base = publicBase(ctx);
  const tags = await listTags(ctx.env, true);
  const tag = tags.find((t) => t.slug === slug);
  if (!tag) return jsonOk(null, 404, '标签不存在');

  const page = intParam(ctx.url.searchParams.get('page'), 1, 1, 10000);
  const pageSize = intParam(ctx.url.searchParams.get('pageSize'), 10, 1, 50);
  const { items, total } = await listPosts(
    ctx.env,
    { type: 'post', status: 'published', tagId: tag.id, page, pageSize },
    base
  );
  return jsonOk({ tag, items, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) });
}

/** 归档 */
export async function handleArchives(ctx: Ctx): Promise<Response> {
  const groups = await archives(ctx.env, publicBase(ctx));
  return jsonOk(groups);
}

/** 独立页面 */
export async function handlePage(ctx: Ctx): Promise<Response> {
  const post = await getPostBySlug(ctx.env, ctx.params.slug!, publicBase(ctx), false);
  if (!post || post.type !== 'page') return jsonOk(null, 404, '页面不存在');
  return jsonOk(post);
}

/** 站内搜索：标题 + 摘要 + 正文，中文按子串匹配 */
export async function handleSearch(ctx: Ctx): Promise<Response> {
  const keyword = (ctx.url.searchParams.get('q') ?? '').trim();
  if (!keyword) {
    return jsonOk({ items: [] as PostSummary[], total: 0, keyword: '' });
  }
  const limit = intParam(ctx.url.searchParams.get('limit'), 30, 1, 100);
  const result = await searchPosts(ctx.env, keyword, publicBase(ctx), limit);
  return jsonOk(result);
}
/**
 * Cloudflare Worker 入口。
 *
 * 路由优先级：
 *   /api/v1/*        REST API（公开 + 管理）
 *   /admin/*         后台 SPA 静态资源
 *   /assets/*        前台构建产物（islands 脚本与静态资源）
 *   /media/*         R2 文件
 *   其他             前台 SSR HTML
 */
import type { Env } from './lib/env';
import { createCtx, type Ctx } from './lib/context';
import { assertCsrf, loadSession } from './lib/auth';
import { handleError, jsonError, jsonOk, HttpError } from './lib/http';
import { findRedirect, getPostBySlug, logOperation, recordView } from './repositories/db';
import { getSettings, ensureDefaultSettings } from './services/settings';
import { runScheduledJobs } from './jobs/scheduler';

import * as publicApi from './routes/public-api';
import * as adminAuth from './routes/admin-auth';
import * as adminPosts from './routes/admin-posts';
import * as adminMedia from './routes/admin-media';
import * as adminMisc from './routes/admin-misc';
import * as comments from './routes/comments';
import * as feed from './routes/feed';

import {
  adjacentPosts,
  archives,
  countPostsByStatus,
  getPostById,
  listCategories,
  listLinks,
  listMenus,
  listPosts,
  listTags,
  relatedPosts,
  searchPosts
} from './repositories/db';
import {
  articleContent,
  archivesContent,
  buildPage,
  categoriesContent,
  homeContent,
  linksContent,
  notFoundContent,
  postListContent,
  searchContent,
  serverErrorContent,
  simplePageContent,
  tagsContent
} from './services/pages';
import { renderMarkdown, escapeHtml } from '@myblog/shared';

// ============ API 路由表 ============

type Handler = (ctx: Ctx) => Promise<Response>;

interface RouteDef {
  method: string;
  pattern: RegExp;
  handler: Handler;
  /** 是否为管理接口（需登录 + CSRF） */
  admin?: boolean;
  /** GET 请求是否需要登录 */
  requireAuth?: boolean;
  /** 参数名列表，按顺序从正则捕获组取 */
  keys: string[];
}

function routes(): RouteDef[] {
  return [
    // ---- 公开 API ----
    { method: 'GET', pattern: /^\/api\/v1\/site$/, handler: publicApi.handleSite, keys: [] },
    { method: 'GET', pattern: /^\/api\/v1\/home$/, handler: publicApi.handleHome, keys: [] },
    { method: 'GET', pattern: /^\/api\/v1\/posts$/, handler: publicApi.handlePostList, keys: [] },
    { method: 'GET', pattern: /^\/api\/v1\/posts\/([^/]+)$/, handler: publicApi.handlePostDetail, keys: ['slug'] },
    { method: 'GET', pattern: /^\/api\/v1\/categories$/, handler: publicApi.handleCategories, keys: [] },
    { method: 'GET', pattern: /^\/api\/v1\/categories\/([^/]+)$/, handler: publicApi.handleCategoryPosts, keys: ['slug'] },
    { method: 'GET', pattern: /^\/api\/v1\/tags$/, handler: publicApi.handleTags, keys: [] },
    { method: 'GET', pattern: /^\/api\/v1\/tags\/([^/]+)$/, handler: publicApi.handleTagPosts, keys: ['slug'] },
    { method: 'GET', pattern: /^\/api\/v1\/archives$/, handler: publicApi.handleArchives, keys: [] },
    { method: 'GET', pattern: /^\/api\/v1\/pages\/([^/]+)$/, handler: publicApi.handlePage, keys: ['slug'] },
    { method: 'GET', pattern: /^\/api\/v1\/search$/, handler: publicApi.handleSearch, keys: [] },
    { method: 'GET', pattern: /^\/api\/v1\/(?:feed|rss|rss\.xml|feed\.xml|atom\.xml)$/, handler: handleFeedApi, keys: [] },
    { method: 'GET', pattern: /^\/api\/v1\/(?:sitemap\.xml|sitemap)$/, handler: handleSitemapApi, keys: [] },
    { method: 'GET', pattern: /^\/api\/v1\/setup-status$/, handler: adminAuth.handleSetupStatus, keys: [] },
    { method: 'POST', pattern: /^\/api\/v1\/setup$/, handler: adminAuth.handleSetup, keys: [] },

    // ---- 评论 ----
    { method: 'GET', pattern: /^\/api\/v1\/posts\/([^/]+)\/comments$/, handler: comments.handleCommentList, keys: ['id'] },
    { method: 'POST', pattern: /^\/api\/v1\/posts\/([^/]+)\/comments$/, handler: comments.handleCommentCreate, keys: ['id'] },
    { method: 'GET', pattern: /^\/api\/v1\/admin\/comments$/, handler: comments.handleAdminCommentList, keys: [], admin: true },
    { method: 'PATCH', pattern: /^\/api\/v1\/admin\/comments\/(\d+)$/, handler: comments.handleCommentUpdate, keys: ['id'], admin: true },
    { method: 'POST', pattern: /^\/api\/v1\/admin\/comments\/batch$/, handler: comments.handleCommentBatch, keys: [], admin: true },
    { method: 'DELETE', pattern: /^\/api\/v1\/admin\/comments\/(\d+)$/, handler: comments.handleCommentDelete, keys: ['id'], admin: true },

    // ---- 认证 ----
    { method: 'POST', pattern: /^\/api\/v1\/admin\/auth\/login$/, handler: adminAuth.handleLogin, keys: [] },
    { method: 'POST', pattern: /^\/api\/v1\/admin\/auth\/logout$/, handler: adminAuth.handleLogout, keys: [] },
    { method: 'GET', pattern: /^\/api\/v1\/admin\/me$/, handler: adminAuth.handleMe, keys: [], requireAuth: true },
    { method: 'PUT', pattern: /^\/api\/v1\/admin\/profile$/, handler: adminAuth.handleUpdateProfile, keys: [], requireAuth: true },
    { method: 'PUT', pattern: /^\/api\/v1\/admin\/password$/, handler: adminAuth.handleChangePassword, keys: [], requireAuth: true },

    // ---- 文章 ----
    { method: 'GET', pattern: /^\/api\/v1\/admin\/dashboard$/, handler: adminMisc.handleDashboard, keys: [], requireAuth: true },
    { method: 'GET', pattern: /^\/api\/v1\/admin\/logs$/, handler: adminMisc.handleLogList, keys: [], requireAuth: true },
    { method: 'GET', pattern: /^\/api\/v1\/admin\/slug-check$/, handler: adminMisc.handleSlugCheck, keys: [], requireAuth: true },

    { method: 'GET', pattern: /^\/api\/v1\/admin\/posts$/, handler: adminPosts.handleAdminPostList, keys: [], requireAuth: true },
    { method: 'POST', pattern: /^\/api\/v1\/admin\/posts$/, handler: adminPosts.handleCreatePost, keys: [], requireAuth: true },
    { method: 'GET', pattern: /^\/api\/v1\/admin\/posts\/(\d+)$/, handler: handleAdminPostDetail, keys: ['id'], requireAuth: true },
    { method: 'PUT', pattern: /^\/api\/v1\/admin\/posts\/(\d+)$/, handler: adminPosts.handleUpdatePost, keys: ['id'], requireAuth: true },
    { method: 'PATCH', pattern: /^\/api\/v1\/admin\/posts\/(\d+)$/, handler: adminPosts.handleUpdatePost, keys: ['id'], requireAuth: true },
    { method: 'DELETE', pattern: /^\/api\/v1\/admin\/posts\/(\d+)$/, handler: adminPosts.handleTrashPost, keys: ['id'], requireAuth: true },
    { method: 'POST', pattern: /^\/api\/v1\/admin\/posts\/(\d+)\/publish$/, handler: adminPosts.handlePublishPost, keys: ['id'], requireAuth: true },
    { method: 'POST', pattern: /^\/api\/v1\/admin\/posts\/(\d+)\/schedule$/, handler: adminPosts.handleSchedulePost, keys: ['id'], requireAuth: true },
    { method: 'DELETE', pattern: /^\/api\/v1\/admin\/posts\/(\d+)\/schedule$/, handler: adminPosts.handleUnschedulePost, keys: ['id'], requireAuth: true },
    { method: 'POST', pattern: /^\/api\/v1\/admin\/posts\/(\d+)\/archive$/, handler: adminPosts.handleArchivePost, keys: ['id'], requireAuth: true },
    { method: 'POST', pattern: /^\/api\/v1\/admin\/posts\/(\d+)\/restore$/, handler: adminPosts.handleRestorePost, keys: ['id'], requireAuth: true },
    { method: 'DELETE', pattern: /^\/api\/v1\/admin\/posts\/(\d+)\/permanent$/, handler: adminPosts.handleDeleteForever, keys: ['id'], requireAuth: true },
    { method: 'POST', pattern: /^\/api\/v1\/admin\/posts\/(\d+)\/duplicate$/, handler: adminPosts.handleDuplicatePost, keys: ['id'], requireAuth: true },
    { method: 'POST', pattern: /^\/api\/v1\/admin\/posts\/batch$/, handler: adminPosts.handleBatchPost, keys: [], requireAuth: true },
    { method: 'GET', pattern: /^\/api\/v1\/admin\/posts\/(\d+)\/revisions$/, handler: adminPosts.handleRevisionList, keys: ['id'], requireAuth: true },
    { method: 'GET', pattern: /^\/api\/v1\/admin\/posts\/(\d+)\/revisions\/(\d+)$/, handler: adminPosts.handleRevisionDetail, keys: ['id', 'revId'], requireAuth: true },
    { method: 'POST', pattern: /^\/api\/v1\/admin\/posts\/(\d+)\/revisions\/(\d+)\/restore$/, handler: adminPosts.handleRestoreRevision, keys: ['id', 'revId'], requireAuth: true },
    { method: 'GET', pattern: /^\/api\/v1\/admin\/posts\/(\d+)\/adjacent$/, handler: adminPosts.handleAdjacent, keys: ['id'], requireAuth: true },
    { method: 'GET', pattern: /^\/api\/v1\/admin\/preview\/([^/]+)$/, handler: adminPosts.handlePreview, keys: ['slug'], requireAuth: true },

    // ---- 媒体 ----
    { method: 'GET', pattern: /^\/api\/v1\/admin\/media$/, handler: adminMedia.handleMediaList, keys: [], requireAuth: true },
    { method: 'GET', pattern: /^\/api\/v1\/admin\/media\/stats$/, handler: adminMedia.handleMediaStats, keys: [], requireAuth: true },
    { method: 'POST', pattern: /^\/api\/v1\/admin\/media\/upload$/, handler: adminMedia.handleMediaUpload, keys: [], requireAuth: true },
    { method: 'PUT', pattern: /^\/api\/v1\/admin\/media\/(\d+)$/, handler: adminMedia.handleMediaUpdate, keys: ['id'], requireAuth: true },
    { method: 'DELETE', pattern: /^\/api\/v1\/admin\/media\/(\d+)$/, handler: adminMedia.handleMediaDelete, keys: ['id'], requireAuth: true },
    { method: 'GET', pattern: /^\/api\/v1\/admin\/media\/(\d+)\/usage$/, handler: adminMedia.handleMediaUsage, keys: ['id'], requireAuth: true },

    // ---- 分类 ----
    { method: 'GET', pattern: /^\/api\/v1\/admin\/categories$/, handler: adminMisc.handleCategoryList, keys: [], requireAuth: true },
    { method: 'POST', pattern: /^\/api\/v1\/admin\/categories$/, handler: adminMisc.handleCategoryCreate, keys: [], requireAuth: true },
    { method: 'PUT', pattern: /^\/api\/v1\/admin\/categories\/(\d+)$/, handler: adminMisc.handleCategoryUpdate, keys: ['id'], requireAuth: true },
    { method: 'DELETE', pattern: /^\/api\/v1\/admin\/categories\/(\d+)$/, handler: adminMisc.handleCategoryDelete, keys: ['id'], requireAuth: true },

    // ---- 标签 ----
    { method: 'GET', pattern: /^\/api\/v1\/admin\/tags$/, handler: adminMisc.handleTagList, keys: [], requireAuth: true },
    { method: 'POST', pattern: /^\/api\/v1\/admin\/tags$/, handler: adminMisc.handleTagCreate, keys: [], requireAuth: true },
    { method: 'PUT', pattern: /^\/api\/v1\/admin\/tags\/(\d+)$/, handler: adminMisc.handleTagUpdate, keys: ['id'], requireAuth: true },
    { method: 'DELETE', pattern: /^\/api\/v1\/admin\/tags\/(\d+)$/, handler: adminMisc.handleTagDelete, keys: ['id'], requireAuth: true },
    { method: 'POST', pattern: /^\/api\/v1\/admin\/tags\/merge$/, handler: adminMisc.handleTagMerge, keys: [], requireAuth: true },

    // ---- 菜单 ----
    { method: 'GET', pattern: /^\/api\/v1\/admin\/menus$/, handler: adminMisc.handleMenuList, keys: [], requireAuth: true },
    { method: 'POST', pattern: /^\/api\/v1\/admin\/menus$/, handler: adminMisc.handleMenuCreate, keys: [], requireAuth: true },
    { method: 'PUT', pattern: /^\/api\/v1\/admin\/menus\/(\d+)$/, handler: adminMisc.handleMenuUpdate, keys: ['id'], requireAuth: true },
    { method: 'DELETE', pattern: /^\/api\/v1\/admin\/menus\/(\d+)$/, handler: adminMisc.handleMenuDelete, keys: ['id'], requireAuth: true },
    { method: 'POST', pattern: /^\/api\/v1\/admin\/menus\/reorder$/, handler: adminMisc.handleMenuReorder, keys: [], requireAuth: true },

    // ---- 友链 ----
    { method: 'GET', pattern: /^\/api\/v1\/admin\/links$/, handler: adminMisc.handleLinkList, keys: [], requireAuth: true },
    { method: 'POST', pattern: /^\/api\/v1\/admin\/links$/, handler: adminMisc.handleLinkCreate, keys: [], requireAuth: true },
    { method: 'PUT', pattern: /^\/api\/v1\/admin\/links\/(\d+)$/, handler: adminMisc.handleLinkUpdate, keys: ['id'], requireAuth: true },
    { method: 'DELETE', pattern: /^\/api\/v1\/admin\/links\/(\d+)$/, handler: adminMisc.handleLinkDelete, keys: ['id'], requireAuth: true },

    // ---- 重定向 ----
    { method: 'GET', pattern: /^\/api\/v1\/admin\/redirects$/, handler: adminMisc.handleRedirectList, keys: [], requireAuth: true },
    { method: 'POST', pattern: /^\/api\/v1\/admin\/redirects$/, handler: adminMisc.handleRedirectCreate, keys: [], requireAuth: true },
    { method: 'DELETE', pattern: /^\/api\/v1\/admin\/redirects\/(\d+)$/, handler: adminMisc.handleRedirectDelete, keys: ['id'], requireAuth: true },

    // ---- 设置 ----
    { method: 'GET', pattern: /^\/api\/v1\/admin\/settings$/, handler: adminMisc.handleSettingsGet, keys: [], requireAuth: true },
    { method: 'PUT', pattern: /^\/api\/v1\/admin\/settings$/, handler: adminMisc.handleSettingsUpdate, keys: [], requireAuth: true },

    // ---- 任务 ----
    { method: 'POST', pattern: /^\/api\/v1\/admin\/jobs\/run$/, handler: handleRunJobs, keys: [], requireAuth: true }
  ];
}

/** 文章详情（含相邻、相关文章、目录） */
async function handleAdminPostDetail(ctx: Ctx): Promise<Response> {
  const id = Number(ctx.params.id);
  const post = await getPostById(ctx.env, id, ctx.url.origin);
  if (!post) throw new HttpError(404, '文章不存在');
  const [adj, rel] = await Promise.all([
    adjacentPosts(ctx.env, post.publishedAt ?? post.createdAt, id, ctx.url.origin),
    relatedPosts(ctx.env, post, 6, ctx.url.origin)
  ]);
  return jsonOk({ ...post, ...adj, related: rel });
}

async function handleRunJobs(ctx: Ctx): Promise<Response> {
  if (!ctx.user) throw new HttpError(401, '未登录');
  const before = await countPostsByStatus(ctx.env);
  await runScheduledJobs(ctx.env);
  const after = await countPostsByStatus(ctx.env);
  return jsonOk({
    published: (before.scheduled ?? 0) - (after.scheduled ?? 0)
  }, 200, '定时任务已执行');
}

/** RSS / Atom 输出 */
async function handleFeedApi(ctx: Ctx): Promise<Response> {
  return feed.handleFeed(ctx);
}

/** Sitemap 输出 */
async function handleSitemapApi(ctx: Ctx): Promise<Response> {
  return feed.handleSitemap(ctx);
}

// ============ 主处理流程 ============

async function handleApi(request: Request, env: Env, ctx: Ctx): Promise<Response> {
  const path = ctx.url.pathname;
  const method = request.method.toUpperCase();

  for (const route of routes()) {
    if (route.method !== method) continue;
    const match = route.pattern.exec(path);
    if (!match) continue;

    const params: Record<string, string> = {};
    route.keys.forEach((k, i) => {
      params[k] = decodeURIComponent(match[i + 1] ?? '');
    });

    // 公开接口也解析会话，便于「登录后显示管理入口」
    if (!ctx.user) {
      await loadSession(ctx);
    }

    if ((route.admin || route.requireAuth) && !ctx.user) {
      return jsonError(401, '未登录或登录已过期');
    }

    // 写操作强制 CSRF 校验（登录接口例外，否则无法建立会话）
    const isLoginRoute = path === '/api/v1/admin/auth/login' || path === '/api/v1/setup';
    if (ctx.user && !isLoginRoute) {
      assertCsrf(ctx);
    }

    const fresh = { ...ctx, params } as Ctx;
    return route.handler(fresh);
  }

  // 支持 CORS 预检
  if (method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: { Allow: 'GET,POST,PUT,PATCH,DELETE,OPTIONS' } });
  }

  return jsonError(404, `接口不存在：${method} ${path}`);
}

// ============ SSR 前台 ============

interface RenderEnv {
  settings: Awaited<ReturnType<typeof getSettings>>;
  menus: Awaited<ReturnType<typeof listMenus>>;
  footerMenus: Awaited<ReturnType<typeof listMenus>>;
  socials: Awaited<ReturnType<typeof listMenus>>;
}

async function loadRenderEnv(env: Env): Promise<RenderEnv> {
  const settings = await getSettings(env);
  const [menus, footerMenus, socials] = await Promise.all([
    listMenus(env, 'header'),
    listMenus(env, 'footer'),
    listMenus(env, 'social')
  ]);
  return { settings, menus, footerMenus, socials };
}

async function handleSsr(request: Request, env: Env, ctx: Ctx, islandScripts: string[]): Promise<Response> {
  const path = ctx.url.pathname.replace(/\/+$/, '') || '/';
  const re = { url: ctx.url, islandScripts };
  const reData = await loadRenderEnv(env);
  const { settings, menus, socials } = reData;
  const siteUrl = (settings.siteUrl || ctx.url.origin).replace(/\/$/, '');
  const pageCtx = { url: ctx.url, islandScripts };
  const base = publicBaseUrl(ctx);
  const abs = (p: string) => `${siteUrl}${p.startsWith('/') ? p : `/${p}`}`;

  const html = (content: string, init?: ResponseInit) =>
    new Response(content, {
      ...init,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-cache',
        // 允许后台 iframe 预览与外部分享
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'strict-origin-when-cross-origin',
        'X-Frame-Options': 'SAMEORIGIN',
        ...(init?.headers ?? {})
      }
    });

  // ---- 首页 ----
  if (path === '/') {
    const [featured, latest, categories, counts] = await Promise.all([
      listPosts(env, { type: 'post', status: 'published', featured: true, page: 1, pageSize: 3 }, base),
      listPosts(env, { type: 'post', status: 'published', page: 1, pageSize: settings.postsPerPage }, base),
      listCategories(env, { withCount: true }),
      countPostsByStatus(env)
    ]);
    const content = homeContent({
      settings,
      featured: featured.items,
      latest: latest.items,
      categories: categories.filter((c) => (c.postCount ?? 0) > 0),
      totalPosts: counts.published ?? 0,
      socials
    });
    return html(
      buildPage(pageCtx, settings, menus, socials, {
        title: `${settings.siteName}${settings.siteDescription ? ` — ${settings.siteDescription}` : ''}`,
        description: settings.siteDescription,
        canonical: abs('/'),
        jsonLd: {
          '@context': 'https://schema.org',
          '@type': 'WebSite',
          name: settings.siteName,
          description: settings.siteDescription,
          url: abs('/')
        }
      }, content)
    );
  }

  // ---- 文章列表 ----
  if (path === '/posts') {
    const page = Math.max(1, Number(ctx.url.searchParams.get('page')) || 1);
    const catSlug = ctx.url.searchParams.get('category') ?? '';
    const tagSlug = ctx.url.searchParams.get('tag') ?? '';
    const q = ctx.url.searchParams.get('q')?.trim() ?? '';

    let categoryId: number | undefined;
    if (catSlug) {
      categoryId = (await listCategories(env, { withCount: true })).find((c) => c.slug === catSlug)?.id;
    }
    let tagId: number | undefined;
    if (tagSlug) {
      tagId = (await listTags(env, true)).find((t) => t.slug === tagSlug)?.id;
    }
    const { items, total } = await listPosts(
      env,
      { type: 'post', status: 'published', categoryId, tagId, keyword: q || undefined, page, pageSize: settings.postsPerPage },
      base
    );
    const totalPages = Math.max(1, Math.ceil(total / settings.postsPerPage));
    const heading = catSlug
      ? `分类：${(await listCategories(env, { withCount: true })).find((c) => c.slug === catSlug)?.name ?? catSlug}`
      : tagSlug
        ? `标签：#${(await listTags(env, true)).find((t) => t.slug === tagSlug)?.name ?? tagSlug}`
        : q
          ? `搜索：${q}`
          : '全部文章';

    const content = postListContent({
      items,
      page,
      totalPages,
      baseUrl: path + (q ? `?q=${encodeURIComponent(q)}` : ''),
      heading,
      desc: `共 ${total} 篇文章`
    });
    return html(
      buildPage(pageCtx, settings, menus, socials, {
        title: `${heading} — ${settings.siteName}`,
        description: `${heading}，共 ${total} 篇文章`,
        canonical: abs(path),
        noindex: Boolean(q) || page > 1
      }, content)
    );
  }

  // ---- 文章详情 ----
  const postMatch = /^\/posts\/([^/]+)$/.exec(path);
  if (postMatch) {
    const slug = decodeURIComponent(postMatch[1]);
    const post = await getPostBySlug(env, slug, base, false);
    if (!post || post.type !== 'post') {
      return html(
        buildPage(pageCtx, settings, menus, socials, {
          title: `文章不存在 — ${settings.siteName}`,
          description: '该文章不存在或已被删除',
          canonical: abs(path),
          noindex: true
        }, notFoundContent(path)),
        { status: 404 }
      );
    }
    const { html: bodyHtml, toc } = renderMarkdown(post.content);
    const [adj, rel] = await Promise.all([
      adjacentPosts(env, post.publishedAt ?? post.createdAt, post.id, base),
      relatedPosts(env, post, 5, base)
    ]);
    const commentCount = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM comments WHERE post_id = ? AND status = 'approved'"
    )
      .bind(post.id)
      .first<{ n: number }>();

    const title = post.seoTitle || `${post.title} — ${settings.siteName}`;
    const desc = post.seoDescription || post.excerpt || settings.siteDescription;
    const canonical = post.canonicalUrl || abs(`/posts/${post.slug}`);

    const content = articleContent(
      { ...post, html: bodyHtml, toc, related: rel, prev: adj.prev, next: adj.next, commentCount: commentCount?.n ?? 0 },
      settings
    );

    return html(
      buildPage(
        pageCtx,
        settings,
        menus,
        socials,
        {
          title,
          description: desc,
          canonical,
          ogType: 'article',
          ogImage: post.coverUrl,
          noindex: !post.robotsIndex,
          jsonLd: {
            '@context': 'https://schema.org',
            '@type': 'BlogPosting',
            headline: post.title,
            description: desc,
            image: post.coverUrl ? [post.coverUrl] : undefined,
            datePublished: post.publishedAt,
            dateModified: post.updatedAt,
            author: { '@type': 'Person', name: post.authorName ?? settings.siteName },
            publisher: { '@type': 'Organization', name: settings.siteName },
            mainEntityOfPage: canonical,
            keywords: post.tags.map((t) => t.name).join(', ')
          }
        },
        content
      ),
      {
        headers: {
          ETag: `W/"post-${post.id}-${post.revision}"`
        }
      }
    );
  }

  // ---- 归档 ----
  if (path === '/archives') {
    const groups = await archives(env, base);
    return html(
      buildPage(pageCtx, settings, menus, socials, {
        title: `归档 — ${settings.siteName}`,
        description: '按年份与月份浏览全部文章',
        canonical: abs('/archives'),
        jsonLd: {
          '@context': 'https://schema.org',
          '@type': 'CollectionPage',
          name: '文章归档',
          url: abs('/archives')
        }
      }, archivesContent(groups))
    );
  }

  // ---- 分类 ----
  if (path === '/categories') {
    const categories = (await listCategories(env, { withCount: true })).filter(
      (c) => (c.postCount ?? 0) > 0
    );
    return html(
      buildPage(pageCtx, settings, menus, socials, {
        title: `分类 — ${settings.siteName}`,
        description: '浏览全部文章分类',
        canonical: abs('/categories')
      }, categoriesContent(categories))
    );
  }

  const catMatch = /^\/categories\/([^/]+)$/.exec(path);
  if (catMatch) {
    const slug = decodeURIComponent(catMatch[1]);
    const category = (await listCategories(env, { withCount: true })).find((c) => c.slug === slug);
    if (!category) {
      return html(buildPage(pageCtx, settings, menus, socials, { title: '分类不存在', description: '', canonical: abs(path), noindex: true }, notFoundContent(path)), { status: 404 });
    }
    const page = Math.max(1, Number(ctx.url.searchParams.get('page')) || 1);
    const { items, total } = await listPosts(
      env,
      { type: 'post', status: 'published', categoryId: category.id, page, pageSize: settings.postsPerPage },
      base
    );
    const content = postListContent({
      items,
      page,
      totalPages: Math.max(1, Math.ceil(total / settings.postsPerPage)),
      baseUrl: path,
      heading: category.name,
      eyebrow: '分类',
      desc: category.description || category.seoDescription || `共 ${total} 篇文章`
    });
    return html(
      buildPage(pageCtx, settings, menus, socials, {
        title: category.seoTitle || `${category.name} — ${settings.siteName}`,
        description: category.seoDescription || category.description || '',
        canonical: abs(path),
        noindex: page > 1
      }, content)
    );
  }

  // ---- 标签 ----
  if (path === '/tags') {
    const tags = (await listTags(env, true)).filter((t) => (t.postCount ?? 0) > 0);
    return html(
      buildPage(pageCtx, settings, menus, socials, {
        title: `标签 — ${settings.siteName}`,
        description: '浏览全部文章标签',
        canonical: abs('/tags')
      }, tagsContent(tags))
    );
  }

  const tagMatch = /^\/tags\/([^/]+)$/.exec(path);
  if (tagMatch) {
    const slug = decodeURIComponent(tagMatch[1]);
    const tag = (await listTags(env, true)).find((t) => t.slug === slug);
    if (!tag) {
      return html(buildPage(pageCtx, settings, menus, socials, { title: '标签不存在', description: '', canonical: abs(path), noindex: true }, notFoundContent(path)), { status: 404 });
    }
    const page = Math.max(1, Number(ctx.url.searchParams.get('page')) || 1);
    const { items, total } = await listPosts(
      env,
      { type: 'post', status: 'published', tagId: tag.id, page, pageSize: settings.postsPerPage },
      base
    );
    const content = postListContent({
      items,
      page,
      totalPages: Math.max(1, Math.ceil(total / settings.postsPerPage)),
      baseUrl: path,
      heading: `#${tag.name}`,
      eyebrow: '标签',
      desc: tag.description || `共 ${total} 篇文章`
    });
    return html(
      buildPage(pageCtx, settings, menus, socials, {
        title: tag.seoTitle || `#${tag.name} — ${settings.siteName}`,
        description: tag.seoDescription || tag.description || '',
        canonical: abs(path),
        noindex: page > 1
      }, content)
    );
  }

  // ---- 搜索 ----
  if (path === '/search') {
    const keyword = (ctx.url.searchParams.get('q') ?? '').trim();
    const result = keyword ? await searchPosts(env, keyword, base, 30) : { items: [], total: 0 };
    return html(
      buildPage(pageCtx, settings, menus, socials, {
        title: keyword ? `搜索「${keyword}」— ${settings.siteName}` : `搜索 — ${settings.siteName}`,
        description: '站内文章搜索',
        canonical: abs('/search'),
        noindex: true
      }, searchContent(keyword, result.items, '/search'))
    );
  }

  // ---- 关于我 ----
  if (path === '/about') {
    const aboutPage = await getPostBySlug(env, 'about', base, false);
    const bodyHtml = aboutPage
      ? renderMarkdown(aboutPage.content).html
      : renderMarkdown(settings.aboutContent || '## 关于我\n\n还没有填写关于我的内容。').html;
    return html(
      buildPage(pageCtx, settings, menus, socials, {
        title: `关于我 — ${settings.siteName}`,
        description: settings.siteDescription,
        canonical: abs('/about'),
        jsonLd: {
          '@context': 'https://schema.org',
          '@type': 'AboutPage',
          name: '关于我',
          url: abs('/about')
        }
      }, simplePageContent('关于我', bodyHtml, settings.siteDescription))
    );
  }

  // ---- 项目 ----
  if (path === '/projects') {
    const projectsPage = await getPostBySlug(env, 'projects', base, false);
    const bodyHtml = projectsPage
      ? renderMarkdown(projectsPage.content).html
      : renderMarkdown('## 项目\n\n还没有添加项目。').html;
    return html(
      buildPage(pageCtx, settings, menus, socials, {
        title: `项目 — ${settings.siteName}`,
        description: '我的个人项目与作品',
        canonical: abs('/projects')
      }, simplePageContent('项目', bodyHtml))
    );
  }

  // ---- 友链 ----
  if (path === '/links') {
    const links = await listLinks(env);
    return html(
      buildPage(pageCtx, settings, menus, socials, {
        title: `友情链接 — ${settings.siteName}`,
        description: '友情链接与推荐',
        canonical: abs('/links')
      }, linksContent(links))
    );
  }

  // ---- 隐私政策 ----
  if (path === '/privacy') {
    const privacyPage = await getPostBySlug(env, 'privacy', base, false);
    const bodyHtml = privacyPage
      ? renderMarkdown(privacyPage.content).html
      : renderMarkdown('## 隐私政策\n\n本站不收集个人信息，访问统计仅保存匿名化的访客哈希。').html;
    return html(
      buildPage(pageCtx, settings, menus, socials, {
        title: `隐私政策 — ${settings.siteName}`,
        description: '本站的隐私政策',
        canonical: abs('/privacy')
      }, simplePageContent('隐私政策', bodyHtml))
    );
  }

  // ---- 自定义页面 ----
  const pageMatch = /^\/p\/([^/]+)$/.exec(path);
  if (pageMatch) {
    const slug = decodeURIComponent(pageMatch[1]);
    const page = await getPostBySlug(env, slug, base, false);
    if (!page || page.type !== 'page') {
      return html(buildPage(pageCtx, settings, menus, socials, { title: '页面不存在', description: '', canonical: abs(path), noindex: true }, notFoundContent(path)), { status: 404 });
    }
    const { html: bodyHtml, toc } = renderMarkdown(page.content);
    return html(
      buildPage(pageCtx, settings, menus, socials, {
        title: page.seoTitle || `${page.title} — ${settings.siteName}`,
        description: page.seoDescription || page.excerpt || '',
        canonical: page.canonicalUrl || abs(path),
        ogType: 'article',
        ogImage: page.coverUrl,
        noindex: !page.robotsIndex
      }, simplePageContent(page.title, bodyHtml, page.excerpt ?? undefined))
    );
  }

  // ---- RSS / Sitemap / robots ----
  if (path === '/feed' || path === '/rss' || path === '/feed.xml' || path === '/rss.xml') {
    return feed.handleFeed(ctx);
  }
  if (path === '/sitemap.xml' || path === '/sitemap') {
    return feed.handleSitemap(ctx);
  }
  if (path === '/robots.txt') {
    return feed.handleRobots(ctx);
  }

  // ---- 404 ----
  return html(
    buildPage(pageCtx, settings, menus, socials, {
      title: `页面不存在 — ${settings.siteName}`,
      description: '你访问的页面不存在',
      canonical: abs(path),
      noindex: true
    }, notFoundContent(path)),
    { status: 404 }
  );
}

function publicBaseUrl(ctx: Ctx): string {
  return ctx.url.origin;
}

/**
 * 前台交互岛脚本。
 * 构建产物在 apps/worker/public/islands/app.js，由 apps/web 构建生成。
 * 加上时间戳查询参数保证发版后立即生效（静态资源长缓存）。
 */
const BUILD_ID = 'v1';
const ISLAND_SCRIPTS = [`/islands/app.js?b=${BUILD_ID}`];

// ============ 入口 ============

export default {
  async fetch(request: Request, env: Env, ctxObj: ExecutionContext): Promise<Response> {
    const ctx = await createCtx(request, env, {}, (p) => ctxObj.waitUntil(p));
    const url = ctx.url;

    try {
      // 首次访问时初始化默认设置与导航菜单。
      // 放在正常路径而非仅 catch 分支，否则新部署的站点会因缺少默认菜单而顶栏空白。
      await ensureDefaultSettings(env);

      // 安全响应头
      const securityHeaders: Record<string, string> = {
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'SAMEORIGIN',
        'Referrer-Policy': 'strict-origin-when-cross-origin',
        'Permissions-Policy': 'geolocation=(), microphone=(), camera=()'
      };

      // ---- API ----
      if (url.pathname.startsWith('/api/')) {
        const res = await handleApi(request, env, ctx);
        return mergeHeaders(res, ctx.setCookies, securityHeaders);
      }

      // ---- R2 媒体 ----
      if (url.pathname.startsWith('/media/')) {
        const key = decodeURIComponent(url.pathname.slice('/media/'.length));
        if (!key || key.includes('..')) return new Response('Bad Request', { status: 400 });
        const object = await env.BUCKET.get(key);
        if (!object) return new Response('Not Found', { status: 404 });
        const headers = new Headers();
        object.writeHttpMetadata(headers);
        headers.set('Cache-Control', 'public, max-age=31536000, immutable');
        headers.set('ETag', object.httpEtag);
        headers.set('Access-Control-Allow-Origin', '*');
        if (request.method === 'HEAD') return new Response(null, { headers });
        return new Response(object.body, { headers });
      }

      // ---- 后台 SPA ----
// run_worker_first 模式下所有请求先进 Worker，静态文件由env.ASSETS.fetch 读取。
// 关键：读取时必须用「不带原 query 的干净路径」，否则 index.html?b=v2 这类
// 带查询串的请求在本地模拟器上会命中不到文件而返回空。
if (url.pathname === '/admin' || url.pathname.startsWith('/admin/')) {
        // 真实的静态资源（JS/CSS）原样透传
        if (url.pathname.startsWith('/admin/assets/')) {
          return env.ASSETS.fetch(new Request(new URL(url.pathname, url), request));
        }

        // 页面路由统一回退到后台入口 HTML。
        // 用 app.htm 而非 index.html：wrangler 本地模拟器对 .html 请求读不到内容，
        // .htm 扩展名可正常读取（构建时已自动复制，见 apps/admin/vite.config.ts）。
        const assetUrl = new URL('/admin/app.htm', url);
        assetUrl.search = '';
        const indexRes = await env.ASSETS.fetch(new Request(assetUrl.toString(), request));
        const html = await indexRes.text();
        if (!html) {
          return new Response(
            '管理后台资源未找到，请先运行 npm run build:admin 生成 apps/worker/public/admin',
            { status: 500, headers: { 'Content-Type': 'text/plain; charset=utf-8' } }
          );
        }
        return new Response(html, {
          status: 200,
          headers: {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'no-cache',
            'X-Robots-Tag': 'noindex, nofollow',
            'X-Content-Type-Options': 'nosniff',
            'Referrer-Policy': 'strict-origin-when-cross-origin'
          }
        });
      }

      // ---- 前台静态资源 ----
      if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/islands/')) {
        const res = await env.ASSETS.fetch(request);
        if (res.status < 400) return res;
      }

      // ---- URL 重定向规则 ----
      const redirect = await findRedirect(env, url.pathname);
      if (redirect) {
        return new Response(null, {
          status: redirect.statusCode,
          headers: { Location: redirect.toPath, 'Cache-Control': 'public, max-age=3600' }
        });
      }

      // ---- 前台 SSR ----
      await loadSession(ctx);
      const res = await handleSsr(request, env, ctx, ISLAND_SCRIPTS);

      // 异步记录访问统计（不阻塞响应）
      if (res.status < 400) {
        ctx.waitUntil(recordVisit(env, ctx, res));
      }
      return res;
    } catch (err) {
      if (err instanceof HttpError) return handleError(err);

      console.error('[error]', url.pathname, err);
      try {
        const reData = await loadRenderEnv(env);
        const body = buildPage(
          { url, islandScripts: [] },
          reData.settings,
          reData.menus,
          reData.socials,
          {
            title: `服务异常 — ${reData.settings.siteName}`,
            description: '',
            canonical: url.origin,
            noindex: true
          },
          serverErrorContent()
        );
        return new Response(body, {
          status: 500,
          headers: { 'Content-Type': 'text/html; charset=utf-8' }
        });
      } catch {
        return new Response('Internal Server Error', { status: 500 });
      }
    }
  },

  async scheduled(event: ScheduledController, env: Env, ctxObj: ExecutionContext): Promise<void> {
    ctxObj.waitUntil(runScheduledJobs(env));
  }
};

/** 记录访问统计 */
async function recordVisit(env: Env, ctx: Ctx, res: Response): Promise<void> {
  try {
    const settings = await getSettings(env);
    if (!settings.analyticsEnabled) return;
    const ua = ctx.request.headers.get('user-agent') ?? '';
    const isBot = /bot|crawler|spider|slurp|bingpreview|headlesschrome|lighthouse|curl\/|wget\//i.test(ua);
    if (isBot) return;

    // 仅统计文章详情页
    const m = /^\/posts\/([^/]+)$/.exec(ctx.url.pathname);
    let postId: number | null = null;
    if (m) {
      const post = await getPostBySlug(env, decodeURIComponent(m[1]), ctx.url.origin, false);
      postId = post?.id ?? null;
    }
    await recordView(env, {
      path: ctx.url.pathname,
      postId,
      referrer: ctx.request.headers.get('referer'),
      visitorHash: ctx.ipHash,
      userAgent: ua,
      isBot: false
    });
  } catch (e) {
    console.error('[stats] 记录访问失败', e);
  }
}

/** 合并额外响应头。setCookies 必须逐条 append，多个 Set-Cookie 不能被合并成一个字符串。 */
function mergeHeaders(res: Response, setCookies: string[], base: Record<string, string>): Response {
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(base)) headers.set(k, v);
  for (const c of setCookies) headers.append('Set-Cookie', c);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

export { escapeHtml };
/**
 * 前台服务端渲染 —— 直接产出完整可索引 HTML。
 *
 * 每个页面返回完整 body HTML，由 renderShell 包裹。
 * 交互部分通过 data-island 声明式挂载 Vue 岛，静态内容无需 JS 即可阅读。
 */
import {
  escapeHtml,
  renderMarkdown,
  formatDate,
  compactNumber,
  truncate,
  renderShell
} from '@myblog/shared';
import type {
  ArchiveGroup,
  Category,
  MenuItem,
  PostDetail,
  PostSummary,
  SiteSettings,
  Tag,
  TocItem
} from '@myblog/shared';

export interface Ctx2 {
  url: URL;
  islandScripts: string[];
}

const ICONS = {
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
  sun: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
  moon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>',
  menu: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg>',
  close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  chevronRight: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="m9 6 6 6-6 6"/></svg>',
  chevronDown: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="m6 9 6 6 6-6"/></svg>',
  arrowUp: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg>',
  arrowRight: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg>',
  link: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"/><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/></svg>',
  copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="m4 12 6 6L20 6"/></svg>',
  empty: '<svg class="empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
  github: '<svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><path d="M12 2a10 10 0 0 0-3.16 19.49c.5.09.68-.22.68-.48v-1.7c-2.78.6-3.37-1.34-3.37-1.34-.45-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.6.07-.6 1 .07 1.53 1.03 1.53 1.03.9 1.53 2.36 1.09 2.94.83.09-.65.35-1.09.63-1.34-2.22-.25-4.56-1.11-4.56-4.94 0-1.09.39-1.98 1.03-2.68-.1-.25-.45-1.27.1-2.64 0 0 .84-.27 2.75 1.02a9.5 9.5 0 0 1 5 0c1.91-1.29 2.75-1.02 2.75-1.02.55 1.37.2 2.39.1 2.64.64.7 1.03 1.59 1.03 2.68 0 3.84-2.34 4.68-4.57 4.93.36.31.68.92.68 1.85v2.74c0 .27.18.58.69.48A10 10 0 0 0 12 2z"/></svg>',
  mail: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m2 7 10 6 10-6"/></svg>',
  rss: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 11a9 9 0 0 1 9 9M4 4a16 16 0 0 1 16 16"/><circle cx="5" cy="19" r="1.5" fill="currentColor"/></svg>'
};

export function icon(name: keyof typeof ICONS): string {
  return ICONS[name];
}

/**
 * 判断菜单项是否为「站内链接」。
 *
 * 只有站内链接才走页面内路由（客户端拦截 +局部替换），因此这里必须准确：
 * - 空链接、锚点、相对路径均视为站内；
 * - http/https 且 host 与站点同源时也视为站内；
 * - 其余（http:// 其它域名、mailto:、tel: 等）一律视为站外。
 */
function isInternalHref(href: string, siteUrl: string): boolean {
  const h = (href ?? '').trim();
  if (!h) return false;
  if (h.startsWith('#') || h.startsWith('/')) return true;
  // 带协议前缀但不是 http/https（mailto:、tel:、ftp: 等）一律视为站外，
  // 不能落入「非 http 开头即站内」的分支，否则会被错误地交给客户端路由。
  if (/^[a-z][a-z0-9+.-]*:/i.test(h)) {
    if (!/^https?:\/\//i.test(h)) return false;
    try {
      return new URL(h).host === new URL(siteUrl).host;
    } catch {
      return false;
    }
  }
  // 无协议的相对路径一律视为站内
  return true;
}

/**
 * 渲染单个导航链接。
 *
 * 站内链接：不做target 限制，交由客户端路由做页面内跳转。
 * 站外链接：仅当显式开启「新窗口」时才加 target="_blank"，
 * 避免出现「点了本页栏目却开出新标签页」的割裂体验。
 */
function navLink(m: MenuItem, currentPath: string, siteUrl: string): string {
  const active = currentPath === m.href || (m.href !== '/' && currentPath.startsWith(m.href));
  const internal = isInternalHref(m.href, siteUrl);
  const target = !internal && m.openInNew ? ' target="_blank" rel="noopener noreferrer"' : '';
  const route = internal && !m.href.startsWith('#') ? ' data-route-link' : '';
  const current = active ? ' aria-current="page"' : '';
  return `<a href="${escapeHtml(m.href)}"${target}${route}${current}>${escapeHtml(m.label)}</a>`;
}

/** 页头（导航 + 主题切换 + 搜索 + 移动端抽屉） */
export function renderHeader(
  settings: SiteSettings,
  menus: MenuItem[],
  currentPath: string
): string {
  const links = menus.length
    ? menus
    : [
        { id: 0, label: '首页', href: '/', location: 'header' as const, sortOrder: 0, isVisible: true, isExternal: false, openInNew: false }
      ];

  const siteUrl = settings.siteUrl ?? '';
  const navItems = links.map((m) => navLink(m, currentPath, siteUrl)).join('');

  const drawerItems = links.map((m) => navLink(m, currentPath, siteUrl)).join('');

  const logo = settings.logoUrl
    ? `<img src="${escapeHtml(settings.logoUrl)}" alt="${escapeHtml(settings.siteName)}">`
    : '';

  return `<header class="site-header">
  <div class="container site-header-inner">
    <a class="site-logo" href="/">${logo}<span>${escapeHtml(settings.siteName)}</span></a>
    <nav class="site-nav" aria-label="主导航">${navItems}</nav>
    <div class="header-actions">
      <a class="icon-btn" href="/search" aria-label="搜索">${icon('search')}</a>
      <button class="icon-btn" type="button" data-theme-toggle aria-label="切换主题">
        <span data-theme-icon-light>${icon('sun')}</span>
        <span data-theme-icon-dark style="display:none">${icon('moon')}</span>
      </button>
      <button class="icon-btn nav-toggle" type="button" data-drawer-toggle aria-label="打开菜单" aria-expanded="false">${icon('menu')}</button>
    </div>
  </div>
  <div class="mobile-drawer" data-drawer data-open="false">${drawerItems}</div>
</header>`;
}

/** 页脚 */
export function renderFooter(settings: SiteSettings, menus: MenuItem[], socials: MenuItem[]): string {
  const year = new Date().getUTCFullYear();
  const footerLinks = menus
    .map((m) => navLink(m, '', settings.siteUrl ?? ''))
    .join('');

  const socialHtml = socials.length
    ? `<div class="social-links">${socials
        .map((m) => {
          const isGithub = /github\.com/i.test(m.href);
          const iconHtml = isGithub ? ICONS.github : ICONS.link;
          return `<a href="${escapeHtml(m.href)}" target="_blank" rel="noopener noreferrer" aria-label="${escapeHtml(m.label)}" title="${escapeHtml(m.label)}">${iconHtml}</a>`;
        })
        .join('')}</div>`
    : '';

  const icp = settings.icpBeian
    ? `<a href="https://beian.miit.gov.cn/" target="_blank" rel="noopener noreferrer nofollow">${escapeHtml(settings.icpBeian)}</a>`
    : '';

  return `<footer class="site-footer">
  <div class="container site-footer-inner">
    <div class="footer-brand">${escapeHtml(settings.siteName)}</div>
    ${settings.siteDescription ? `<p class="footer-desc">${escapeHtml(settings.siteDescription)}</p>` : ''}
    ${footerLinks ? `<nav class="footer-links" aria-label="页脚导航">${footerLinks}</nav>` : ''}
    ${socialHtml}
    <div class="footer-meta">
      <span>${escapeHtml(settings.footerText || `© ${year} ${settings.siteName}`)}</span>
      ${icp}
      <a href="/api/v1/feed">RSS</a>
      <a href="/admin">管理后台</a>
    </div>
  </div>
</footer>`;
}

function metaLine(p: PostSummary, opts: { withTags?: boolean } = {}): string {
  const parts: string[] = [
    `<time datetime="${escapeHtml(p.publishedAt ?? '')}">${escapeHtml(formatDate(p.publishedAt))}</time>`,
    `<span>${p.readingTime} 分钟阅读</span>`
  ];
  if (p.categoryName) {
    parts.push(
      `<a class="tag" href="/categories/${escapeHtml(p.categorySlug ?? '')}">${escapeHtml(p.categoryName)}</a>`
    );
  }
  if (opts.withTags) {
    for (const t of p.tags) {
      parts.push(`<a class="tag tag-outline" href="/tags/${escapeHtml(t.slug)}">#${escapeHtml(t.name)}</a>`);
    }
  }
  return parts.join('<span class="meta-dot"></span>');
}

/** 文章列表项（文字型为主，有封面才显示缩略图） */
export function renderPostItem(p: PostSummary, opts: { withTags?: boolean } = {}): string {
  return `<article class="post-item">
    <div class="post-item-main">
      <h2 class="post-item-title"><a href="/posts/${escapeHtml(p.slug)}">${escapeHtml(p.title)}</a></h2>
      ${p.excerpt ? `<p class="post-item-excerpt">${escapeHtml(p.excerpt)}</p>` : ''}
      <div class="post-item-meta">${metaLine(p, opts)}</div>
    </div>
    ${
      p.coverUrl
        ? `<a href="/posts/${escapeHtml(p.slug)}" class="post-item-thumb-link"><img class="post-item-thumb" src="${escapeHtml(p.coverUrl)}" alt="${escapeHtml(p.coverAlt || p.title)}" loading="lazy" decoding="async"></a>`
        : ''
    }
  </article>`;
}

export function renderPagination(page: number, totalPages: number, baseUrl: string): string {
  if (totalPages <= 1) return '';
  const pages: number[] = [];
  const push = (n: number) => {
    if (n >= 1 && n <= totalPages && !pages.includes(n)) pages.push(n);
  };
  push(1);
  for (let i = page - 2; i <= page + 2; i++) push(i);
  push(totalPages);
  pages.sort((a, b) => a - b);

  const link = (n: number) => {
    const sep = baseUrl.includes('?') ? '&' : '?';
    return `${baseUrl}${sep}page=${n}`;
  };

  let html = `<nav class="pagination" aria-label="分页导航">`;
  html += page > 1
    ? `<a class="page-btn" href="${escapeHtml(link(page - 1))}" rel="prev" aria-label="上一页">${icon('chevronRight')}</a>`
    : `<button class="page-btn" disabled aria-label="上一页">${icon('chevronRight')}</button>`;
  html = html.replace(
    /(<a class="page-btn" href="[^"]+" rel="prev"[^>]*>|<button class="page-btn" disabled[^>]*>)(<svg[^>]*>)/,
    (m, head, svg) => head + svg.replace('<svg', '<svg style="transform:rotate(180deg)"')
  );

  let last = 0;
  for (const n of pages) {
    if (n - last > 1) html += `<span class="page-ellipsis">…</span>`;
    html +=
      n === page
        ? `<span class="page-btn" aria-current="page">${n}</span>`
        : `<a class="page-btn" href="${escapeHtml(link(n))}">${n}</a>`;
    last = n;
  }
  html += page < totalPages
    ? `<a class="page-btn" href="${escapeHtml(link(page + 1))}" rel="next" aria-label="下一页">${icon('chevronRight')}</a>`
    : `<button class="page-btn" disabled aria-label="下一页">${icon('chevronRight')}</button>`;
  html += `</nav>`;
  return html;
}

export function renderEmpty(title: string, desc: string, action?: { href: string; label: string }): string {
  return `<div class="empty">
    ${icon('empty')}
    <p class="empty-title">${escapeHtml(title)}</p>
    <p class="empty-desc">${escapeHtml(desc)}</p>
    ${action ? `<a class="btn btn-ghost" href="${escapeHtml(action.href)}">${escapeHtml(action.label)}</a>` : ''}
  </div>`;
}

/** 目录 HTML */
export function renderToc(toc: TocItem[]): string {
  if (!toc.length) return '';
  const items = toc
    .map((t) => `<li><a href="#${escapeHtml(t.id)}" class="toc-l${t.level}" data-toc-link="${escapeHtml(t.id)}">${escapeHtml(t.text)}</a></li>`)
    .join('');
  return `<aside class="toc" data-toc>
  <button class="toc-toggle" type="button" data-toc-toggle aria-expanded="false">
    <span>文章目录</span>${icon('chevronDown')}
  </button>
  <div class="toc-body" data-toc-body>
    <p class="toc-title" style="display:none">目录</p>
    <ul>${items}</ul>
  </div>
</aside>`;
}

export interface PageMeta {
  title: string;
  description: string;
  canonical: string;
  noindex?: boolean;
  ogType?: string;
  ogImage?: string | null;
  jsonLd?: Record<string, unknown> | null;
}

export function buildPage(
  ctx: Ctx2,
  settings: SiteSettings,
  menus: MenuItem[],
  socials: MenuItem[],
  meta: PageMeta,
  content: string,
  bodyClass?: string
): string {
  return renderShell({
    title: meta.title,
    description: meta.description,
    canonical: meta.canonical,
    settings,
    body: `${renderHeader(settings, menus, ctx.url.pathname)}
<main id="main">${content}</main>
${renderFooter(settings, menus, socials)}
<div class="floating-tools">
  <button class="float-btn" type="button" data-copy-link aria-label="复制文章链接">${icon('link')}</button>
  <button class="float-btn" type="button" data-to-top aria-label="回到顶部">${icon('arrowUp')}</button>
</div>`,
    islandScripts: ctx.islandScripts,
    ogType: meta.ogType,
    ogImage: meta.ogImage,
    noindex: meta.noindex,
    jsonLd: meta.jsonLd ?? null,
    bodyClass
  });
}

export { escapeHtml, truncate, compactNumber, renderMarkdown, formatDate };

// ============ 各页面 body ============

export function homeContent(data: {
  settings: SiteSettings;
  featured: PostSummary[];
  latest: PostSummary[];
  categories: Category[];
  totalPosts: number;
  socials: MenuItem[];
}): string {
  const s = data.settings;
  const avatar = s.heroAvatarUrl
    ? `<img class="hero-avatar" src="${escapeHtml(s.heroAvatarUrl)}" alt="${escapeHtml(s.heroTitle)}">`
    : '';

  const hero = `<section class="hero">
  <div class="container hero-inner">
    ${avatar}
    <div class="hero-main">
      ${s.heroSubtitle ? `<p class="hero-eyebrow">${escapeHtml(s.heroSubtitle)}</p>` : ''}
      <h1 class="hero-title">${escapeHtml(s.heroTitle || s.siteName)}</h1>
      ${s.heroDescription ? `<p class="hero-desc">${escapeHtml(s.heroDescription)}</p>` : ''}
      <div class="hero-actions">
        <a class="btn btn-primary" href="/posts">浏览文章</a>
        <a class="btn btn-ghost" href="/about">关于我</a>
      </div>
      <div class="hero-stats">
        <div><div class="hero-stat-num">${data.totalPosts}</div><div class="hero-stat-label">篇文章</div></div>
        <div><div class="hero-stat-num">${data.categories.length}</div><div class="hero-stat-label">个分类</div></div>
        <div><div class="hero-stat-num">${data.featured.length}</div><div class="hero-stat-label">篇精选</div></div>
      </div>
    </div>
  </div>
</section>`;

  const featuredSection = data.featured.length
    ? `<section class="section">
  <div class="container">
    <div class="section-head"><h2 class="section-title">精选文章</h2><a class="section-more" href="/posts">全部文章 ${icon('chevronRight')}</a></div>
    <div class="featured-grid">
      ${data.featured
        .map(
          (p) => `<a class="featured-card" href="/posts/${escapeHtml(p.slug)}">
        ${p.coverUrl ? `<img class="featured-card-cover" src="${escapeHtml(p.coverUrl)}" alt="${escapeHtml(p.coverAlt || p.title)}" loading="lazy">` : ''}
        <div class="featured-card-body">
          <h3 class="featured-card-title">${escapeHtml(p.title)}</h3>
          ${p.excerpt ? `<p class="post-item-excerpt">${escapeHtml(p.excerpt)}</p>` : ''}
          <div class="post-item-meta">${metaLine(p)}</div>
        </div>
      </a>`
        )
        .join('')}
    </div>
  </div>
</section>`
    : '';

  const latestSection = `<section class="section" style="padding-top:0">
  <div class="container">
    <div class="section-head"><h2 class="section-title">最新文章</h2><a class="section-more" href="/archives">按时间浏览 ${icon('chevronRight')}</a></div>
    ${
      data.latest.length
        ? `<div class="post-list">${data.latest.map((p) => renderPostItem(p, { withTags: true })).join('')}</div>
           <div class="center mt-12"><a class="btn btn-ghost" href="/posts">查看全部文章</a></div>`
        : renderEmpty('还没有发布文章', '去后台写下第一篇文章吧', { href: '/admin/posts/new', label: '开始写作' })
    }
  </div>
</section>`;

  const catSection = data.categories.length
    ? `<section class="section" style="padding-top:0">
  <div class="container">
    <div class="section-head"><h2 class="section-title">分类</h2><a class="section-more" href="/categories">全部分类 ${icon('chevronRight')}</a></div>
    <div class="category-grid">
      ${data.categories
        .slice(0, 8)
        .map(
          (c) => `<a class="category-card" href="/categories/${escapeHtml(c.slug)}">
        <h3 class="category-card-name">${escapeHtml(c.name)}</h3>
        ${c.description ? `<p class="category-card-desc">${escapeHtml(c.description)}</p>` : ''}
        <span class="cloud-count">${c.postCount} 篇</span>
      </a>`
        )
        .join('')}
    </div>
  </div>
</section>`
    : '';

  return `${hero}${featuredSection}${latestSection}${catSection}`;
}

export function postListContent(data: {
  items: PostSummary[];
  page: number;
  totalPages: number;
  baseUrl: string;
  heading: string;
  desc?: string;
  eyebrow?: string;
}): string {
  return `<div class="page-head">
  <div class="container">
    ${data.eyebrow ? `<p class="hero-eyebrow">${escapeHtml(data.eyebrow)}</p>` : ''}
    <h1 class="page-title">${escapeHtml(data.heading)}</h1>
    ${data.desc ? `<p class="page-desc">${escapeHtml(data.desc)}</p>` : ''}
  </div>
</div>
<div class="container" style="padding-bottom:var(--space-16)">
  ${
    data.items.length
      ? `<div class="post-list">${data.items.map((p) => renderPostItem(p, { withTags: true })).join('')}</div>
         ${renderPagination(data.page, data.totalPages, data.baseUrl)}`
      : renderEmpty('暂无内容', '换个关键词或分类试试', { href: '/posts', label: '返回文章列表' })
  }
</div>`;
}

export function articleContent(detail: PostDetail, settings: SiteSettings): string {
  const p = detail;
  const tocHtml = renderToc(p.toc);

  const metaParts = [
    p.authorName ? `<span>${escapeHtml(p.authorName)}</span>` : '',
    p.publishedAt
      ? `<time datetime="${escapeHtml(p.publishedAt)}">${escapeHtml(formatDate(p.publishedAt))}</time>`
      : '',
    `<span>${p.readingTime} 分钟阅读</span>`,
    p.wordCount ? `<span>${p.wordCount} 字</span>` : ''
  ].filter(Boolean);

  const catTags = [
    ...p.categories.map(
      (c) => `<a class="tag tag-accent" href="/categories/${escapeHtml(c.slug)}">${escapeHtml(c.name)}</a>`
    ),
    ...p.tags.map((t) => `<a class="tag tag-outline" href="/tags/${escapeHtml(t.slug)}">#${escapeHtml(t.name)}</a>`)
  ].join('');

  const updatedNote =
    p.updatedAt && p.publishedAt && p.updatedAt !== p.publishedAt
      ? `<span title="最后更新于 ${escapeHtml(formatDate(p.updatedAt, true))}">更新于 ${escapeHtml(formatDate(p.updatedAt))}</span>`
      : '';

  const related = p.related.length
    ? `<section class="mt-16">
    <div class="section-head"><h2 class="section-title">相关文章</h2></div>
    <div class="related-list">
      ${p.related.map((r) => `<div class="related-item"><a href="/posts/${escapeHtml(r.slug)}">${escapeHtml(r.title)}</a></div>`).join('')}
    </div>
  </section>`
    : '';

  const nav =
    p.prev || p.next
      ? `<nav class="article-nav" aria-label="文章导航">
    ${
      p.prev
        ? `<a class="prev" href="/posts/${escapeHtml(p.prev.slug)}"><div class="article-nav-label">上一篇</div><div class="article-nav-title">${escapeHtml(p.prev.title)}</div></a>`
        : '<span></span>'
    }
    ${
      p.next
        ? `<a class="next" href="/posts/${escapeHtml(p.next.slug)}"><div class="article-nav-label">下一篇</div><div class="article-nav-title">${escapeHtml(p.next.title)}</div></a>`
        : '<span></span>'
    }
  </nav>`
      : '';

  const commentIsland = settings.commentEnabled
    ? `<section class="comments" data-comments data-post-id="${p.id}">
    <div class="section-head"><h2 class="section-title">评论</h2><span class="text-xs muted" data-comment-count></span></div>
    <form class="comment-form" data-comment-form>
      <div class="form-row">
        <input class="input" style="flex:1;min-width:180px" name="authorName" placeholder="昵称 *" maxlength="40" required>
        <input class="input" style="flex:1;min-width:180px" name="authorEmail" type="email" placeholder="邮箱（选填，不会公开）" maxlength="100">
        <input class="input" style="flex:1;min-width:180px" name="authorWebsite" type="url" placeholder="网站（选填）" maxlength="200">
      </div>
      <textarea class="textarea" name="content" placeholder="友善的评论是交流的起点…" maxlength="2000" required></textarea>
      <div class="flex items-center justify-between">
        <span class="comment-form-note" data-comment-note>支持 Markdown 语法</span>
        <button class="btn btn-primary" type="submit">发表评论</button>
      </div>
    </form>
    <div class="comment-list" data-comment-list></div>
  </section>`
    : '';

  return `<div class="read-progress" data-read-progress></div>
<article class="article">
  <div class="container">
    <header class="article-head">
      <h1 class="article-title">${escapeHtml(p.title)}</h1>
      ${p.excerpt ? `<p class="article-excerpt">${escapeHtml(p.excerpt)}</p>` : ''}
      <div class="article-meta">
        ${metaParts.join('<span class="meta-dot"></span>')}
        ${updatedNote ? `<span class="meta-dot"></span>${updatedNote}` : ''}
      </div>
    </header>
    ${p.coverUrl ? `<img class="article-cover" src="${escapeHtml(p.coverUrl)}" alt="${escapeHtml(p.coverAlt || p.title)}" fetchpriority="high">` : ''}
    <div class="article-layout${tocHtml ? ' has-toc' : ''}">
      <div class="article-body" data-article-body>${p.html}</div>
      ${tocHtml}
    </div>
    <footer class="article-footer">
      ${catTags ? `<div class="article-tags">${catTags}</div>` : ''}
      <div class="article-share">
        <button class="share-btn" type="button" data-copy-link>${icon('copy')}<span>复制链接</span></button>
        <a class="share-btn" href="https://twitter.com/intent/tweet?url=${encodeURIComponent(settings.siteUrl)}&text=${encodeURIComponent(p.title)}" target="_blank" rel="noopener noreferrer">分享到 X</a>
      </div>
      ${nav}
      ${related}
      ${commentIsland}
    </footer>
  </div>
</article>
<div class="lightbox" data-lightbox data-open="false">
  <button class="lightbox-close" type="button" data-lightbox-close aria-label="关闭">${icon('close')}</button>
  <button class="lightbox-nav lightbox-prev" type="button" data-lightbox-prev aria-label="上一张">${icon('chevronRight')}</button>
  <div>
    <img data-lightbox-img src="" alt="">
    <p class="lightbox-caption" data-lightbox-caption></p>
  </div>
  <button class="lightbox-nav lightbox-next" type="button" data-lightbox-next aria-label="下一张">${icon('chevronRight')}</button>
</div>`;
}

export function archivesContent(groups: ArchiveGroup[]): string {
  const total = groups.reduce((a, g) => a + g.count, 0);
  if (!groups.length) {
    return `<div class="page-head"><div class="container"><h1 class="page-title">归档</h1></div></div>
    <div class="container" style="padding-bottom:var(--space-16)">${renderEmpty('还没有文章', '发布文章后这里会按年月归档')}</div>`;
  }
  const years = [...new Set(groups.map((g) => g.year))];
  return `<div class="page-head">
  <div class="container">
    <h1 class="page-title">归档</h1>
    <p class="page-desc">共 ${total} 篇文章，跨越 ${years.length} 个年份、${years.length ? (years[years.length - 1] - years[0] + 1) : 0} 年。</p>
  </div>
</div>
<div class="container" style="padding-bottom:var(--space-16)">
  ${groups
    .map((g) => {
      const key = `${g.year}-${String(g.month).padStart(2, '0')}`;
      const posts = g.posts
        .map((p) => {
          const day = p.publishedAt ? formatDate(p.publishedAt).slice(8) : '';
          return `<div class="archive-post"><span class="archive-post-day">${escapeHtml(day)}</span><a href="/posts/${escapeHtml(p.slug)}">${escapeHtml(p.title)}</a></div>`;
        })
        .join('');
      return `<section class="archive-year" id="${key}">
    <h2 class="archive-year-title">${g.year}</h2>
    <div class="archive-month">
      <div class="archive-month-label">${g.month} 月 · ${g.count} 篇</div>
      <div class="archive-month-posts">${posts}</div>
    </div>
  </section>`;
    })
    .join('')}
</div>`;
}

export function categoriesContent(categories: Category[]): string {
  if (!categories.length) {
    return `<div class="page-head"><div class="container"><h1 class="page-title">分类</h1></div></div>
    <div class="container" style="padding-bottom:var(--space-16)">${renderEmpty('还没有分类', '在文章编辑页可以给文章添加分类')}</div>`;
  }
  return `<div class="page-head"><div class="container">
    <h1 class="page-title">分类</h1>
    <p class="page-desc">共 ${categories.length} 个分类，共 ${categories.reduce((a, c) => a + (c.postCount ?? 0), 0)} 篇文章。</p>
  </div></div>
<div class="container" style="padding-bottom:var(--space-16)">
  <div class="category-grid">
    ${categories
      .map(
        (c) => `<a class="category-card" href="/categories/${escapeHtml(c.slug)}">
      <h2 class="category-card-name">${escapeHtml(c.name)}</h2>
      ${c.description ? `<p class="category-card-desc">${escapeHtml(c.description)}</p>` : ''}
      <span class="cloud-count">${c.postCount} 篇文章</span>
    </a>`
      )
      .join('')}
  </div>
</div>`;
}

export function tagsContent(tags: Tag[]): string {
  if (!tags.length) {
    return `<div class="page-head"><div class="container"><h1 class="page-title">标签</h1></div></div>
    <div class="container" style="padding-bottom:var(--space-16)">${renderEmpty('还没有标签', '在文章编辑页可以给文章添加标签')}</div>`;
  }
  return `<div class="page-head"><div class="container">
    <h1 class="page-title">标签</h1>
    <p class="page-desc">共 ${tags.length} 个标签。</p>
  </div></div>
<div class="container" style="padding-bottom:var(--space-16)">
  <div class="cloud">
    ${tags
      .map(
        (t) => `<a class="cloud-item" href="/tags/${escapeHtml(t.slug)}">#${escapeHtml(t.name)}<span class="cloud-count">${t.postCount}</span></a>`
      )
      .join('')}
  </div>
</div>`;
}

export function simplePageContent(heading: string, html: string, desc?: string): string {
  return `<div class="page-head"><div class="container">
    <h1 class="page-title">${escapeHtml(heading)}</h1>
    ${desc ? `<p class="page-desc">${escapeHtml(desc)}</p>` : ''}
  </div></div>
<div class="container content-width" style="padding-bottom:var(--space-16)">
  <div class="article-body">${html}</div>
</div>`;
}

export function searchContent(keyword: string, items: PostSummary[], baseUrl: string): string {
  const highlight = (text: string) => {
    if (!keyword) return escapeHtml(text);
    const safe = escapeHtml(text);
    const kw = escapeHtml(keyword).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return safe.replace(new RegExp(kw, 'gi'), (m) => `<mark>${m}</mark>`);
  };

  const results = items.length
    ? `<div class="post-list mt-12">
      ${items
        .map(
          (p) => `<article class="post-item">
        <div class="post-item-main">
          <h2 class="post-item-title"><a href="/posts/${escapeHtml(p.slug)}">${highlight(p.title)}</a></h2>
          ${p.excerpt ? `<p class="post-item-excerpt">${highlight(p.excerpt)}</p>` : ''}
          <div class="post-item-meta">${metaLine(p)}</div>
        </div>
      </article>`
        )
        .join('')}
    </div>`
    : renderEmpty('没有找到相关内容', keyword ? `换个关键词试试，比如更短的词` : '输入关键词开始搜索');

  return `<div class="page-head" style="border-bottom:none;padding-bottom:var(--space-8)">
  <div class="container">
    <div class="search-box">
      <span class="search-icon">${icon('search')}</span>
      <input class="search-input" type="search" data-search-input value="${escapeHtml(keyword)}" placeholder="搜索文章标题、内容…" autocomplete="off" aria-label="搜索">
      <button class="search-clear" type="button" data-search-clear aria-label="清空" style="${keyword ? '' : 'display:none'}">${icon('close')}</button>
    </div>
    ${keyword ? `<p class="center text-sm muted mt-4">找到 ${items.length} 条与「${escapeHtml(keyword)}」相关的结果</p>` : ''}
  </div>
</div>
<div class="container" style="padding-bottom:var(--space-16)">
  ${results}
</div>`;
}

export function linksContent(links: { id: number; name: string; url: string; avatarUrl: string | null; description: string | null }[]): string {
  if (!links.length) {
    return `<div class="page-head"><div class="container"><h1 class="page-title">友情链接</h1></div></div>
    <div class="container" style="padding-bottom:var(--space-16)">${renderEmpty('还没有友链', '在后台「互动管理 → 友情链接」中添加')}</div>`;
  }
  return `<div class="page-head"><div class="container">
    <h1 class="page-title">友情链接</h1>
    <p class="page-desc">与这些优秀的创作者互相学习、共同进步。</p>
  </div></div>
<div class="container" style="padding-bottom:var(--space-16)">
  <div class="category-grid">
    ${links
      .map(
        (l) => `<a class="category-card flex items-center gap-3" href="${escapeHtml(l.url)}" target="_blank" rel="noopener noreferrer">
      ${l.avatarUrl ? `<img src="${escapeHtml(l.avatarUrl)}" alt="" style="width:40px;height:40px;border-radius:var(--radius);object-fit:cover" loading="lazy">` : ''}
      <div style="min-width:0">
        <h2 class="category-card-name" style="font-size:15px;margin:0">${escapeHtml(l.name)}</h2>
        ${l.description ? `<p class="text-xs muted" style="margin:2px 0 0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(l.description)}</p>` : ''}
      </div>
    </a>`
      )
      .join('')}
  </div>
</div>`;
}

export function notFoundContent(path: string): string {
  return `<div class="error-page">
  <div class="container">
    <div class="error-code">404</div>
    <h1 class="error-title">页面不存在</h1>
    <p class="error-desc">你访问的地址 <code>${escapeHtml(path)}</code> 可能已被移动、重命名或删除。</p>
    <div class="hero-actions" style="justify-content:center">
      <a class="btn btn-primary" href="/">返回首页</a>
      <a class="btn btn-ghost" href="/search">搜索文章</a>
    </div>
  </div>
</div>`;
}

export function serverErrorContent(): string {
  return `<div class="error-page">
  <div class="container">
    <div class="error-code">500</div>
    <h1 class="error-title">服务器开小差了</h1>
    <p class="error-desc">服务出现异常，请稍后重试。如果持续出现，请检查 Cloudflare Worker 日志。</p>
    <div class="hero-actions" style="justify-content:center">
      <a class="btn btn-primary" href="/">返回首页</a>
    </div>
  </div>
</div>`;
}
/** RSS / Sitemap / robots.txt —— SEO 输出 */
import type { Ctx } from '../lib/context';
import { archives, listCategories, listPosts, listTags } from '../repositories/db';
import { getSettings } from '../services/settings';
import { escapeHtml } from '@myblog/shared';

function siteUrl(ctx: Ctx, configured: string): string {
  return (configured || ctx.url.origin).replace(/\/$/, '');
}

function isoDate(v: string | null): string {
  if (!v) return new Date().toISOString();
  return v.includes('T') ? v : v.replace(' ', 'T') + 'Z';
}

export async function handleFeed(ctx: Ctx): Promise<Response> {
  const settings = await getSettings(ctx.env);
  const base = siteUrl(ctx, settings.siteUrl);
  const { items } = await listPosts(ctx.env, { type: 'post', status: 'published', page: 1, pageSize: 30 }, ctx.url.origin);

  const itemsXml = items
    .map((p) => {
      const link = `${base}/posts/${encodeURIComponent(p.slug)}`;
      return `    <item>
      <title>${escapeHtml(p.title)}</title>
      <link>${escapeHtml(link)}</link>
      <guid isPermaLink="true">${escapeHtml(link)}</guid>
      <pubDate>${new Date(isoDate(p.publishedAt)).toUTCString()}</pubDate>
      ${p.authorName ? `<dc:creator>${escapeHtml(p.authorName)}</dc:creator>` : ''}
      <description>${escapeHtml(p.excerpt ?? '')}</description>
      ${p.tags.map((t) => `<category>${escapeHtml(t.name)}</category>`).join('\n      ')}
    </item>`;
    })
    .join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel>
    <title>${escapeHtml(settings.siteName)}</title>
    <link>${escapeHtml(base)}</link>
    <description>${escapeHtml(settings.siteDescription)}</description>
    <language>zh-CN</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
    <atom:link href="${escapeHtml(base)}/api/v1/feed" rel="self" type="application/rss+xml"/>
${itemsXml}
  </channel>
</rss>`;

  return new Response(xml, {
    headers: {
      'Content-Type': 'application/rss+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=600'
    }
  });
}

export async function handleSitemap(ctx: Ctx): Promise<Response> {
  const settings = await getSettings(ctx.env);
  const base = siteUrl(ctx, settings.siteUrl);
  const baseUrl = ctx.url.origin;

  const [posts, cats, tags, groups] = await Promise.all([
    listPosts(ctx.env, { type: 'post', status: 'published', page: 1, pageSize: 1000 }, baseUrl),
    listCategories(ctx.env, { withCount: true }),
    listTags(ctx.env, true),
    archives(ctx.env, baseUrl)
  ]);

  // 归档页按年月生成 anchor URL
  const archiveUrls = groups.map((g) => ({
    loc: `${base}/archives#${g.year}-${String(g.month).padStart(2, '0')}`,
    lastmod: g.posts[0]?.publishedAt ?? null
  }));

  const urls: string[] = [
    `  <url><loc>${escapeHtml(base)}/</loc><changefreq>daily</changefreq><priority>1.0</priority></url>`,
    `  <url><loc>${escapeHtml(base)}/posts</loc><changefreq>daily</changefreq><priority>0.9</priority></url>`,
    `  <url><loc>${escapeHtml(base)}/archives</loc><changefreq>weekly</changefreq><priority>0.7</priority></url>`,
    `  <url><loc>${escapeHtml(base)}/categories</loc><changefreq>weekly</changefreq><priority>0.6</priority></url>`,
    `  <url><loc>${escapeHtml(base)}/tags</loc><changefreq>weekly</changefreq><priority>0.6</priority></url>`,
    `  <url><loc>${escapeHtml(base)}/about</loc><changefreq>monthly</changefreq><priority>0.5</priority></url>`,
    `  <url><loc>${escapeHtml(base)}/links</loc><changefreq>monthly</changefreq><priority>0.4</priority></url>`
  ];

  for (const p of posts.items) {
    urls.push(
      `  <url><loc>${escapeHtml(`${base}/posts/${p.slug}`)}</loc>` +
        `<lastmod>${escapeHtml(isoDate(p.updatedAt))}</lastmod>` +
        `<changefreq>monthly</changefreq><priority>0.8</priority></url>`
    );
  }
  for (const c of cats) {
    if ((c.postCount ?? 0) > 0) {
      urls.push(
        `  <url><loc>${escapeHtml(`${base}/categories/${c.slug}`)}</loc><changefreq>weekly</changefreq><priority>0.6</priority></url>`
      );
    }
  }
  for (const t of tags) {
    if ((t.postCount ?? 0) > 0) {
      urls.push(
        `  <url><loc>${escapeHtml(`${base}/tags/${t.slug}`)}</loc><changefreq>weekly</changefreq><priority>0.5</priority></url>`
      );
    }
  }
  for (const a of archiveUrls) {
    urls.push(`  <url><loc>${escapeHtml(a.loc)}</loc><changefreq>monthly</changefreq><priority>0.5</priority></url>`);
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join('\n')}
</urlset>`;

  return new Response(xml, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600'
    }
  });
}

export async function handleRobots(ctx: Ctx): Promise<Response> {
  const settings = await getSettings(ctx.env);
  const base = siteUrl(ctx, settings.siteUrl);
  const lines = ['User-agent: *'];
  if (settings.robotsIndex) {
    lines.push('Allow: /', 'Disallow: /admin', 'Disallow: /api/v1/admin', 'Disallow: /preview');
  } else {
    lines.push('Disallow: /');
  }
  lines.push('', `Sitemap: ${base}/api/v1/sitemap.xml`);
  return new Response(lines.join('\n'), {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' }
  });
}
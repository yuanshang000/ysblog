/**
 * 前台 HTML 外壳 —— Worker 服务端渲染直接产出完整可索引 HTML。
 *
 * 关键点：
 * 1. 所有样式内联（单一 CSS 文件由 Vite 产出并被内联），无外部 CSS 请求，首屏无 FOUC；
 * 2. 主题在 <head> 内联脚本中确定，避免深色模式闪烁；
 * 3. 内容为服务端渲染的真实 HTML，搜索引擎与禁用 JS 的场景均可读。
 */
import { htmlEscape as escapeHtml } from './utils';
import type { SiteSettings } from './types';

export interface ShellOptions {
  title: string;
  description: string;
  canonical: string;
  settings: SiteSettings;
  /** 页面主体 HTML（已服务端渲染） */
  body: string;
  /** 岛脚本（打包后由 Worker 注入） */
  islandScripts?: string[];
  ogType?: string;
  ogImage?: string | null;
  noindex?: boolean;
  publishedTime?: string | null;
  updatedTime?: string | null;
  tags?: string[];
  bodyClass?: string;
  jsonLd?: Record<string, unknown> | null;
}

function themeScript(settings: SiteSettings): string {
  const def = settings.defaultTheme;
  return `(function(){try{
var d=${JSON.stringify(def)};
var s=localStorage.getItem('mb-theme');
var m=window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';
var t=(s==='light'||s==='dark')?s:(d==='system'?m:d);
document.documentElement.dataset.theme=t;
document.documentElement.style.colorScheme=t;
}catch(e){document.documentElement.dataset.theme='light';}})();`;
}

function accentVar(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return '#b5813a';
  const n = parseInt(m[1], 16);
  return `#${n.toString(16).padStart(6, '0')}`;
}

export function renderShell(opts: ShellOptions): string {
  const s = opts.settings;
  const accent = accentVar(s.accentColor);
  const icon = s.faviconUrl
    ? `<link rel="icon" href="${escapeHtml(s.faviconUrl)}">`
    : `<link rel="icon" href="data:image/svg+xml,${encodeURIComponent(
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="${accent}"/><text x="16" y="22" font-size="16" text-anchor="middle" fill="#fff" font-family="sans-serif">B</text></svg>`
      )}">`;

  const robots = opts.noindex
    ? '<meta name="robots" content="noindex,nofollow,noarchive">'
    : s.robotsIndex
      ? '<meta name="robots" content="index,follow,max-image-preview:large">'
      : '<meta name="robots" content="noindex,follow">';

  const jsonLd = opts.jsonLd
    ? `<script type="application/ld+json">${JSON.stringify(opts.jsonLd).replace(/</g, '\\u003c')}</script>`
    : '';

  const scripts = (opts.islandScripts ?? [])
    .map((src) => `<script type="module" src="${escapeHtml(src)}"></script>`)
    .join('');

  return `<!DOCTYPE html>
<html lang="zh-CN" data-theme="light">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${escapeHtml(opts.title)}</title>
<meta name="description" content="${escapeHtml(opts.description)}">
<link rel="canonical" href="${escapeHtml(opts.canonical)}">
${robots}
${icon}
<meta property="og:type" content="${escapeHtml(opts.ogType ?? 'website')}">
<meta property="og:site_name" content="${escapeHtml(s.siteName)}">
<meta property="og:title" content="${escapeHtml(opts.title)}">
<meta property="og:description" content="${escapeHtml(opts.description)}">
<meta property="og:url" content="${escapeHtml(opts.canonical)}">
${
  opts.ogImage
    ? `<meta property="og:image" content="${escapeHtml(opts.ogImage)}">`
    : s.logoUrl
      ? `<meta property="og:image" content="${escapeHtml(s.logoUrl)}">`
      : ''
}
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escapeHtml(opts.title)}">
<meta name="twitter:description" content="${escapeHtml(opts.description)}">
${opts.publishedTime ? `<meta property="article:published_time" content="${escapeHtml(opts.publishedTime)}">` : ''}
${opts.updatedTime ? `<meta property="article:modified_time" content="${escapeHtml(opts.updatedTime)}">` : ''}
${(opts.tags ?? []).map((t) => `<meta property="article:tag" content="${escapeHtml(t)}">`).join('')}
<meta name="generator" content="MyBlog">
<style>:root{--accent:${accent}}</style>
<script>${themeScript(s)}</script>
<style>${STYLES}</style>
${jsonLd}
</head>
<body class="${escapeHtml(opts.bodyClass ?? '')}">
${opts.body}
${scripts}
</body>
</html>`;
}

/** 前台设计系统 —— 全部令牌集中定义，组件不得自行硬编码颜色与间距 */
export const STYLES = String.raw`
*,*::before,*::after{box-sizing:border-box}
/* 全局兜底：内联 SVG 默认 1em，避免在 flex 容器中被压成竖条或撑破布局 */
svg{flex-shrink:0;vertical-align:middle}
html{-webkit-text-size-adjust:100%;scroll-behavior:smooth;scroll-padding-top:84px}
body{margin:0}

:root{
  --accent:#b5813a;
  --accent-soft:color-mix(in srgb,var(--accent) 10%,transparent);
  --accent-border:color-mix(in srgb,var(--accent) 28%,transparent);

  /* 日间主题：淡棕黄（奶油色系），与管理后台保持一致 */
  --bg:#f6f1e8;
  --bg-subtle:#efe8db;
  --bg-muted:#e9e1d1;
  --bg-inset:#f2ece0;
  --surface:#fffdf8;
  --surface-hover:#f4eee2;

  --text:#3b332a;
  --text-secondary:#6d6355;
  --text-tertiary:#9c9182;
  --text-inverse:#fffdf8;

  --border:#e6dccb;
  --border-strong:#d3c6ae;

  --code-bg:#f2ece0;
  --code-text:#4a4034;

  --shadow-xs:0 1px 2px rgba(59,51,42,.05);
  --shadow-sm:0 2px 8px rgba(59,51,42,.07);
  --shadow-md:0 8px 24px rgba(59,51,42,.09);
  --shadow-lg:0 16px 48px rgba(59,51,42,.12);
  --tok-str:#3f7d3f;--tok-num:#a35a12;--tok-kw:#7b4fbf;--tok-com:#8a8073;

  --radius-sm:6px;
  --radius:10px;
  --radius-md:14px;
  --radius-lg:20px;
  --radius-full:999px;

  --space-1:4px;--space-2:8px;--space-3:12px;--space-4:16px;--space-5:20px;
  --space-6:24px;--space-8:32px;--space-10:40px;--space-12:48px;--space-16:64px;
  --space-20:80px;--space-24:96px;

  --font-sans:"Inter","Noto Sans SC",-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;
  --font-serif:"Noto Serif SC","Source Han Serif SC",Georgia,"Songti SC",serif;
  --font-mono:"JetBrains Mono","SFMono-Regular",Consolas,"Liberation Mono",Menlo,monospace;

  --container:1200px;
  --content:720px;
  --header-h:60px;

  --transition:160ms cubic-bezier(.4,0,.2,1);
}

/* 夜间主题：淡灰（浅底深字）。
 * 注意：这是「淡灰」而非传统深色，因此正文用深色文字、阴影用浅色投影，
 * 不能沿用深色模式那套反白处理，否则会出现浅底配浅字的不可读问题。 */
html[data-theme="dark"]{
  --accent-soft:color-mix(in srgb,var(--accent) 14%,transparent);
  --accent-border:color-mix(in srgb,var(--accent) 34%,transparent);

  --bg:#f0f0f1;
  --bg-subtle:#e7e7e9;
  --bg-muted:#dedeE1;
  --bg-inset:#e9e9eb;
  --surface:#f8f8f9;
  --surface-hover:#e4e4e7;

  --text:#33333a;
  --text-secondary:#5f5f68;
  --text-tertiary:#8b8b95;
  --text-inverse:#f8f8f9;

  --border:#dcdce1;
  --border-strong:#c4c4cb;

  --code-bg:#e6e6ea;
  --code-text:#3a3a42;

  /* 浅底上的阴影要比日间更淡，否则会显脏 */
  --shadow-xs:0 1px 2px rgba(51,51,58,.06);
  --shadow-sm:0 2px 8px rgba(51,51,58,.08);
  --shadow-md:0 8px 24px rgba(51,51,58,.1);
  --shadow-lg:0 16px 48px rgba(51,51,58,.14);
  --tok-str:#2f7a3e;--tok-num:#9c5410;--tok-kw:#7348b8;--tok-com:#78787f;
}

body{
  font-family:var(--font-sans);
  font-size:16px;
  line-height:1.75;
  color:var(--text);
  background:var(--bg);
  -webkit-font-smoothing:antialiased;
  -moz-osx-font-smoothing:grayscale;
  font-feature-settings:"cv02","cv03","cv04";
  overflow-x:hidden;
}

::selection{background:var(--accent-soft);color:var(--text)}

a{color:inherit;text-decoration:none}
img{max-width:100%;height:auto;display:block}
button{font:inherit;color:inherit;cursor:pointer;border:none;background:none}
input,textarea,select{font:inherit;color:inherit}

:focus-visible{outline:2px solid var(--accent);outline-offset:2px;border-radius:var(--radius-sm)}

.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}

.container{width:100%;max-width:var(--container);margin:0 auto;padding:0 var(--space-6)}
.content-width{max-width:var(--content);margin:0 auto}

@media (max-width:640px){.container{padding:0 var(--space-5)}}

/* ---------- 顶栏 ---------- */
.site-header{
  position:sticky;top:0;z-index:50;
  height:var(--header-h);
  background:color-mix(in srgb,var(--bg) 88%,transparent);
  backdrop-filter:saturate(180%) blur(14px);
  -webkit-backdrop-filter:saturate(180%) blur(14px);
  border-bottom:1px solid var(--border);
}
.site-header-inner{height:100%;display:flex;align-items:center;gap:var(--space-6)}
.site-logo{display:inline-flex;align-items:center;gap:var(--space-2);font-weight:640;font-size:15.5px;letter-spacing:-.01em;white-space:nowrap}
.site-logo img{width:26px;height:26px;border-radius:var(--radius-sm)}
.site-nav{display:flex;align-items:center;gap:var(--space-1);margin-left:auto}
.site-nav a{
  padding:6px 12px;border-radius:var(--radius-sm);font-size:14.5px;color:var(--text-secondary);
  transition:color var(--transition),background var(--transition);white-space:nowrap;
}
.site-nav a:hover{color:var(--text);background:var(--surface-hover)}
.site-nav a[aria-current="page"]{color:var(--accent);background:var(--accent-soft);font-weight:560}
.header-actions{display:flex;align-items:center;gap:var(--space-1);margin-left:var(--space-2)}
.icon-btn{
  width:34px;height:34px;display:grid;place-items:center;border-radius:var(--radius-sm);
  color:var(--text-secondary);transition:background var(--transition),color var(--transition);
}
.icon-btn:hover{background:var(--surface-hover);color:var(--text)}
.icon-btn svg{width:17px;height:17px}
.nav-toggle{display:none}
.mobile-drawer{display:none}

@media (max-width:900px){
  .site-nav{display:none}
  .nav-toggle{display:grid;margin-left:auto}
  .mobile-drawer{
    display:block;position:fixed;inset:var(--header-h) 0 auto 0;z-index:49;
    background:var(--surface);border-bottom:1px solid var(--border);
    padding:var(--space-3) var(--space-5) var(--space-5);
    box-shadow:var(--shadow-md);
    transform:translateY(-8px);opacity:0;pointer-events:none;transition:all var(--transition);
  }
  .mobile-drawer[data-open="true"]{transform:translateY(0);opacity:1;pointer-events:auto}
  .mobile-drawer a{display:block;padding:11px 12px;border-radius:var(--radius);color:var(--text-secondary);font-size:15px}
  .mobile-drawer a[aria-current="page"]{color:var(--accent);background:var(--accent-soft)}
}

/* ---------- 页脚 ---------- */
.site-footer{margin-top:var(--space-24);border-top:1px solid var(--border);background:var(--bg-subtle)}
.site-footer-inner{padding:var(--space-12) 0 var(--space-10);display:flex;flex-direction:column;gap:var(--space-6);align-items:center;text-align:center}
.footer-brand{font-weight:640;font-size:15px}
.footer-desc{color:var(--text-tertiary);font-size:13.5px;max-width:420px}
.footer-links{display:flex;flex-wrap:wrap;justify-content:center;gap:var(--space-5);font-size:14px;color:var(--text-secondary)}
.footer-links a:hover{color:var(--accent)}
.footer-meta{font-size:12.5px;color:var(--text-tertiary);display:flex;flex-wrap:wrap;justify-content:center;gap:var(--space-4)}
.social-links{display:flex;gap:var(--space-3);justify-content:center;flex-wrap:wrap}
.social-links a{
  width:34px;height:34px;display:grid;place-items:center;border-radius:var(--radius-full);
  border:1px solid var(--border);color:var(--text-secondary);transition:all var(--transition);
}
.social-links a:hover{border-color:var(--accent-border);color:var(--accent);background:var(--accent-soft);transform:translateY(-2px)}

/* ---------- 通用区块 ---------- */
.section{padding:var(--space-20) 0}
.section-head{display:flex;align-items:baseline;justify-content:space-between;gap:var(--space-4);margin-bottom:var(--space-8);flex-wrap:wrap}
.section-title{font-size:13px;font-weight:600;letter-spacing:.09em;text-transform:uppercase;color:var(--text-tertiary);margin:0}
.section-more{font-size:13.5px;color:var(--text-tertiary);display:inline-flex;align-items:center;gap:4px;transition:color var(--transition);white-space:nowrap;flex-shrink:0}
/* 关键：SVG 必须显式给尺寸，否则在 flex 容器中会被压缩成竖条 */
.section-more svg{width:14px;height:14px;flex-shrink:0}
.section-more:hover{color:var(--accent)}

.page-head{padding:var(--space-16) 0 var(--space-10);border-bottom:1px solid var(--border);margin-bottom:var(--space-12)}
.page-title{font-size:clamp(28px,4.4vw,40px);font-weight:680;letter-spacing:-.025em;line-height:1.2;margin:0 0 var(--space-3)}
.page-desc{color:var(--text-secondary);font-size:16px;margin:0;max-width:640px}

/* ---------- 按钮 ---------- */
.btn{
  display:inline-flex;align-items:center;justify-content:center;gap:6px;
  padding:9px 18px;border-radius:var(--radius);font-size:14px;font-weight:520;
  border:1px solid transparent;transition:all var(--transition);white-space:nowrap;
}
.btn svg{width:15px;height:15px}
.btn-primary{background:var(--accent);color:#fff;box-shadow:var(--shadow-xs)}
.btn-primary:hover{filter:brightness(1.08);transform:translateY(-1px);box-shadow:var(--shadow-sm)}
.btn-ghost{border-color:var(--border);color:var(--text-secondary)}
.btn-ghost:hover{border-color:var(--border-strong);color:var(--text);background:var(--surface-hover)}

/* ---------- 标签 ---------- */
.tag{
  display:inline-flex;align-items:center;padding:2px 9px;border-radius:var(--radius-full);
  font-size:12px;line-height:1.6;background:var(--bg-muted);color:var(--text-secondary);
  border:1px solid transparent;transition:all var(--transition);
}
.tag:hover{background:var(--accent-soft);color:var(--accent);border-color:var(--accent-border)}
.tag-outline{background:transparent;border-color:var(--border)}
.tag-accent{background:var(--accent-soft);color:var(--accent)}
.meta-dot::before{content:"·";margin:0 6px;color:var(--text-tertiary)}

.chip-row{display:flex;flex-wrap:wrap;gap:var(--space-2)}

/* ---------- 首页 Hero ---------- */
.hero{padding:var(--space-24) 0 var(--space-20);border-bottom:1px solid var(--border)}
.hero-inner{display:flex;align-items:center;gap:var(--space-12)}
.hero-avatar{
  width:112px;height:112px;border-radius:var(--radius-lg);flex-shrink:0;object-fit:cover;
  border:1px solid var(--border);box-shadow:var(--shadow-sm);background:var(--bg-muted);
}
.hero-main{min-width:0;flex:1}
.hero-eyebrow{font-size:13px;color:var(--accent);font-weight:560;margin-bottom:var(--space-3);letter-spacing:.02em}
.hero-title{font-size:clamp(30px,5vw,46px);font-weight:700;letter-spacing:-.035em;line-height:1.12;margin:0 0 var(--space-3)}
.hero-subtitle{font-size:17px;color:var(--text-secondary);margin:0 0 var(--space-4);font-weight:480}
.hero-desc{font-size:15.5px;color:var(--text-secondary);margin:0 0 var(--space-6);max-width:600px;white-space:pre-wrap}
.hero-actions{display:flex;flex-wrap:wrap;gap:var(--space-3)}
.hero-stats{display:flex;gap:var(--space-8);margin-top:var(--space-8);padding-top:var(--space-6);border-top:1px solid var(--border)}
.hero-stat-num{font-size:22px;font-weight:660;letter-spacing:-.02em;font-variant-numeric:tabular-nums}
.hero-stat-label{font-size:12.5px;color:var(--text-tertiary);margin-top:2px}
@media (max-width:720px){
  .hero{padding:var(--space-16) 0 var(--space-12)}
  .hero-inner{flex-direction:column;align-items:flex-start;gap:var(--space-5)}
  .hero-avatar{width:80px;height:80px}
  .hero-stats{gap:var(--space-6)}
}

/* ---------- 文章列表 ---------- */
.post-list{display:flex;flex-direction:column}
.post-item{
  display:flex;gap:var(--space-8);padding:var(--space-8) 0;
  border-bottom:1px solid var(--border);
}
.post-item:first-child{padding-top:0}
.post-item:last-child{border-bottom:none}
.post-item-main{flex:1;min-width:0}
.post-item-title{
  font-size:20px;font-weight:620;letter-spacing:-.02em;line-height:1.4;margin:0 0 var(--space-2);
  transition:color var(--transition);
}
.post-item:hover .post-item-title{color:var(--accent)}
.post-item-excerpt{
  font-size:14.5px;color:var(--text-secondary);margin:0 0 var(--space-3);
  display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;line-clamp:2;overflow:hidden;
}
.post-item-meta{display:flex;flex-wrap:wrap;align-items:center;gap:var(--space-2);font-size:13px;color:var(--text-tertiary)}
.post-item-thumb{
  width:180px;height:112px;border-radius:var(--radius-md);object-fit:cover;flex-shrink:0;
  border:1px solid var(--border);background:var(--bg-muted);
}
@media (max-width:640px){
  .post-item{gap:var(--space-4)}
  .post-item-thumb{width:96px;height:72px;border-radius:var(--radius)}
  .post-item-title{font-size:17px}
  .post-item-excerpt{-webkit-line-clamp:2;font-size:14px}
}
.featured-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:var(--space-5)}
.featured-card{
  display:flex;flex-direction:column;border:1px solid var(--border);border-radius:var(--radius-md);
  overflow:hidden;background:var(--surface);transition:all var(--transition);height:100%;
}
.featured-card:hover{border-color:var(--accent-border);box-shadow:var(--shadow-md);transform:translateY(-3px)}
.featured-card-cover{width:100%;aspect-ratio:16/9;object-fit:cover;background:var(--bg-muted)}
.featured-card-body{padding:var(--space-5);display:flex;flex-direction:column;gap:var(--space-2);flex:1}
.featured-card-title{font-size:17px;font-weight:620;letter-spacing:-.015em;line-height:1.4;margin:0}

/* ---------- 分类 / 标签云 ---------- */
.cloud{display:flex;flex-wrap:wrap;gap:var(--space-3)}
.cloud-item{
  display:inline-flex;align-items:center;gap:7px;padding:7px 15px;border-radius:var(--radius-full);
  border:1px solid var(--border);font-size:14px;color:var(--text-secondary);background:var(--surface);
  transition:all var(--transition);white-space:nowrap;
}
.cloud-item:hover{border-color:var(--accent-border);color:var(--accent);background:var(--accent-soft)}
.cloud-count{font-size:11.5px;color:var(--text-tertiary);font-variant-numeric:tabular-nums}
.category-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:var(--space-4)}
.category-card{
  padding:var(--space-5);border:1px solid var(--border);border-radius:var(--radius-md);
  background:var(--surface);transition:all var(--transition);
}
.category-card:hover{border-color:var(--accent-border);box-shadow:var(--shadow-sm)}
.category-card-name{font-size:15.5px;font-weight:600;margin:0 0 4px}
.category-card-desc{font-size:13px;color:var(--text-tertiary);margin:0 0 var(--space-3);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;line-clamp:2;overflow:hidden}

/* ---------- 归档 ---------- */
.archive-year{margin-bottom:var(--space-12)}
.archive-year-title{
  font-size:32px;font-weight:700;letter-spacing:-.03em;margin:0 0 var(--space-2);
  padding-bottom:var(--space-4);border-bottom:1px solid var(--border);
}
.archive-month{display:flex;gap:var(--space-6);padding:var(--space-5) 0;border-bottom:1px solid var(--border)}
.archive-month:last-child{border-bottom:none}
.archive-month-label{font-size:13.5px;color:var(--text-tertiary);width:78px;flex-shrink:0;padding-top:2px;font-variant-numeric:tabular-nums}
.archive-month-posts{flex:1;display:flex;flex-direction:column;gap:var(--space-3)}
.archive-post{display:flex;align-items:baseline;gap:var(--space-3);font-size:15px}
.archive-post-day{font-size:12.5px;color:var(--text-tertiary);width:34px;flex-shrink:0;font-variant-numeric:tabular-nums}
.archive-post a{color:var(--text);transition:color var(--transition)}
.archive-post a:hover{color:var(--accent)}
@media (max-width:640px){.archive-month{flex-direction:column;gap:var(--space-2)}.archive-month-label{width:auto}}

/* ---------- 文章详情 ---------- */
.article{padding:var(--space-16) 0 0}
.article-head{margin-bottom:var(--space-10)}
.article-title{font-size:clamp(30px,5vw,42px);font-weight:700;letter-spacing:-.035em;line-height:1.18;margin:0 0 var(--space-5)}
.article-excerpt{font-size:17px;color:var(--text-secondary);margin:0 0 var(--space-6);line-height:1.7}
.article-meta{display:flex;flex-wrap:wrap;align-items:center;gap:var(--space-3);font-size:13.5px;color:var(--text-tertiary);padding-bottom:var(--space-6);border-bottom:1px solid var(--border)}
.article-cover{width:100%;border-radius:var(--radius-md);margin-bottom:var(--space-10);border:1px solid var(--border)}
.article-body{max-width:var(--content);margin:0 auto;font-size:17px;line-height:1.85;color:var(--text)}
.article-body>*:first-child{margin-top:0}

/* 阅读进度 */
.read-progress{position:fixed;top:0;left:0;height:2px;background:var(--accent);z-index:60;width:0;transition:width 80ms linear}

/* 目录 */
.article-layout{display:grid;grid-template-columns:minmax(0,1fr) 232px;gap:var(--space-16);align-items:start;max-width:1040px;margin:0 auto}
/* 有目录时正文放宽但仍受控，避免宽屏下正文行过长影响阅读 */
.article-layout.has-toc .article-body{max-width:720px}
@media (max-width:1080px){
  .article-layout{grid-template-columns:minmax(0,1fr)}
  .article-layout .article-body{max-width:var(--content);margin:0 auto}
}
.toc{position:sticky;top:calc(var(--header-h) + var(--space-6));font-size:13.5px;max-height:calc(100vh - var(--header-h) - 60px);overflow-y:auto}
.toc-title{font-size:11.5px;font-weight:600;letter-spacing:.09em;text-transform:uppercase;color:var(--text-tertiary);margin:0 0 var(--space-3)}
.toc ul{list-style:none;margin:0;padding:0;border-left:1px solid var(--border)}
.toc a{display:block;padding:5px 0 5px 14px;color:var(--text-tertiary);border-left:2px solid transparent;margin-left:-1px;transition:all var(--transition)}
.toc a:hover{color:var(--text)}
.toc a.is-active{color:var(--accent);border-left-color:var(--accent);font-weight:540}
.toc .toc-l3{padding-left:26px;font-size:12.5px}
.toc-toggle{display:none}
@media (max-width:1080px){
  .toc{
    position:static;max-height:none;margin-bottom:var(--space-8);border:1px solid var(--border);
    border-radius:var(--radius-md);padding:var(--space-4);background:var(--bg-subtle);
  }
  .toc-toggle{display:flex;align-items:center;justify-content:space-between;width:100%;font-size:13.5px;font-weight:560}
  .toc-toggle svg{width:15px;height:15px;transition:transform var(--transition)}
  .toc-toggle[aria-expanded="true"] svg{transform:rotate(180deg)}
  .toc-body{margin-top:var(--space-3);max-height:280px;overflow-y:auto}
  .toc-body[hidden]{display:none}
}

/* ---------- Markdown 正文排版 ---------- */
.md-heading{scroll-margin-top:calc(var(--header-h) + 20px);font-weight:660;letter-spacing:-.02em;line-height:1.35}
h1.md-heading{font-size:1.9em;margin:1.6em 0 .7em}
h2.md-heading{font-size:1.5em;margin:2em 0 .8em;padding-bottom:.35em;border-bottom:1px solid var(--border)}
h3.md-heading{font-size:1.2em;margin:1.7em 0 .6em}
h4.md-heading{font-size:1.05em;margin:1.5em 0 .5em}
h5.md-heading,h6.md-heading{font-size:.95em;margin:1.4em 0 .5em;color:var(--text-secondary)}
.article-body h2:first-child,.article-body h1:first-child{margin-top:0}
.article-body p{margin:0 0 1.25em}
.article-body ul,.article-body ol{margin:0 0 1.25em;padding-left:1.5em}
.article-body li{margin:.35em 0}
.article-body li>ul,.article-body li>ol{margin:.3em 0}
.article-body blockquote{
  margin:1.6em 0;padding:.9em 1.2em;border-left:3px solid var(--accent);
  background:var(--bg-subtle);border-radius:0 var(--radius) var(--radius) 0;color:var(--text-secondary);
}
.article-body blockquote p:last-child{margin-bottom:0}
.article-body hr{border:none;border-top:1px solid var(--border);margin:2.5em 0}
.article-body a:not(.tag){color:var(--accent);text-decoration:underline;text-decoration-color:var(--accent-border);text-underline-offset:3px;transition:all var(--transition)}
.article-body a:not(.tag):hover{text-decoration-color:var(--accent)}
.md-inline-code{
  font-family:var(--font-mono);font-size:.87em;padding:.15em .4em;border-radius:var(--radius-sm);
  background:var(--code-bg);color:var(--code-text);border:1px solid var(--border);
  word-break:break-word;
}
.article-body table{
  width:100%;border-collapse:collapse;margin:1.6em 0;font-size:14.5px;
  border:1px solid var(--border);border-radius:var(--radius);overflow:hidden;display:block;overflow-x:auto;
}
@media (min-width:641px){.article-body table{display:table}}
.article-body th{
  background:var(--bg-muted);font-weight:620;text-align:left;padding:11px 14px;
  border-bottom:1px solid var(--border);white-space:nowrap;
}
.article-body td{padding:11px 14px;border-bottom:1px solid var(--border);vertical-align:top}
.article-body tr:last-child td{border-bottom:none}
.article-body tbody tr:hover{background:var(--bg-subtle)}

.md-figure{margin:1.8em 0}
.md-img{
  width:100%;border-radius:var(--radius);border:1px solid var(--border);cursor:zoom-in;
  background:var(--bg-muted);transition:opacity var(--transition);
}
.md-img:hover{opacity:.94}
.md-figcaption{font-size:13px;color:var(--text-tertiary);text-align:center;margin-top:var(--space-3);line-height:1.6}

.md-code{
  position:relative;margin:1.8em 0;border-radius:var(--radius-md);overflow:hidden;
  background:var(--code-bg);border:1px solid var(--border);
}
.md-code::before{
  content:attr(data-lang);position:absolute;top:0;right:0;
  padding:3px 10px;font-size:11px;font-family:var(--font-mono);color:var(--text-tertiary);
  background:var(--bg-muted);border-left:1px solid var(--border);border-bottom:1px solid var(--border);
  border-radius:0 var(--radius-md) 0 var(--radius-sm);text-transform:uppercase;letter-spacing:.04em;
}
.md-code pre{margin:0;padding:var(--space-5);overflow-x:auto}
.md-code code{
  font-family:var(--font-mono);font-size:13.5px;line-height:1.7;color:var(--code-text);
  background:none;padding:0;border:none;white-space:pre;
}
.md-code-copy{
  position:absolute;top:var(--space-2);left:var(--space-2);z-index:2;
  padding:4px 10px;font-size:11.5px;border-radius:var(--radius-sm);
  background:var(--surface);border:1px solid var(--border);color:var(--text-tertiary);
  opacity:0;transition:all var(--transition);
}
.md-code:hover .md-code-copy,.md-code-copy:focus-visible{opacity:1}
.md-code-copy:hover{color:var(--accent);border-color:var(--accent-border)}
.md-code-copy[data-copied="true"]{color:var(--accent);opacity:1}
.tok-str{color:var(--tok-str)}.tok-num{color:var(--tok-num)}.tok-kw{color:var(--tok-kw);font-weight:500}.tok-com{color:var(--tok-com);font-style:italic}
/* 语法高亮配色统一由 --tok-* 令牌按主题给出，不再为 light 单独硬编码 */

.md-math{
  font-family:var(--font-mono);background:var(--bg-muted);padding:.1em .35em;
  border-radius:var(--radius-sm);font-size:.92em;
}
.md-math-block{display:block;padding:var(--space-4);margin:1.6em 0;text-align:center;overflow-x:auto}

/* 文章底部 */
.article-footer{margin-top:var(--space-16);padding-top:var(--space-8);border-top:1px solid var(--border)}
.article-tags{display:flex;flex-wrap:wrap;gap:var(--space-2);align-items:center;margin-bottom:var(--space-10)}
.article-share{display:flex;align-items:center;gap:var(--space-3);font-size:13.5px;color:var(--text-tertiary);flex-wrap:wrap}
.share-btn{
  display:inline-flex;align-items:center;gap:5px;padding:6px 12px;border-radius:var(--radius-full);
  border:1px solid var(--border);font-size:13px;color:var(--text-secondary);transition:all var(--transition);
  white-space:nowrap;flex-shrink:0;
}
.share-btn svg{width:14px;height:14px}
.share-btn:hover{border-color:var(--accent-border);color:var(--accent);background:var(--accent-soft)}
.article-nav{display:grid;grid-template-columns:1fr 1fr;gap:var(--space-4);margin-top:var(--space-12)}
.article-nav a{
  padding:var(--space-5);border:1px solid var(--border);border-radius:var(--radius-md);
  transition:all var(--transition);min-width:0;
}
.article-nav a:hover{border-color:var(--accent-border);background:var(--surface-hover)}
.article-nav-label{font-size:12px;color:var(--text-tertiary);margin-bottom:4px}
.article-nav-title{font-size:14.5px;font-weight:520;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.article-nav a.next{text-align:right}
@media (max-width:640px){.article-nav{grid-template-columns:1fr}}

.related-list{display:flex;flex-direction:column;gap:var(--space-3)}
.related-item{display:flex;align-items:baseline;gap:var(--space-3);font-size:15px}
.related-item::before{content:"";width:4px;height:4px;border-radius:50%;background:var(--border-strong);flex-shrink:0}

/* 图片灯箱 */
.lightbox{
  position:fixed;inset:0;z-index:100;display:none;place-items:center;
  background:rgba(0,0,0,.92);padding:var(--space-8);cursor:zoom-out;
}
.lightbox[data-open="true"]{display:grid}
.lightbox img{max-width:100%;max-height:88vh;border-radius:var(--radius);object-fit:contain}
.lightbox-caption{color:rgba(255,255,255,.8);font-size:13.5px;text-align:center;margin-top:var(--space-4);max-width:640px}
.lightbox-close{position:absolute;top:var(--space-6);right:var(--space-6);color:#fff;width:40px;height:40px;display:grid;place-items:center;border-radius:var(--radius-full);background:rgba(255,255,255,.12)}
.lightbox-close:hover{background:rgba(255,255,255,.22)}
.lightbox-nav{position:absolute;top:50%;transform:translateY(-50%);color:#fff;width:44px;height:44px;display:grid;place-items:center;border-radius:50%;background:rgba(255,255,255,.12)}
.lightbox-nav:hover{background:rgba(255,255,255,.22)}
.lightbox-prev{left:var(--space-5)}.lightbox-next{right:var(--space-5)}

/* 工具悬浮 */
.floating-tools{position:fixed;right:var(--space-6);bottom:var(--space-8);z-index:40;display:flex;flex-direction:column;gap:var(--space-2)}
.float-btn{
  width:40px;height:40px;display:grid;place-items:center;border-radius:var(--radius-full);
  background:var(--surface);border:1px solid var(--border);color:var(--text-secondary);
  box-shadow:var(--shadow-sm);transition:all var(--transition);
}
.float-btn:hover{color:var(--accent);border-color:var(--accent-border);transform:translateY(-2px)}
.float-btn svg{width:16px;height:16px}

/* ---------- 搜索 ---------- */
.search-box{position:relative;max-width:520px;margin:0 auto}
.search-input{
  width:100%;padding:13px 46px 13px 44px;border-radius:var(--radius-md);
  border:1px solid var(--border);background:var(--surface);font-size:15px;
  transition:all var(--transition);
}
.search-input:focus{outline:none;border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-soft)}
.search-icon{position:absolute;left:15px;top:50%;transform:translateY(-50%);width:17px;height:17px;color:var(--text-tertiary)}
.search-clear{position:absolute;right:12px;top:50%;transform:translateY(-50%);width:26px;height:26px;display:grid;place-items:center;border-radius:var(--radius-sm);color:var(--text-tertiary)}
.search-clear:hover{background:var(--surface-hover);color:var(--text)}
mark{background:var(--accent-soft);color:var(--accent);padding:.05em .2em;border-radius:3px}

/* ---------- 空状态 / 错误 ---------- */
.empty{
  padding:var(--space-24) var(--space-6);text-align:center;
  border:1px dashed var(--border-strong);border-radius:var(--radius-lg);background:var(--bg-subtle);
}
.empty-icon{width:44px;height:44px;margin:0 auto var(--space-4);color:var(--text-tertiary);opacity:.6}
.empty-title{font-size:16px;font-weight:580;margin:0 0 var(--space-2);color:var(--text-secondary)}
.empty-desc{font-size:14px;color:var(--text-tertiary);margin:0 0 var(--space-5)}

/* ---------- 404 ---------- */
.error-page{padding:var(--space-24) 0;text-align:center}
.error-code{font-size:clamp(72px,14vw,140px);font-weight:800;letter-spacing:-.05em;line-height:1;background:linear-gradient(180deg,var(--text) 20%,var(--border-strong));-webkit-background-clip:text;background-clip:text;color:transparent}
.error-title{font-size:22px;font-weight:640;margin:var(--space-6) 0 var(--space-3)}
.error-desc{color:var(--text-secondary);margin:0 auto var(--space-8);max-width:420px}

/* ---------- 分页 ---------- */
.pagination{display:flex;justify-content:center;align-items:center;gap:var(--space-2);margin-top:var(--space-16)}
.page-btn{
  min-width:36px;height:36px;padding:0 10px;display:grid;place-items:center;border-radius:var(--radius-sm);
  border:1px solid var(--border);font-size:14px;color:var(--text-secondary);transition:all var(--transition);
  font-variant-numeric:tabular-nums;
}
.page-btn:hover:not(:disabled){border-color:var(--accent-border);color:var(--accent)}
.page-btn[aria-current="page"]{background:var(--accent);border-color:var(--accent);color:#fff;font-weight:540}
.page-btn:disabled{opacity:.4;cursor:not-allowed}
.page-ellipsis{color:var(--text-tertiary);padding:0 4px}

/* ---------- 评论 ---------- */
.comments{margin-top:var(--space-16);padding-top:var(--space-10);border-top:1px solid var(--border)}
.comment-form{display:flex;flex-direction:column;gap:var(--space-3);margin-bottom:var(--space-10)}
.form-row{display:flex;gap:var(--space-3);flex-wrap:wrap}
.input,.textarea{
  width:100%;padding:10px 14px;border-radius:var(--radius);border:1px solid var(--border);
  background:var(--surface);font-size:14.5px;transition:all var(--transition);
}
.input:focus,.textarea:focus{outline:none;border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-soft)}
.textarea{min-height:110px;resize:vertical;line-height:1.7;font-family:inherit}
.comment-list{display:flex;flex-direction:column;gap:var(--space-6)}
.comment{padding:var(--space-5);border:1px solid var(--border);border-radius:var(--radius-md);background:var(--surface)}
.comment-head{display:flex;align-items:center;gap:var(--space-3);margin-bottom:var(--space-2);font-size:13.5px}
.comment-name{font-weight:580;color:var(--text)}
.comment-time{color:var(--text-tertiary);font-size:12.5px}
.comment-body{font-size:14.5px;color:var(--text-secondary);white-space:pre-wrap;word-break:break-word}
.comment-children{margin-top:var(--space-4);padding-left:var(--space-5);border-left:2px solid var(--border);display:flex;flex-direction:column;gap:var(--space-4)}
.comment-form-note{font-size:12.5px;color:var(--text-tertiary)}

/* ---------- 工具类 ---------- */
.flex{display:flex}.flex-col{flex-direction:column}.items-center{align-items:center}.justify-between{justify-content:space-between}
.gap-2{gap:var(--space-2)}.gap-3{gap:var(--space-3)}.gap-4{gap:var(--space-4)}.gap-6{gap:var(--space-6)}
.mt-4{margin-top:var(--space-4)}.mt-8{margin-top:var(--space-8)}.mt-12{margin-top:var(--space-12)}
.mb-4{margin-bottom:var(--space-4)}.mb-8{margin-bottom:var(--space-8)}
.text-sm{font-size:13.5px}.text-xs{font-size:12.5px}
.muted{color:var(--text-tertiary)}.secondary{color:var(--text-secondary)}
.accent{color:var(--accent)}
.center{text-align:center}
.divider{height:1px;background:var(--border);margin:var(--space-10) 0}
.fade-in{animation:fadeIn .4s cubic-bezier(.4,0,.2,1)}
@keyframes fadeIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){
  *,*::before,*::after{animation-duration:.01ms!important;transition-duration:.01ms!important;scroll-behavior:auto!important}
}
`;
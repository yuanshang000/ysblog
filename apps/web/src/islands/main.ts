/**
 * 前台交互岛入口 —— 渐进增强。
 *
 * 原则：SSR 已输出全部内容与结构，本脚本只负责「行为」，不负责「内容」。
 * 即使 JS 加载失败，文章仍可正常阅读（SEO 与可访问性不依赖 JS）。
 */

const THEME_KEY = 'mb-theme';

/**
 * 交互岛生命周期管理。
 *
 * 页面内路由会在不刷新文档的前提下替换主体内容并重新挂载交互岛，
 * 而部分交互（阅读进度、目录高亮、灯箱、抽屉）会在 window/document 上
 * 注册监听器。若不做统一注销，每次跳转都会叠加一份监听器，
 * 导致回调执行次数翻倍、进度条抖动等问题。
 *
 * 因此这里用 AbortController 作为「一次挂载」的令牌：
 * 重新挂载前先 abort，上一轮注册的所有监听器会被浏览器自动移除。
 */
let mountController: AbortController | null = null;

/** 在当前挂载周期内注册监听器，周期结束后自动失效 */
function on<T extends EventTarget>(
  target: T,
  type: string,
  handler: EventListenerOrEventListenerObject,
  options?: AddEventListenerOptions | boolean
): void {
  target.addEventListener(type, handler, {
    ...(typeof options === 'object' ? options : {}),
    signal: mountController?.signal
  } as AddEventListenerOptions);
}

/** 主题切换 */
function initTheme(): void {
  const toggle = document.querySelector<HTMLElement>('[data-theme-toggle]');
  if (!toggle) return;

  const sync = () => {
    const theme = document.documentElement.dataset.theme ?? 'light';
    const light = toggle.querySelector<HTMLElement>('[data-theme-icon-light]');
    const dark = toggle.querySelector<HTMLElement>('[data-theme-icon-dark]');
    if (light) light.style.display = theme === 'dark' ? 'none' : '';
    if (dark) dark.style.display = theme === 'dark' ? '' : 'none';
    toggle.setAttribute('aria-label', theme === 'dark' ? '切换到浅色模式' : '切换到深色模式');
  };
  sync();

  toggle.addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    document.documentElement.style.colorScheme = next;
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      /* 隐私模式下 localStorage 不可用，忽略 */
    }
    sync();
  });

  // 跟随系统模式下监听系统变化
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  mq.addEventListener('change', () => {
    let stored: string | null = null;
    try {
      stored = localStorage.getItem(THEME_KEY);
    } catch {
      stored = null;
    }
    if (stored === 'light' || stored === 'dark') return;
    const next = mq.matches ? 'dark' : 'light';
    document.documentElement.dataset.theme = next;
    document.documentElement.style.colorScheme = next;
    sync();
  });
}

/** 移动端抽屉导航 */
function initDrawer(): void {
  const toggle = document.querySelector<HTMLElement>('[data-drawer-toggle]');
  const drawer = document.querySelector<HTMLElement>('[data-drawer]');
  if (!toggle || !drawer) return;

  const close = () => {
    drawer.dataset.open = 'false';
    toggle.setAttribute('aria-expanded', 'false');
  };

  toggle.addEventListener('click', () => {
    const open = drawer.dataset.open === 'true';
    drawer.dataset.open = open ? 'false' : 'true';
    toggle.setAttribute('aria-expanded', open ? 'false' : 'true');
  });

  drawer.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).tagName === 'A') close();
  });

  on(document, 'keydown', ((e: KeyboardEvent) => {
    if (e.key === 'Escape') close();
  }) as EventListener);

  on(window, 'resize', (() => {
    if (window.innerWidth > 900) close();
  }) as EventListener);
}

/** 复制链接 */
function initCopyLink(): void {
  const buttons = document.querySelectorAll<HTMLElement>('[data-copy-link]');
  buttons.forEach((btn) => {
    btn.addEventListener('click', async () => {
      const url = window.location.href;
      const label = btn.querySelector('span')?.textContent ?? '';
      try {
        await navigator.clipboard.writeText(url);
      } catch {
        // 降级方案：http 环境 clipboard 不可用
        const ta = document.createElement('textarea');
        ta.value = url;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        try {
          document.execCommand('copy');
        } finally {
          document.body.removeChild(ta);
        }
      }
      if (label) {
        const original = label;
        btn.querySelector('span')!.textContent = '已复制';
        setTimeout(() => {
          btn.querySelector('span')!.textContent = original;
        }, 1600);
      } else {
        btn.setAttribute('data-copied', 'true');
        setTimeout(() => btn.removeAttribute('data-copied'), 1600);
      }
    });
  });
}

/** 回到顶部 */
function initToTop(): void {
  const btn = document.querySelector<HTMLElement>('[data-to-top]');
  if (!btn) return;
  btn.addEventListener('click', () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
}

/** 阅读进度条 */
function initReadProgress(): void {
  const bar = document.querySelector<HTMLElement>('[data-read-progress]');
  const body = document.querySelector<HTMLElement>('[data-article-body]');
  if (!bar || !body) return;

  let ticking = false;
  const update = () => {
    const rect = body.getBoundingClientRect();
    const total = rect.height - window.innerHeight;
    const scrolled = -rect.top;
    const pct = total > 0 ? Math.min(100, Math.max(0, (scrolled / total) * 100)) : 0;
    bar.style.width = `${pct}%`;
    ticking = false;
  };

  const onScroll = () => {
    if (!ticking) {
      ticking = true;
      requestAnimationFrame(update);
    }
  };

  on(window, 'scroll', onScroll, { passive: true });
  on(window, 'resize', onScroll);
  update();
}

/** 文章目录：滚动高亮 + 移动端折叠 */
function initToc(): void {
  const toc = document.querySelector<HTMLElement>('[data-toc]');
  if (!toc) return;

  const toggle = toc.querySelector<HTMLElement>('[data-toc-toggle]');
  const bodyEl = toc.querySelector<HTMLElement>('[data-toc-body]');

  // 移动端默认折叠
  if (toggle && bodyEl && window.innerWidth <= 1080) {
    bodyEl.hidden = true;
  }
  toggle?.addEventListener('click', () => {
    if (!bodyEl) return;
    const expanded = toggle.getAttribute('aria-expanded') === 'true';
    toggle.setAttribute('aria-expanded', expanded ? 'false' : 'true');
    bodyEl.hidden = expanded;
  });

  const links = Array.from(toc.querySelectorAll<HTMLAnchorElement>('[data-toc-link]'));
  if (!links.length) return;

  const headings = links
    .map((l) => document.getElementById(l.dataset.tocLink ?? ''))
    .filter((h): h is HTMLElement => Boolean(h));
  if (!headings.length) return;

  let activeId = '';
  let ticking = false;

  const update = () => {
    // 找出当前视口内最靠上的标题
    let current = headings[0];
    for (const h of headings) {
      if (h.getBoundingClientRect().top <= 120) current = h;
      else break;
    }
    if (current.id !== activeId) {
      activeId = current.id;
      links.forEach((l) => {
        l.classList.toggle('is-active', l.dataset.tocLink === activeId);
      });
    }
    ticking = false;
  };

  on(
    window,
    'scroll',
    () => {
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(update);
      }
    },
    { passive: true }
  );
  update();
}

/** 代码块复制 */
function initCodeCopy(): void {
  document.querySelectorAll<HTMLElement>('.md-code-copy').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const code = btn.parentElement?.querySelector('code')?.textContent ?? '';
      try {
        await navigator.clipboard.writeText(code);
        btn.textContent = '已复制';
        btn.setAttribute('data-copied', 'true');
      } catch {
        btn.textContent = '复制失败';
      }
      setTimeout(() => {
        btn.textContent = '复制';
        btn.removeAttribute('data-copied');
      }, 1600);
    });
  });
}

/** 图片灯箱 */
function initLightbox(): void {
  const box = document.querySelector<HTMLElement>('[data-lightbox]');
  const body = document.querySelector<HTMLElement>('[data-article-body]');
  if (!box || !body) return;

  const img = box.querySelector<HTMLImageElement>('[data-lightbox-img]');
  const caption = box.querySelector<HTMLElement>('[data-lightbox-caption]');
  const images = Array.from(body.querySelectorAll<HTMLImageElement>('img.md-img'));
  if (!img || !images.length) return;

  let index = 0;

  const show = (i: number) => {
    index = (i + images.length) % images.length;
    const target = images[index];
    img.src = target.getAttribute('data-src') || target.src;
    img.alt = target.alt || '';
    if (caption) {
      const cap = target.getAttribute('data-caption') || '';
      caption.textContent = cap;
      caption.style.display = cap ? '' : 'none';
    }
    box.dataset.open = 'true';
    document.body.style.overflow = 'hidden';
  };

  const close = () => {
    box.dataset.open = 'false';
    document.body.style.overflow = '';
  };

  images.forEach((im, i) => {
    im.addEventListener('click', () => show(i));
  });

  box.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    if (t === box || t.closest('[data-lightbox-close]')) close();
    else if (t.closest('[data-lightbox-next]')) show(index + 1);
    else if (t.closest('[data-lightbox-prev]')) show(index - 1);
  });

  on(document, 'keydown', ((e: KeyboardEvent) => {
    if (box.dataset.open !== 'true') return;
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowRight') show(index + 1);
    else if (e.key === 'ArrowLeft') show(index - 1);
  }) as EventListener);

  // 图片加载失败占位
  images.forEach((im) => {
    im.addEventListener('error', () => {
      im.style.background = 'var(--bg-muted)';
      im.setAttribute('data-error', 'true');
    });
  });
}

/** 搜索页交互 */
function initSearch(): void {
  const input = document.querySelector<HTMLInputElement>('[data-search-input]');
  if (!input) return;
  const clear = document.querySelector<HTMLElement>('[data-search-clear]');

  clear?.addEventListener('click', () => {
    input.value = '';
    clear.style.display = 'none';
    input.focus();
    window.location.href = '/search';
  });

  let timer: ReturnType<typeof setTimeout> | null = null;
  input.addEventListener('input', () => {
    if (timer) clearTimeout(timer);
    if (clear) clear.style.display = input.value ? '' : 'none';
    timer = setTimeout(() => {
      const q = input.value.trim();
      const url = q ? `/search?q=${encodeURIComponent(q)}` : '/search';
      window.location.href = url;
    }, 500);
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      if (timer) clearTimeout(timer);
      const q = input.value.trim();
      window.location.href = q ? `/search?q=${encodeURIComponent(q)}` : '/search';
    }
  });
}

/** 懒加载图片进入视口时再解码 */
function initLazyImages(): void {
  if (!('IntersectionObserver' in window)) return;
  const imgs = document.querySelectorAll<HTMLImageElement>('img[loading="lazy"]');
  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const img = entry.target as HTMLImageElement;
        img.removeAttribute('loading');
        io.unobserve(img);
      }
    },
    { rootMargin: '200px' }
  );
  imgs.forEach((i) => io.observe(i));
}

/** 评论模块 */
function initComments(): void {
  const section = document.querySelector<HTMLElement>('[data-comments]');
  if (!section) return;
  const postId = section.dataset.postId;
  const listEl = section.querySelector<HTMLElement>('[data-comment-list]');
  const form = section.querySelector<HTMLFormElement>('[data-comment-form]');
  const countEl = section.querySelector<HTMLElement>('[data-comment-count]');
  const noteEl = section.querySelector<HTMLElement>('[data-comment-note]');
  if (!postId || !listEl) return;

  const escapeHtml = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  const timeAgo = (iso: string) => {
    const d = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z');
    const diff = (Date.now() - d.getTime()) / 1000;
    if (diff < 60) return '刚刚';
    if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
    if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`;
    if (diff < 2592000) return `${Math.floor(diff / 86400)} 天前`;
    return d.toISOString().slice(0, 10);
  };

  const renderOne = (c: {
    id: number;
    authorName: string;
    content: string;
    createdAt: string;
    website: string | null;
  }): string => {
    const name = c.website
      ? `<a href="${escapeHtml(c.website)}" target="_blank" rel="noopener noreferrer nofollow" class="comment-name">${escapeHtml(c.authorName)}</a>`
      : `<span class="comment-name">${escapeHtml(c.authorName)}</span>`;
    return `<div class="comment">
      <div class="comment-head">${name}<span class="comment-time">${timeAgo(c.createdAt)}</span></div>
      <div class="comment-body">${escapeHtml(c.content)}</div>
    </div>`;
  };

  const load = async () => {
    try {
      const res = await fetch(`/api/v1/posts/${postId}/comments`, { credentials: 'same-origin' });
      const json = await res.json();
      const data = json?.data;
      if (!data?.enabled) {
        listEl.innerHTML = '<p class="text-sm muted">评论功能未开启。</p>';
        return;
      }
      if (countEl) countEl.textContent = `${data.count} 条评论`;
      if (noteEl) {
        noteEl.textContent = data.moderated ? '评论提交后需审核通过才会显示' : '支持 Markdown 语法';
      }
      if (!data.items?.length) {
        listEl.innerHTML = '<p class="text-sm muted">还没有评论，来说点什么吧。</p>';
        return;
      }
      listEl.innerHTML = data.items
        .map((c: { id: number }) => renderOne(c))
        .join('');
    } catch {
      listEl.innerHTML = '<p class="text-sm muted">评论加载失败，请稍后重试。</p>';
    }
  };

  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = form.querySelector<HTMLButtonElement>('button[type="submit"]');
    const fd = new FormData(form);
    const payload = {
      authorName: String(fd.get('authorName') ?? ''),
      authorEmail: String(fd.get('authorEmail') ?? ''),
      authorWebsite: String(fd.get('authorWebsite') ?? ''),
      content: String(fd.get('content') ?? '')
    };
    if (!payload.authorName.trim()) return alert('请填写昵称');
    if (payload.content.trim().length < 2) return alert('评论内容太短');

    if (btn) btn.disabled = true;
    try {
      const res = await fetch(`/api/v1/posts/${postId}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(payload)
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.message ?? '提交失败');
      alert(json.message ?? '评论已提交');
      form.reset();
      load();
    } catch (err) {
      alert(err instanceof Error ? err.message : '提交失败，请稍后重试');
    } finally {
      if (btn) btn.disabled = false;
    }
  });

  load();
}

/**
 * 页面内路由（渐进增强式单页导航）。
 *
 * 前台页面由 Worker 服务端渲染成完整 HTML。这里在已有 HTML 的基础上，
 * 拦截站内链接的点击，取回目标页面的 HTML，仅替换 <main> 主体内容，
 * 并同步标题、描述与地址栏，从而获得接近 SPA 的切换体验。
 *
 * 关键约束：
 * - 必须在服务端已渲染出正确内容的前提下工作，禁用 JS 时退化为普通整页跳转，
 *   不影响 SEO 与可访问性；
 * - 任何一步失败（网络错误、非 200、页面结构异常）都回退到浏览器默认跳转，
 *   保证「点得开」永远优先于「切得顺」；
 * - 只接管 GET 语义的普通导航，保留 Cmd/Ctrl 点击、新标签页等浏览器原生行为。
 */

/** 这些路径不属于前台内容区，交由浏览器整页跳转处理 */
function shouldBypassRoute(url: URL): boolean {
  return (
    url.origin !== window.location.origin ||
    url.protocol !== 'http:' && url.protocol !== 'https:' ||
    url.pathname.startsWith('/admin') ||
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/media/')
  );
}

/** 把目标页面的 head 关键信息同步到当前文档 */
function syncHead(doc: Document): void {
  const pick = (selector: string): string | null =>
    doc.querySelector(selector)?.getAttribute('content') ?? null;

  const setMeta = (selector: string, value: string | null): void => {
    if (!value) return;
    let el = document.head.querySelector<HTMLMetaElement>(selector);
    if (!el) {
      el = document.createElement('meta');
      const [key, val] = selector.replace(/meta\[|\]/g, '').split('=');
      el.setAttribute(key, val.replace(/["']/g, ''));
      document.head.appendChild(el);
    }
    el.setAttribute('content', value);
  };

  const title = doc.title;
  if (title) document.title = title;

  setMeta('meta[name="description"]', pick('meta[name="description"]'));
  setMeta('meta[property="og:title"]', pick('meta[property="og:title"]'));
  setMeta('meta[property="og:description"]', pick('meta[property="og:description"]'));

  const canonical = doc.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href;
  const current = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (canonical && current) current.href = canonical;
}

/** 高亮当前栏目，并同步移动端抽屉的展开态 */
function syncActiveNav(pathname: string): void {
  document.querySelectorAll<HTMLAnchorElement>('[data-route-link]').forEach((a) => {
    let target: URL;
    try {
      target = new URL(a.getAttribute('href') ?? '', window.location.origin);
    } catch {
      return;
    }
    const active = target.pathname === pathname ||
      (target.pathname !== '/' && pathname.startsWith(target.pathname));
    if (active) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
}

/** 执行一次页面内跳转；返回 false 表示应回退到整页跳转 */
async function navigate(href: string, push: boolean): Promise<boolean> {
  let url: URL;
  try {
    url = new URL(href, window.location.origin);
  } catch {
    return false;
  }
  if (shouldBypassRoute(url)) return false;

  try {
    const res = await fetch(url.pathname + url.search + url.hash, {
      headers: { 'X-Requested-With': 'fetch' },
      credentials: 'same-origin',
      redirect: 'follow'
    });
    if (!res.ok) return false;

    const html = await res.text();
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const nextMain = doc.querySelector<HTMLElement>('#main');
    const curMain = document.querySelector<HTMLElement>('#main');
    // 目标页结构不符（可能是接口返回或异常页）时交回浏览器处理
    if (!nextMain || !curMain) return false;

    curMain.replaceWith(nextMain);
    syncHead(doc);
    syncActiveNav(url.pathname);

    if (push) {
      window.history.pushState({ url: url.pathname + url.search }, '', url.pathname + url.search);
    }

    // 重新挂载交互岛，并回到顶部
    boot();
    if (url.hash) {
      const target = document.getElementById(decodeURIComponent(url.hash.slice(1)));
      if (target) {
        target.scrollIntoView({ behavior: 'smooth' });
        return true;
      }
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
    return true;
  } catch {
    return false;
  }
}

function initRouter(): void {
  on(document, 'click', ((e: MouseEvent) => {
    // 仅响应左键普通点击，保留 Cmd/Ctrl/Shift/中键的新标签页行为
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) {
      return;
    }
    const anchor = (e.target as HTMLElement | null)?.closest?.('a');
    if (!anchor) return;

    const href = anchor.getAttribute('href');
    if (!href || anchor.hasAttribute('download')) return;
    // 站外链接、带 target 的链接、纯锚点跳转都不接管
    if (anchor.target && anchor.target !== '_self') return;
    if (href.startsWith('#')) return;
    if (/^[a-z][a-z0-9+.-]*:/i.test(href) && !href.startsWith(window.location.origin)) return;

    let url: URL;
    try {
      url = new URL(href, window.location.href);
    } catch {
      return;
    }
    if (shouldBypassRoute(url)) return;
    //同一页面内（含仅 hash 变化）无需处理
    if (url.pathname === window.location.pathname && url.search === window.location.search) return;

    e.preventDefault();
    void navigate(url.href, true);
  }) as EventListener);

  // 浏览器前进/后退
  on(window, 'popstate', (() => {
    void navigate(window.location.href, false);
  }) as EventListener);
}

/**
 * 挂载全部交互岛。
 *
 * 每次调用都会开启一个新的挂载周期，并注销上一个周期的所有全局监听器，
 * 因此可以安全地在页面内路由切换后重复调用。
 */
function boot(): void {
  mountController?.abort();
  mountController = new AbortController();

  initTheme();
  initDrawer();
  initCopyLink();
  initToTop();
  initReadProgress();
  initToc();
  initCodeCopy();
  initLightbox();
  initSearch();
  initLazyImages();
  initComments();
  initRouter();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}
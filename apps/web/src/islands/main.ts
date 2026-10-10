/**
 * 前台交互岛入口 —— 渐进增强。
 *
 * 原则：SSR 已输出全部内容与结构，本脚本只负责「行为」，不负责「内容」。
 * 即使 JS 加载失败，文章仍可正常阅读（SEO 与可访问性不依赖 JS）。
 */

const THEME_KEY = 'mb-theme';

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

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close();
  });

  window.addEventListener('resize', () => {
    if (window.innerWidth > 900) close();
  });
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

  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll);
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

  window.addEventListener(
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

  document.addEventListener('keydown', (e) => {
    if (box.dataset.open !== 'true') return;
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowRight') show(index + 1);
    else if (e.key === 'ArrowLeft') show(index - 1);
  });

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

/** 启动全部交互岛 */
function boot(): void {
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
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}
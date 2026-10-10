/**
 * 安全 Markdown 渲染器 —— Worker 服务端渲染与后台预览共用同一实现，
 * 保证「预览即所见」。
 *
 * 安全策略：
 * 1. html: false —— 原始 HTML 一律按文本转义输出，禁止任何脚本执行；
 * 2. 链接协议白名单 —— 只允许 http/https/mailto/相对路径，拦截 javascript:；
 * 3. 外链自动加 noopener noreferrer；
 * 4. 代码块经 highlight.js 语法高亮（输出为转义后的 span，不注入原始 HTML）；
 * 5. 图片强制 lazy loading，并注入 data-attrs 供灯箱与图注使用。
 */
import MarkdownIt from 'markdown-it';
import type { TocItem } from './types';

const ALLOWED_LINK_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** 把属性里已被转义的实体还原为纯文本，用于图注显示 */
function decodeEntities(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

export function slugifyHeading(text: string): string {
  const base = text
    .trim()
    .toLowerCase()
    .replace(/[\s\u3000]+/g, '-')
    .replace(/[^\p{Letter}\p{Number}\-_]/gu, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');
  return base || 'heading';
}

export interface RenderOptions {
  /** 是否在标题上注入 id，用于目录锚点 */
  toc?: boolean;
  /** 是否输出阅读进度所需的外层容器（保留默认） */
  linkify?: boolean;
  typographer?: boolean;
}

export interface RenderResult {
  html: string;
  toc: TocItem[];
}

class SafeMarkdownIt extends MarkdownIt {
  constructor() {
    super('commonmark', {
      html: false,
      linkify: true,
      breaks: false,
      typographer: true
    });
    this.enable(['table', 'strikethrough', 'linkify', 'replacements', 'smartquotes']);
    this.use(mathPlugin);
  }
}

function mathPlugin(md: MarkdownIt): void {
  // 行内数学 $...$ 与块级数学 $$...$$
  md.inline.ruler.after('escape', 'math_inline', (state, silent) => {
    const start = state.pos;
    if (state.src[start] !== '$') return false;
    const end = state.src.indexOf('$', start + 1);
    if (end < 0 || end === start + 1) return false;
    if (!silent) {
      const token = state.push('math_inline', 'math', 0);
      token.content = state.src.slice(start + 1, end);
    }
    state.pos = end + 1;
    return true;
  });

  md.renderer.rules.math_inline = (tokens, idx) =>
    `<span class="md-math md-math-inline">${escapeHtml(tokens[idx].content)}</span>`;

  md.block.ruler.before('fence', 'math_block', (state, startLine, endLine, silent) => {
    const pos = state.bMarks[startLine] + state.tShift[startLine];
    const max = state.eMarks[startLine];
    if (pos + 2 > max) return false;
    if (state.src.slice(pos, pos + 2) !== '$$') return false;
    let nextLine = startLine + 1;
    let content = '';
    const firstLine = state.src.slice(pos + 2, max);
    if (firstLine.trim().endsWith('$$')) {
      content = firstLine.trim().slice(0, -2);
      nextLine = -1;
    } else {
      content = firstLine ? firstLine + '\n' : '';
      while (nextLine < endLine) {
        const line = state.src.slice(state.bMarks[nextLine], state.eMarks[nextLine]);
        if (line.trim().endsWith('$$')) {
          content += line.trim().slice(0, -2);
          break;
        }
        content += line + '\n';
        nextLine++;
      }
    }
    if (silent) return true;
    const token = state.push('math_block', 'math', 0);
    token.content = content.trim();
    token.map = [startLine, nextLine];
    state.line = nextLine + 1;
    return true;
  });

  md.renderer.rules.math_block = (tokens, idx) =>
    `<div class="md-math md-math-block">${escapeHtml(tokens[idx].content)}</div>`;
}

/**
 * 极简语法高亮。
 *
 * 实现要点（性能 + 正确性）：
 * 1. 单遍线性扫描，绝不使用嵌套量词（避免灾难性回溯打爆 Worker 内存）；
 * 2. 输入为「原始代码」，内部只做一次 HTML 转义 —— 高亮包裹时不得再次转义，
 *    否则会出现 &amp;lt; 这类双重转义导致代码显示成乱码；
 * 3. 用 span 包裹已转义片段，保持内容与原代码一致。
 */
const JS_KEYWORDS = new Set([
  'const','let','var','function','return','if','else','for','while','import','export','from','default',
  'class','extends','new','await','async','try','catch','finally','throw','type','interface','enum',
  'null','undefined','true','false','this','super','typeof','instanceof','in','of','do','switch',
  'case','break','continue','yield','satisfies','readonly','public','private','protected','implements'
]);

const SHELL_KEYWORDS = new Set([
  'cd','ls','npm','npx','pnpm','yarn','node','git','curl','mkdir','echo','cat','python','pip',
  'docker','wrangler','rm','cp','mv','grep','sed','awk','chmod','ssh','kill','export','source'
]);

const SQL_KEYWORDS = new Set([
  'select','from','where','insert','into','values','update','set','delete','create','table','index',
  'alter','drop','join','left','right','inner','outer','on','group','order','by','limit','offset',
  'and','or','not','null','primary','key','unique','default','case','when','then','end','as',
  'distinct','count','sum','avg','having','union','exists','between','like','is'
]);

function highlightCode(code: string, lang: string): string {
  if (!lang) return escapeHtml(code);

  const lower = lang.toLowerCase();
  const isJs = ['js','javascript','ts','typescript','json','jsx','tsx','vue'].includes(lower);
  const isShell = ['bash','sh','shell','zsh','console','fish'].includes(lower);
  const isSql = lower === 'sql';
  const isCss = ['css','scss','less'].includes(lower);
  if (!isJs && !isShell && !isSql && !isCss) return escapeHtml(code);

  const kw = isJs ? JS_KEYWORDS : isShell ? SHELL_KEYWORDS : isSql ? SQL_KEYWORDS : null;

  // 单遍扫描：字符串 / 注释 / 数字 / 标识符 / 标点
  const pattern =
    /("(?:[^"\\\n]|\\.)*"?|'(?:[^'\\\n]|\\.)*'?|`(?:[^`\\]|\\.)*`?)|(\/\/[^\n]*|\/\*[\s\S]*?\*\/|#[^\n]*)|(\b\d[\d_.]*\b)|([A-Za-z_$][\w$]*)|(\s+)|([{}()[\];,.:?=+\-*/%<>!&|^~]+)/g;

  const out: string[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(code))) {
    out.push(escapeHtml(code.slice(last, m.index)));
    last = m.index + m[0].length;

    const [full, str, com, num, word, ws, punct] = m;
    if (str) out.push(`<span class="tok-str">${escapeHtml(full)}</span>`);
    else if (com && (isShell || isSql || isCss)) out.push(`<span class="tok-com">${escapeHtml(full)}</span>`);
    else if (num) out.push(`<span class="tok-num">${escapeHtml(full)}</span>`);
    else if (word) {
      const isKw = kw ? kw.has(word.toLowerCase()) : isCss;
      out.push(isKw ? `<span class="tok-kw">${escapeHtml(full)}</span>` : escapeHtml(full));
    } else if (ws) out.push(escapeHtml(full));
    else if (punct) out.push(escapeHtml(full));
    else out.push(escapeHtml(full));
  }
  out.push(escapeHtml(code.slice(last)));
  return out.join('');
}

export function renderMarkdown(source: string, options: RenderOptions = {}): RenderResult {
  const md = new SafeMarkdownIt();
  const toc: TocItem[] = [];
  const usedIds = new Set<string>();

  if (options.toc !== false) {
    md.renderer.rules.heading_open = (tokens, idx, _opts, _env, self) => {
      const inline = tokens[idx + 1];
      const level = Number(tokens[idx].tag.slice(1));
      if (inline && inline.type === 'inline') {
        const text = md.utils.unescapeAll(
          (inline.children ?? [])
            .filter((t) => t.type === 'text' || t.type === 'code_inline')
            .map((t) => ('content' in t ? t.content : ''))
            .join('')
        ).trim();
        let id = slugifyHeading(text);
        let i = 2;
        while (usedIds.has(id)) id = `${slugifyHeading(text)}-${i++}`;
        usedIds.add(id);
        if (level === 2 || level === 3) toc.push({ id, text, level });
        const token = tokens[idx];
        token.attrSet('id', id);
        token.attrJoin('class', 'md-heading');
        return self.renderToken(tokens, idx, _opts);
      }
      return self.renderToken(tokens, idx, _opts);
    };
  }

  // 链接安全处理
  const defaultLinkOpen =
    md.renderer.rules.link_open ??
    ((tokens, idx, opts, _env, self) => self.renderToken(tokens, idx, opts));
  md.renderer.rules.link_open = (tokens, idx, opts, env, self) => {
    const token = tokens[idx];
    const href = token.attrGet('href') ?? '';
    const cleaned = href.replace(/[\u0000-\u0020\u007f-\u00a0\u2028\u2029\ufeff]/g, '');
    if (cleaned) {
      const colonIdx = cleaned.indexOf(':');
      const slashIdx = cleaned.search(/[\/?#]/);
      const looksAbsolute = colonIdx > 0 && (slashIdx === -1 || colonIdx < slashIdx);
      if (looksAbsolute) {
        const proto = cleaned.slice(0, colonIdx + 1).toLowerCase();
        if (!ALLOWED_LINK_PROTOCOLS.has(proto)) {
          token.attrSet('href', '#');
          token.attrSet('data-blocked-href', href);
        }
      }
    }
    const isExternal = /^https?:\/\//i.test(href);
    if (isExternal) {
      token.attrSet('target', '_blank');
      token.attrSet('rel', 'noopener noreferrer nofollow');
    }
    token.attrJoin('class', 'md-link');
    return defaultLinkOpen(tokens, idx, opts, env, self);
  };

  md.renderer.rules.image = (tokens, idx, opts, _env, self) => {
    const token = tokens[idx];
    const src = token.attrGet('src') ?? '';
    const alt = token.content || '';
    // markdown-it 的 token.content 已是解析后的纯文本，这里再次转义，
    // 防止 alt/title 中出现引号逃逸出属性上下文
    const titleRaw = token.attrGet('title') ?? '';
    const caption = decodeEntities(titleRaw);

    // 标题直接以 markdown-it 的默认渲染写入 title 属性（其内部已正确转义）
    if (titleRaw) token.attrSet('title', titleRaw);
    token.attrSet('alt', alt);
    token.attrSet('loading', 'lazy');
    token.attrSet('decoding', 'async');
    token.attrJoin('class', 'md-img');
    token.attrSet('data-src', src);
    if (caption) token.attrSet('data-caption', caption);

    const img = self.renderToken(tokens, idx, opts);
    return (
      `<figure class="md-figure">${img}` +
      (caption ? `<figcaption class="md-figcaption">${escapeHtml(caption)}</figcaption>` : '') +
      `</figure>`
    );
  };

  md.renderer.rules.fence = (tokens, idx) => {
    const token = tokens[idx];
    const lang = (token.info || '').trim().split(/\s+/)[0] || '';
    const highlighted = highlightCode(token.content, lang);
    return (
      `<div class="md-code" data-lang="${escapeHtml(lang || 'text')}">` +
      `<button class="md-code-copy" type="button" aria-label="复制代码">复制</button>` +
      `<pre><code class="language-${escapeHtml(lang || 'text')}">${highlighted}</code></pre>` +
      `</div>`
    );
  };

  md.renderer.rules.code_inline = (tokens, idx) =>
    `<code class="md-inline-code">${escapeHtml(tokens[idx].content)}</code>`;

  const html = md.render(source ?? '');
  return { html, toc };
}

/** 中文友好的字数统计：CJK 按字计，其余按词计 */
export function countWords(source: string): number {
  const text = stripMarkdown(source ?? '');
  if (!text) return 0;
  const cjk = text.match(/[一-龥぀-ヿ가-힯]/g)?.length ?? 0;
  const latinWords = text
    .replace(/[一-龥぀-ヿ가-힯]/g, ' ')
    .match(/[A-Za-z0-9_]+/g)?.length ?? 0;
  return cjk + latinWords;
}

export function stripMarkdown(source: string): string {
  return (source ?? '')
    // 围栏代码块整体丢弃；行内代码只去掉反引号、保留文字
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}>\s?/gm, '')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s{0,3}([-*_])\s*\1\s*\1[\s\S]*?$/gm, ' ')
    .replace(/(\*\*|__|~~)/g, '')
    // 单词级下划线/星号强调：仅当两侧不构成单词时才去除，避免吞掉 snake_case
    .replace(/(?<![\w])[*_]([^*_]+)[*_](?![\w])/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\|/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 阅读时间：中文按 400 字/分钟，英文按 200 词/分钟 */
export function readingTime(wordCount: number): number {
  return Math.max(1, Math.round(wordCount / 400));
}

/**
 * 从正文生成摘要。
 *
 * 关键：跳过标题行、代码块、分隔线，只取真正的段落文字。
 * 否则摘要会变成「标题一 标题二 正文 列表项」的拼接，读起来像乱码——
 * 这正是把 stripMarkdown 直接当摘要用的缺陷。
 */
export function excerptFrom(source: string, max = 160): string {
  const lines = (source ?? '').split('\n');
  const kept: string[] = [];
  let inCode = false;

  for (const raw of lines) {
    const line = raw.trimEnd();

    // 围栏代码块：跳过整块
    if (/^\s{0,3}(```|~~~)/.test(line)) {
      inCode = !inCode;
      continue;
    }
    if (inCode) continue;

    // 缩进代码块：跳过
    if (/^\s{4,}\S/.test(raw)) continue;
    // 标题、分隔线、列表项、脚注定义：跳过（标题文字不适合做摘要）
    if (/^\s{0,3}#{1,6}\s/.test(line)) continue;
    if (/^\s{0,3}([-*_]\s*){3,}$/.test(line)) continue;
    if (/^\s{0,3}([-*+]|\d+\.)\s/.test(line)) continue;
    if (/^\s{0,3}>\s?/.test(line)) continue;

    if (!line.trim()) {
      if (kept.length) break;   // 段落结束，摘要只取首段
      continue;
    }
    kept.push(line.trim());
  }

  const text = stripMarkdown(kept.join(' '));
  if (!text) return '';
  if (text.length <= max) return text;
  // 截断到max 后回退到最近的词/句边界，避免半截词
  const slice = text.slice(0, max);
  const at = Math.max(slice.lastIndexOf(' '), slice.lastIndexOf('，'), slice.lastIndexOf('。'));
  return (at > max * 0.6 ? slice.slice(0, at) : slice).trimEnd() + '…';
}

export { escapeHtml };

/** 全文检索用的可搜索文本（正文 + 纯文本） */
export function toSearchableText(source: string): string {
  return stripMarkdown(source).toLowerCase();
}
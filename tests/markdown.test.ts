import { describe, it, expect } from 'vitest';
import {
  renderMarkdown,
  countWords,
  readingTime,
  excerptFrom,
  slugifyHeading,
  stripMarkdown,
  escapeHtml
} from '../packages/shared/src/markdown';

describe('Markdown 安全渲染', () => {
  it('渲染标题并生成目录锚点', () => {
    const { html, toc } = renderMarkdown('# 标题一\n\n## 小节 A\n\n正文\n\n### 更深层\n');
    expect(html).toContain('<h1');
    expect(html).toContain('id="');
    expect(toc).toHaveLength(2);
    expect(toc[0].level).toBe(2);
    expect(toc[1].level).toBe(3);
  });

  it('重复标题生成唯一锚点', () => {
    const { toc } = renderMarkdown('## 重复\n\n内容\n\n## 重复\n');
    expect(toc[0].id).not.toBe(toc[1].id);
  });

  it('禁止原始 HTML 执行（转义为文本）', () => {
    const { html } = renderMarkdown('<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>');
    expect(html).not.toContain('<script>');
    // 标签被转义为实体文本，不形成可执行标签
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('拦截 javascript: 协议链接', () => {
    // markdown-it 会把该链接整体视为纯文本（不生成 <a>），同样安全
    const { html } = renderMarkdown('[点我](javascript:alert(1))');
    expect(html).not.toContain('href="javascript:');
    expect(html).not.toMatch(/<a[^>]*href=["']javascript:/i);
  });

  it('拦截 javascript: 协议链接（HTML 实体绕过）', () => {
    const { html } = renderMarkdown('[点我](javascript&#58;alert(1))');
    expect(html).not.toMatch(/<a[^>]*href=["']javascript:/i);
  });

  it('保留安全的 http 链接并加上 noopener', () => {
    const { html } = renderMarkdown('[示例](https://example.com)');
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain('rel="noopener noreferrer nofollow"');
    expect(html).toContain('target="_blank"');
  });

  it('允许相对路径链接', () => {
    const { html } = renderMarkdown('[内部](/posts/hello)');
    expect(html).toContain('href="/posts/hello"');
  });

  it('代码块注入复制按钮与语言标记', () => {
    const { html } = renderMarkdown('```js\nconst a = 1;\n```');
    expect(html).toContain('md-code-copy');
    expect(html).toContain('data-lang="js"');
    expect(html).toContain('language-js');
  });

  it('代码块内的 HTML 被转义，不产生可执行标签', () => {
    const { html } = renderMarkdown('```html\n<script>alert(1)</script>\n```');
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('渲染表格、列表、引用、删除线', () => {
    const { html } = renderMarkdown('| a | b |\n|---|---|\n| 1 | 2 |\n\n- 项目\n\n1. 有序\n\n> 引用\n\n~~删除~~');
    expect(html).toContain('<table>');
    expect(html).toContain('<ul>');
    expect(html).toContain('<ol>');
    expect(html).toContain('<blockquote>');
    expect(html).toContain('<s>删除</s>');
  });

  it('图片带懒加载与灯箱所需属性', () => {
    const { html } = renderMarkdown('![说明文字](https://example.com/a.png "图片标题")');
    expect(html).toContain('loading="lazy"');
    expect(html).toContain('md-figure');
    expect(html).toContain('图片标题');
    expect(html).toContain('md-figcaption');
  });

  it('支持行内数学公式', () => {
    const { html } = renderMarkdown('质能方程 $E = mc^2$ 很有名。');
    expect(html).toContain('md-math-inline');
    expect(html).toContain('E = mc^2');
  });

  it('支持块级数学公式', () => {
    const { html } = renderMarkdown('$$\n\\int_0^1 x dx\n$$');
    expect(html).toContain('md-math-block');
  });

  it('空内容不报错', () => {
    expect(() => renderMarkdown('')).not.toThrow();
    expect(renderMarkdown('').html).toBe('');
  });

  it('HTML 特殊字符被正确转义', () => {
    const { html } = renderMarkdown('a < b & c > d');
    expect(html).toContain('&lt;');
    expect(html).toContain('&amp;');
    expect(html).toContain('&gt;');
  });
});

describe('中文字数与阅读时间', () => {
  it('中文按字计数', () => {
    expect(countWords('你好世界')).toBe(4);
  });

  it('英文按词计数', () => {
    expect(countWords('hello world foo')).toBe(3);
  });

  it('中英混合正确计数', () => {
    expect(countWords('你好 world')).toBe(3);
  });

  it('忽略 Markdown 语法符号', () => {
    expect(countWords('**加粗** ## 标题')).toBe(4);
  });

  it('代码块内容不计入字数', () => {
    expect(countWords('```js\nconst a = 1;\n```\n正文')).toBe(2);
  });

  it('阅读时间至少为 1 分钟', () => {
    expect(readingTime(0)).toBe(1);
    expect(readingTime(10)).toBe(1);
    expect(readingTime(800)).toBe(2);
  });

  it('摘要截断并加省略号', () => {
    const long = '一'.repeat(300);
    const excerpt = excerptFrom(long, 50);
    expect(excerpt.length).toBeLessThanOrEqual(51);
    expect(excerpt.endsWith('…')).toBe(true);
  });

  it('短内容摘要不截断', () => {
    expect(excerptFrom('短内容', 100)).toBe('短内容');
  });

  it('stripMarkdown 提取纯文本', () => {
    expect(stripMarkdown('# 标题\n\n**加粗** 和 [链接](https://a.com)')).toBe('标题 加粗 和 链接');
  });
});

describe('工具函数', () => {
  it('标题锚点 slug 化', () => {
    expect(slugifyHeading('Hello World')).toBe('hello-world');
    expect(slugifyHeading('中文标题')).toBe('中文标题');
  });

  it('HTML 转义函数', () => {
    expect(escapeHtml('<a href="x">&</a>')).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;');
  });
});
describe('摘要生成（回归：不得把标题/列表拼进摘要）', () => {
  it('跳过标题行，只取正文段落', () => {
    const md = '## Section One\n\nHello **world** with `code`.\n\n### Sub section\n\n- item one\n- item two';
    const ex = excerptFrom(md);
    expect(ex).toBe('Hello world with code.');
    expect(ex).not.toContain('Section One');
    expect(ex).not.toContain('Sub section');
    expect(ex).not.toContain('item one');
  });

  it('跳过代码块内容', () => {
    const md = '正文第一段。\n\n```js\nconst secret = "should not appear";\n```\n\n第二段。';
    const ex = excerptFrom(md);
    expect(ex).toContain('正文第一段');
    expect(ex).not.toContain('secret');
  });

  it('跳过缩进代码块', () => {
    const ex = excerptFrom('标题\n\n正文内容\n\n    indented code line');
    expect(ex).not.toContain('indented');
  });

  it('跳过引用块与分隔线', () => {
    const ex = excerptFrom('---\n\n> 这是引用\n\n实际正文内容');
    expect(ex).toBe('实际正文内容');
  });

  it('首段超长时按词边界截断', () => {
    const long = 'word '.repeat(100);
    const ex = excerptFrom(long, 50);
    expect(ex.length).toBeLessThanOrEqual(51);
    expect(ex.endsWith('…')).toBe(true);
    expect(ex).not.toContain('wor…');
  });

  it('无正文时返回空串而非拼接标题', () => {
    expect(excerptFrom('## 只有标题')).toBe('');
    expect(excerptFrom('')).toBe('');
  });

  it('去除行内格式但保留文字', () => {
    const ex = excerptFrom('**粗体** 与 [链接](https://a.com) 与 `代码`');
    expect(ex).toBe('粗体 与 链接 与 代码');
  });
});

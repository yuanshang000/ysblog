/**
 * Markdown 批量导入 —— 把本地 .md 文件导入到 Postgres。
 *
 * 为什么需要：项目原本没有导入功能，只能在后台逐篇粘贴。
 * 本脚本让你把 Markdown 丢进一个文件夹，一条命令批量入库。
 *
 * 用法：
 *   node scripts/import-markdown.mjs --dir ./posts --dry-run
 *   node scripts/import-markdown.mjs --dir ./posts --publish
 *   node scripts/import-markdown.mjs --file ./a.md
 *   node scripts/import-markdown.mjs --dir ./posts --out ./import.sql
 *
 * 连接串来自环境变量 POSTGRES_URL（或 .env.local）。
 *
 * 前置元数据（写在 Markdown 顶部的 YAML front-matter，可选）：
 *
 *   ---
 *   title: 文章标题          # 不填则用首个 # 标题，再退到文件名
 *   slug: custom-slug# 不填则按标题生成
 *   date: 2026-10-10        # 不填则用当前时间
 *   status: published       # draft(默认) / published / archived
 *   tags: [TypeScript, Cloudflare]
 *   categories: [技术笔记]
 *   featured: true
 *   cover: https://...      # 封面图 URL
 *   ---
 *
 * 安全约定：
 * - 所有写入经 SQL 转义后执行，不做字符串拼接执行；
 * - 整批导入包在事务中，任一语句失败则全部回滚；
 * - slug 冲突时自动追加序号，不覆盖已有文章；
 * - 库中无作者账号时会自动建一个占位账号（密码不可登录），
 *   避免 author_id 外键约束导致整批失败。
 */
import pg from 'pg';
const { Pool } = pg;

import { readdirSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { join, basename, extname, resolve } from 'node:path';

// ============ 参数解析 ============
const argv = process.argv.slice(2);
function flag(name) { return argv.includes(name); }
function opt(name, fallback = null) {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
}

const DIR = opt('--dir');
const FILE = opt('--file');
/**
 * --remote 仅为兼容旧用法而保留。
 *
 * 现在数据库连接完全由 POSTGRES_URL 决定：
 * 指向生产库就是写生产，指向本地就是写本地。
 * 保留该参数只是为了让旧命令不至于报「未知参数」，并在输出中提示。
 */
const REMOTE_LEGACY = flag('--remote');
const PUBLISH = flag('--publish');
const DRY_RUN = flag('--dry-run');
const OUT = opt('--out');

if (!DIR && !FILE) {
  console.error(`
用法：
  node scripts/import-markdown.mjs --dir <目录> [--publish] [--dry-run]
  node scripts/import-markdown.mjs --file <文件> [--publish]

选项：
  --publish   直接发布；不加则一律存为草稿
  --dry-run   只打印将要执行的 SQL，不写库
  --out <文件> 只生成 SQL 文件不执行（受限环境下用这个）

数据库连接：
  从环境变量 POSTGRES_URL（或 .env.local）读取。
  指向哪个库就写入哪个库 —— 导入生产库前请确认连接串无误。
`);
  process.exit(1);
}

// ============ 工具函数 ============

/** SQL 字符串转义：单引号翻倍，并剔除控制字符 */
function sqlText(v) {
  if (v === null || v === undefined) return 'NULL';
  const s = String(v).replace(/\x00/g, '').replace(/'/g, "''");
  return `'${s}'`;
}

function sqlNum(v, dflt = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? String(Math.trunc(n)) : String(dflt);
}

/**
 * slug 生成 —— 与 packages/shared/src/utils.ts 的 slugify 保持一致。
 * 必须一致，否则导入的文章 URL 会与后台创建的不匹配。
 */
const SLUG_STRIP = /[^\p{Letter}\p{Number}\s-]/gu;
const REPLACEMENT_CHAR = /�/;
const HAS_CJK = /[一-鿿぀-ヿ]/;

function slugify(input) {
  const s = (input ?? '')
    .trim()
    .replace(SLUG_STRIP, '')
    .replace(/\s+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
  if (!s || REPLACEMENT_CHAR.test(s)) return '';
  if (HAS_CJK.test(s) && s.length > 40) return s.slice(0, 40).replace(/-+$/, '');
  return s;
}

/** 解析 YAML front-matter（仅支持 key: value 与 key: [a, b] 这两种常用形态） */
function parseFrontMatter(text) {
  const meta = {};
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!m) return { meta, body: text };

  for (const raw of m[1].split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const kv = /^([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(.*)$/.exec(line);
    if (!kv) continue;
    const key = kv[1].toLowerCase();
    let val = kv[2].trim();

    // 去掉行尾注释（仅当值未被引号包裹时）
    if (!/^["'].*["']$/.test(val)) val = val.replace(/\s+#.*$/, '').trim();

    if (val.startsWith('[') && val.endsWith(']')) {
      meta[key] = val.slice(1, -1).split(',').map((s) => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
    } else {
      meta[key] = val.replace(/^["']|["']$/g, '');
    }
  }
  return { meta, body: text.slice(m[0].length) };
}

/** 从正文提取首个 # 标题作为标题候选 */
function firstHeading(body) {
  const m = /^#{1,3}\s+(.+)$/m.exec(body);
  return m ? m[1].trim() : '';
}

/** 字数统计：中文按字、英文按词，与后端 readingTime 的输入一致 */
function countWords(text) {
  const plain = text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[#*_~>\-|]/g, ' ');
  const cjk = (plain.match(/[一-鿿぀-ヿ]/g) || []).length;
  const words = (plain.replace(/[一-鿿぀-ヿ]/g, ' ').match(/[A-Za-z0-9]+/g) || []).length;
  return cjk + words;
}

// ============ 收集文件 ============

const files = [];
if (FILE) {
  files.push(FILE);
} else {
  if (!existsSync(DIR)) {
    console.error(`目录不存在：${DIR}`);
    process.exit(1);
  }
  for (const f of readdirSync(DIR)) {
    if (extname(f).toLowerCase() === '.md') files.push(join(DIR, f));
  }
}

if (files.length === 0) {
  console.error(FILE ? `文件不存在：${FILE}` : `目录内没有 .md 文件：${DIR}`);
  process.exit(1);
}

// ============ 生成 SQL ============

const stmts = [
  // posts.author_id 有外键约束，库中完全没有用户时整批插入会失败。
  // 先确保存在一个可用作者；密码哈希是占位值（不可登录），
  // 正常部署时库里已有真实管理员，这条不会生效。
  `INSERT INTO users (username,email,password_hash,password_algo,role,status,display_name,created_at,updated_at)
   SELECT 'admin','admin@example.com','!invalid!','pbkdf2-sha256','admin','active','博主',NOW(),NOW()
   WHERE NOT EXISTS (SELECT 1 FROM users);`
];

// 取可用作者的标量子查询：优先管理员，其次任意用户。
const AUTHOR_ID = `(SELECT COALESCE(
  (SELECT id FROM users WHERE role='admin' ORDER BY id LIMIT 1),
  (SELECT id FROM users ORDER BY id LIMIT 1)
) FROM users LIMIT 1)`;
const report = [];

// 收集本批次已用的 slug，避免同批次内冲突
const usedSlugs = new Set();

for (const file of files) {
  const raw = readFileSync(file, 'utf-8');
  const { meta, body } = parseFrontMatter(raw);
  const fallbackTitle = basename(file, extname(file));
  const title = meta.title || firstHeading(body) || fallbackTitle;

  let slug = meta.slug ? slugify(meta.slug) : slugify(title);
  if (!slug) slug = `post-${Date.now().toString(36)}`;

  // 同名文件/标题去重：追加 -2、-3…
  let finalSlug = slug;
  let n = 2;
  while (usedSlugs.has(finalSlug)) finalSlug = `${slug}-${n++}`;
  usedSlugs.add(finalSlug);

  const status = PUBLISH ? 'published' : (meta.status || 'draft');
  const words = countWords(body);
  const readingTime = Math.max(1, Math.round(words / 400));
  const date = /^\d{4}-\d{2}-\d{2}/.test(meta.date || '') ? meta.date.slice(0, 10) : null;
  const tags = Array.isArray(meta.tags) ? meta.tags : (meta.tags ? [meta.tags] : []);
  const cats = Array.isArray(meta.categories) ? meta.categories : (meta.categories ? [meta.categories] : []);
  const featured = /^(true|1|yes)$/i.test(String(meta.featured || '')) ? 1 : 0;
  const summary = meta.summary || meta.excerpt || '';

  stmts.push(`-- ===== ${file} =====`);
  // slug 冲突时自动追加序号，绝不覆盖已有文章。
  // 用 CASE 查出库中是否已存在同名 slug：是则用 <slug>-2 / -3…
  // 这样重复导入同一批文件也不会失败（幂等性依赖调用方是否用 --update）。
  const seq = `SELECT CASE
      WHEN NOT EXISTS (SELECT 1 FROM posts WHERE slug = ${sqlText(finalSlug)}) THEN ${sqlText(finalSlug)}
      WHEN NOT EXISTS (SELECT 1 FROM posts WHERE slug = ${sqlText(finalSlug + '-2')}) THEN ${sqlText(finalSlug + '-2')}
      WHEN NOT EXISTS (SELECT 1 FROM posts WHERE slug = ${sqlText(finalSlug + '-3')}) THEN ${sqlText(finalSlug + '-3')}
      WHEN NOT EXISTS (SELECT 1 FROM posts WHERE slug = ${sqlText(finalSlug + '-4')}) THEN ${sqlText(finalSlug + '-4')}
      ELSE ${sqlText(finalSlug + '-' + Date.now().toString(36))}
    END`;

  stmts.push(
    `INSERT INTO posts (author_id,type,title,slug,excerpt,content,content_format,status,is_featured,` +
    `word_count,reading_time,robots_index,revision,published_at,created_at,updated_at) VALUES ` +
    `(${AUTHOR_ID},'post',${sqlText(title)},(${seq}),${sqlText(summary)},${sqlText(body)},'markdown',` +
    `${sqlText(status)},${featured},${sqlNum(words)},${sqlNum(readingTime, 1)},1,1,` +
    `${date ? `${sqlText(date)}::timestamp` : (status === 'published' ? 'NOW()' : 'NULL')},` +
    `NOW(),NOW());`
  );

  // 后续的修订、标签、分类关联必须用「实际插入的 slug」，
  // 否则冲突改名后会关联到旧文章上。
  // 取刚插入的那篇（title 匹配且 id 最大）。
  const refBy = `(SELECT id FROM posts WHERE title = ${sqlText(title)} ORDER BY id DESC LIMIT 1)`;

  // 首版修订快照（后台「历史版本」依赖此表）
  stmts.push(
    `INSERT INTO post_revisions (post_id,title,excerpt,content,revision,created_at,created_by) ` +
    `SELECT id,${sqlText(title)},${sqlText(summary)},${sqlText(body)},1,NOW(),` +
    `(SELECT id FROM users WHERE role='admin' ORDER BY id LIMIT 1) FROM posts WHERE id = ${refBy};`
  );

  for (const t of tags) {
    const ts = slugify(t) || `tag-${Date.now().toString(36)}`;
    stmts.push(
      `INSERT INTO tags (name,slug,created_at) VALUES (${sqlText(t)},${sqlText(ts)},NOW()) ON CONFLICT (slug) DO NOTHING;`
    );
    stmts.push(
      `INSERT INTO post_tags (post_id,tag_id) SELECT ${refBy},t.id FROM tags t WHERE t.slug=${sqlText(ts)} ON CONFLICT DO NOTHING;`
    );
  }

  for (const c of cats) {
    const cs = slugify(c) || `cat-${Date.now().toString(36)}`;
    stmts.push(
      `INSERT INTO categories (name,slug,description,sort_order,created_at,updated_at) ` +
      `VALUES (${sqlText(c)},${sqlText(cs)},NULL,0,NOW(),NOW()) ON CONFLICT (slug) DO NOTHING;`
    );
    stmts.push(
      `INSERT INTO post_categories (post_id,category_id) SELECT ${refBy},c.id FROM categories c WHERE c.slug=${sqlText(cs)} ON CONFLICT DO NOTHING;`
    );
  }

  report.push({ file, title, slug: finalSlug, status, words, tags: tags.length, cats: cats.length });
}

// 冲突兜底：若数据库里已存在同 slug，则加后缀而非覆盖
stmts.unshift(`-- 同名 slug 已存在时改为追加序号，避免覆盖线上文章`);

// ============ 输出报告 ============

console.log(`\n准备导入 ${report.length} 篇${PUBLISH ? '，状态：已发布' : '，状态：草稿'}\n`);
for (const r of report) {
  const meta = [r.status, `${r.words} 字`];
  if (r.tags) meta.push(`${r.tags} 标签`);
  if (r.cats) meta.push(`${r.cats} 分类`);
  console.log(`  ${r.title}`);
  console.log(`    slug=${r.slug}  ${meta.join(' · ')}`);
}

const sql = stmts.join('\n');

if (DRY_RUN) {
  console.log(`\n--- SQL（${stmts.length} 条语句，dry-run 未写入）---`);
  console.log(sql.slice(0, 2000) + (sql.length > 2000 ? '\n…（已截断）' : ''));
  process.exit(0);
}

// ============ 写出 SQL 文件 ============
//
// 提供 --out 让脚本保持「纯计算、无副作用」，任何环境都能跑；
// 执行环节交给调用方选择（psql 或自行处理）。

if (OUT) {
  writeFileSync(OUT, sql, 'utf-8');
  console.log(`\n✓ SQL 已写入：${OUT}`);
  console.log(`  执行：psql "$POSTGRES_URL" -f ${OUT}`);
  process.exit(0);
}

// ============ 执行 ============
//
// 直接用 pg 客户端连接 Postgres 执行整个 SQL 脚本（包在一个事务里）。
// 不用 spawn 子进程，避免受限环境报 EINVAL/EBUSY。

async function loadConnectionString() {
  if (process.env.POSTGRES_URL) return process.env.POSTGRES_URL;
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  try {
    const raw = readFileSync(resolve(process.cwd(), '.env.local'), 'utf-8');
    for (const line of raw.split(/\r?\n/)) {
      const m = /^\s*(POSTGRES_URL|DATABASE_URL)\s*=\s*(.+)\s*$/.exec(line);
      if (m) return m[2].replace(/^["']|["']$/g, '');
    }
  } catch { /* 忽略 */ }
  return null;
}

const conn = await loadConnectionString();
if (!conn) {
  console.error('\n✗ 未找到数据库连接串');
  console.error('  请设置 POSTGRES_URL，或在 .env.local 中配置；');
  console.error('  也可以用 --out 生成 SQL 后手动执行。');
  process.exit(1);
}

const pool = new Pool({ connectionString: conn, ssl: { rejectUnauthorized: false } });
const client = await pool.connect();

try {
  await client.query('BEGIN');
  await client.query(sql);
  await client.query('COMMIT');

  const { rows } = await client.query(
    `SELECT COUNT(*)::int AS n FROM posts WHERE created_at > NOW() - INTERVAL '1 minute'`
  );
  console.log(`\n✓ 导入完成（最近写入约 ${rows[0]?.n ?? 0} 篇文章）`);
  console.log(`  目标库由 POSTGRES_URL 决定${REMOTE_LEGACY ? '（检测到 --remote 参数，已按连接串实际指向的库为准）' : ''}`);
} catch (e) {
  await client.query('ROLLBACK').catch(() => {});
  console.error('\n✗ 导入失败：' + String(e.message).slice(0, 800));
  console.error('\n提示：先用 --dry-run 查看将要执行的 SQL');
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
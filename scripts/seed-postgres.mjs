/**
 * 演示数据 —— 针对 Vercel Postgres。
 *
 * 替代原先的 scripts/seed-demo.py（Python + sqlite3）。
 * 关键点：PBKDF2 迭代次数必须与 apps/worker/src/lib/crypto.ts 的
 * ITERATIONS 一致，否则生成的哈希永远无法通过校验，
 * 登录会表现为「用户名或密码错误」，极具误导性。
 *
 * 用法：
 *   npm run seed:demo
 */
import { pbkdf2, randomBytes } from 'node:crypto';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';

const pbkdf2Async = promisify(pbkdf2);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** 必须与 crypto.ts 的 ITERATIONS 保持一致 */
const ITERATIONS = 10_000;
const DEMO_PASSWORD = 'Demo123456';

async function loadConnectionString() {
  if (process.env.POSTGRES_URL) return process.env.POSTGRES_URL;
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  try {
    const raw = await readFile(path.join(__dirname, '..', '.env.local'), 'utf-8');
    for (const line of raw.split(/\r?\n/)) {
      const m = /^\s*(POSTGRES_URL|DATABASE_URL)\s*=\s*(.+)\s*$/.exec(line);
      if (m) return m[2].replace(/^["']|["']$/g, '');
    }
  } catch {
    /* 忽略 */
  }
  return null;
}

async function hashPassword(password) {
  const salt = randomBytes(16);
  const dk = await pbkdf2Async(password, salt, ITERATIONS, 32, 'sha256');
  return `pbkdf2$${ITERATIONS}$${salt.toString('hex')}$${dk.toString('hex')}`;
}

async function main() {
  const conn = await loadConnectionString();
  if (!conn) {
    console.error('✗ 未找到数据库连接串，请设置 POSTGRES_URL 或在 .env.local 中配置');
    process.exit(1);
  }

  const pool = new Pool({ connectionString: conn, ssl: { rejectUnauthorized: false } });

  try {
    // ---- 管理员 ----
    const hash = await hashPassword(DEMO_PASSWORD);
    await pool.query(
      `INSERT INTO users (username, email, password_hash, password_algo, role, status, display_name, created_at, updated_at)
       VALUES ('admin', 'admin@example.com', $1, 'pbkdf2-sha256', 'admin', 'active', '博主', NOW(), NOW())
       ON CONFLICT (username) DO UPDATE SET password_hash = EXCLUDED.password_hash`,
      [hash]
    );

    // ---- 导航菜单 ----
    // 仅站外链接在新窗口打开；站内栏目走页面内路由
    const menus = [
      ['首页', '/', 'header', 1],
      ['文章', '/posts', 'header', 2],
      ['归档', '/archives', 'header', 3],
      ['分类', '/categories', 'header', 4],
      ['标签', '/tags', 'header', 5],
      ['项目', '/projects', 'header', 6],
      ['关于我', '/about', 'header', 7],
      ['友链', '/links', 'header', 8],
      ['RSS', '/api/v1/feed', 'footer', 1],
      ['管理后台', '/admin', 'footer', 2]
    ];

    await pool.query('DELETE FROM menus');
    for (const [label, href, loc, so] of menus) {
      const isExternal = String(href).startsWith('http') ? 1 : 0;
      const openInNew = isExternal ? 1 : 0;
      await pool.query(
        `INSERT INTO menus (label, href, location, sort_order, is_visible, is_external, open_in_new, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 1, $5, $6, NOW(), NOW())`,
        [label, href, loc, so, isExternal, openInNew]
      );
    }

    // ---- 分类与标签 ----
    await pool.query(
      `INSERT INTO categories (name, slug, description, sort_order, created_at, updated_at)
       VALUES ('技术笔记', 'tech', '技术相关的文章与笔记', 1, NOW(), NOW())
       ON CONFLICT (slug) DO NOTHING`
    );
    await pool.query(
      `INSERT INTO categories (name, slug, description, sort_order, created_at, updated_at)
       VALUES ('产品思考', 'product', '产品与设计相关的思考', 2, NOW(), NOW())
       ON CONFLICT (slug) DO NOTHING`
    );

    for (const name of ['TypeScript', 'Cloudflare', '随笔']) {
      const slug = { TypeScript: 'typescript', Cloudflare: 'cloudflare', 随笔: 'essay' }[name];
      await pool.query(
        `INSERT INTO tags (name, slug, created_at) VALUES ($1, $2, NOW()) ON CONFLICT (slug) DO NOTHING`,
        [name, slug]
      );
    }

    // ---- 文章 ----
    const { rows: catRows } = await pool.query('SELECT id, slug FROM categories');
    const catBySlug = Object.fromEntries(catRows.map((r) => [r.slug, r.id]));

    const posts = [
      {
        title: '用 Cloudflare Workers 搭建个人博客',
        slug: 'build-blog-with-workers',
        excerpt: '记录一次从零搭建博客系统的全过程：技术选型、数据模型、安全设计与踩过的坑。',
        category: 'tech',
        tags: ['Cloudflare', 'TypeScript']
      },
      {
        title: '为什么我选择自建博客而不是用现成平台',
        slug: 'why-self-hosted-blog',
        excerpt: '从数据归属、迁移成本、长期可维护性三个角度，聊聊自建博客的真实理由。',
        category: 'product',
        tags: ['随笔']
      },
      {
        title: 'TypeScript 类型体操入门',
        slug: 'typescript-type-tips',
        excerpt: '用几个高频场景说明条件类型、映射类型与模板字面量类型能解决什么问题。',
        category: 'tech',
        tags: ['TypeScript']
      }
    ];

    for (const p of posts) {
      const content = `## 概述

${p.excerpt}

## 要点

| 项目 | 说明 |
| --- | --- |
| 内容存储 | 数据库，版本可追溯 |
| 静态资源 | 对象存储，CDN 分发 |
| 定时任务 | 平台 Cron，无需自建服务器 |

\`\`\`ts
export function greet(name: string): string {
  return \`Hello, \${name}\`;
}
\`\`\`

> 写在最后：技术选型服务于需求，而不是相反。
`;

      const { rows } = await pool.query(
        `INSERT INTO posts (author_id, type, title, slug, excerpt, content, content_format, status,
                            is_featured, word_count, reading_time, revision, published_at, created_at, updated_at)
         SELECT u.id, 'post', $1, $2, $3, $4, 'markdown', 'published', 1, 500, 3, 1, NOW(), NOW(), NOW()
           FROM users u WHERE u.username = 'admin'
         ON CONFLICT (slug) DO UPDATE SET title = EXCLUDED.title, updated_at = NOW()
         RETURNING id`,
        [p.title, p.slug, p.excerpt, content]
      );
      const postId = rows[0]?.id;

      if (postId && p.category) {
        await pool.query(
          `INSERT INTO post_categories (post_id, category_id)
           VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [postId, catBySlug[p.category]]
        );
      }

      if (postId && p.tags) {
        for (const tagName of p.tags) {
          const { rows: t } = await pool.query('SELECT id FROM tags WHERE name = $1', [tagName]);
          if (t[0]) {
            await pool.query(
              `INSERT INTO post_tags (post_id, tag_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
              [postId, t[0].id]
            );
          }
        }
      }
    }

    // ---- 友情链接 ----
    await pool.query('DELETE FROM links');
    const links = [
      ['Cloudflare', 'https://cloudflare.com', '云平台与边缘计算'],
      ['Vercel', 'https://vercel.com', '前端部署平台'],
      ['Vue.js', 'https://vuejs.org', '渐进式 JavaScript 框架']
    ];
    for (let i = 0; i < links.length; i++) {
      const [name, url, desc] = links[i];
      await pool.query(
        `INSERT INTO links (name, url, description, sort_order, is_visible, created_at)
         VALUES ($1, $2, $3, $4, 1, NOW())`,
        [name, url, desc, i + 1]
      );
    }

    console.log('✓ 演示数据已写入：3 篇文章 / 2 个分类 / 5 个标签 / 3 条友链');
    console.log('');
    console.log('  本地登录信息：');
    console.log('    用户名：admin');
    console.log(`    密码：${DEMO_PASSWORD}`);
    console.log('');
    console.log('  ⚠ 这是演示账号，正式使用前请到「站点设置 → 安全」修改密码');
  } catch (err) {
    console.error('✗ 写入失败：', err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main();
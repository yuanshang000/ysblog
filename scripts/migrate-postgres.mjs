/**
 * 数据库迁移 —— 针对 Vercel Postgres（PostgreSQL）。
 *
 * 幂等：重复执行不会报错，也不会破坏已有数据。
 * 用法：
 *   POSTGRES_URL=postgres://... node scripts/migrate-postgres.mjs
 *   或 npm run db:migrate（从 .env.local 读取）
 */
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations', 'postgres');

async function loadConnectionString() {
  if (process.env.POSTGRES_URL) return process.env.POSTGRES_URL;
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;

  // 回退到 .env.local（Vercel 本地开发约定）
  try {
    const raw = await readFile(path.join(__dirname, '..', '.env.local'), 'utf-8');
    for (const line of raw.split(/\r?\n/)) {
      const m = /^\s*(POSTGRES_URL|DATABASE_URL)\s*=\s*(.+)\s*$/.exec(line);
      if (m) return m[2].replace(/^["']|["']$/g, '');
    }
  } catch {
    // 文件不存在则忽略
  }
  return null;
}

async function main() {
  const conn = await loadConnectionString();
  if (!conn) {
    console.error('✗ 未找到数据库连接串');
    console.error('  请设置环境变量 POSTGRES_URL，或在 .env.local 中写入：');
    console.error('    POSTGRES_URL="postgres://user:pass@host/db?sslmode=require"');
    process.exit(1);
  }

  const pool = new Pool({
    connectionString: conn,
    ssl: { rejectUnauthorized: false }
  });

  try {
    // 记录已执行的迁移，避免重复建表
    await pool.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        name       TEXT PRIMARY KEY,
        applied_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);

    const files = (await readdir(MIGRATIONS_DIR))
      .filter((f) => f.endsWith('.sql'))
      .sort();

    if (!files.length) {
      console.log('没有找到迁移文件');
      return;
    }

    const { rows } = await pool.query('SELECT name FROM _migrations');
    const applied = new Set(rows.map((r) => r.name));

    for (const file of files) {
      if (applied.has(file)) {
        console.log(`- 跳过 ${file}（已执行）`);
        continue;
      }

      const sql = await readFile(path.join(MIGRATIONS_DIR, file), 'utf-8');
      console.log(`→ 执行 ${file}`);
      try {
        await pool.query(sql);
        await pool.query('INSERT INTO _migrations (name) VALUES ($1)', [file]);
        console.log(`✓ ${file} 完成`);
      } catch (err) {
        // 幂等：表已存在视为成功（例如从 D1 手工导入过数据的情况）
        if (/already exists/i.test(err.message)) {
          console.warn(`  ! ${file} 中有对象已存在，跳过：${err.message.split('\n')[0]}`);
          await pool.query('INSERT INTO _migrations (name) VALUES ($1) ON CONFLICT DO NOTHING', [file]);
        } else {
          throw err;
        }
      }
    }

    console.log('\n迁移完成');
  } catch (err) {
    console.error('✗ 迁移失败：', err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main();
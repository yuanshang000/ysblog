/**
 * 备份脚本 —— 导出 Postgres 数据库与 Vercel Blob 图片。
 *
 * 用法：
 *   npm run db:backup                    # 使用 .env.local 中的连接串
 *   npm run db:backup -- --no-media      # 只备份数据库，跳过图片
 *
 * 重要：数据库与图片必须成对备份，否则文章会出现坏图。
 *
 * 实现说明：
 * - 数据库用 pg_dump 导出（Postgres 原生工具，质量最高）
 * - 图片从 Blob 的公开 URL 逐个下载，依赖 media 表中的 object_key
 */
import { execFileSync } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import pg from 'pg';

const { Pool } = pg;
const args = process.argv.slice(2);
const skipMedia = args.includes('--no-media');

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

async function loadConnectionString() {
  if (process.env.POSTGRES_URL) return process.env.POSTGRES_URL;
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  try {
    const raw = await readFile(resolve(process.cwd(), '.env.local'), 'utf-8');
    for (const line of raw.split(/\r?\n/)) {
      const m = /^\s*(POSTGRES_URL|DATABASE_URL)\s*=\s*(.+)\s*$/.exec(line);
      if (m) return m[2].replace(/^["']|["']$/g, '');
    }
  } catch {
    /* 忽略 */
  }
  return null;
}

async function main() {
  const conn = await loadConnectionString();
  if (!conn) {
    console.error('✗ 未找到数据库连接串');
    console.error('  请设置 POSTGRES_URL，或在 .env.local 中配置');
    process.exit(1);
  }

  const dir = resolve(process.cwd(), 'backups', stamp());
  await mkdir(dir, { recursive: true });
  console.log(`\n备份目录：${dir}\n`);

  // ---- 1. 数据库导出 ----
  const sqlFile = join(dir, 'database.sql');
  console.log('[1/2] 导出 Postgres 数据库…');
  try {
    execFileSync('pg_dump', [conn, '--clean', '--no-owner', '-f', sqlFile], {
      stdio: 'inherit',
      shell: process.platform === 'win32'
    });
    console.log(`  ✓ ${sqlFile}`);
  } catch (err) {
    console.error('  ✗ pg_dump 执行失败：', err.message);
    console.error('    若本机未安装 PostgreSQL 客户端，可改用 Vercel 终端执行：');
    console.error(`    pg_dump "$POSTGRES_URL" --clean --no-owner > ${sqlFile}`);
    process.exit(1);
  }

  // ---- 2. 图片导出 ----
  if (skipMedia) {
    console.log('\n[2/2] 已跳过图片备份（--no-media）');
  } else {
    const blobBase = process.env.BLOB_BASE_URL;
    if (!blobBase) {
      console.log('\n[2/2] 未配置 BLOB_BASE_URL，跳过图片备份。');
      console.log('     如需备份图片，请在 .env.local 中设置 BLOB_BASE_URL 为 Blob 的公开访问域名。');
    } else {
      const pool = new Pool({ connectionString: conn, ssl: { rejectUnauthorized: false } });
      try {
        const { rows } = await pool.query('SELECT object_key FROM media');
        console.log(`[2/2] 下载 ${rows.length} 个媒体文件…`);

        const keysFile = join(dir, 'media-keys.txt');
        await writeFile(keysFile, rows.map((r) => r.object_key).join('\n'), 'utf-8');

        let ok = 0;
        let failed = 0;
        for (const { object_key } of rows) {
          const target = join(dir, 'media', object_key);
          await mkdir(dirname(target), { recursive: true });
          const url = `${blobBase.replace(/\/$/, '')}/${object_key
            .split('/')
            .map(encodeURIComponent)
            .join('/')}`;
          try {
            const res = await fetch(url);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            await pipeline(Readable.fromWeb(res.body), createWriteStream(target));
            ok++;
          } catch (err) {
            failed++;
            console.warn(`  ! ${object_key}: ${err.message || err}`);
          }
        }

        console.log(`  ✓ 成功 ${ok} 个${failed ? `，失败 ${failed} 个` : ''}`);
        if (failed > 0) {
          console.log(`  失败清单见：${keysFile}（可稍后重试）`);
        }
      } finally {
        await pool.end();
      }
    }
  }

  console.log('\n备份完成。');
  console.log('提示：备份包含用户数据，请勿提交到 Git 仓库。');
}

main().catch((err) => {
  console.error('✗ 备份失败：', err.message);
  process.exit(1);
});
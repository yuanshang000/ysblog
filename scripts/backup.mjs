/**
 * 备份脚本 —— 导出 D1 数据库并同步 R2 图片。
 *
 * 用法：
 *   npm run db:backup                    # 备份到 ./backups/<时间戳>/
 *   npm run db:backup -- --remote        # 备份线上生产库
 *
 * 重要：数据库与图片必须成对备份，否则文章会出现坏图。
 */
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const args = process.argv.slice(2);
const isRemote = args.includes('--remote');
const DB_NAME = 'myblog';
const BUCKET = 'myblog-media';

function stamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

function run(cmd: string): void {
  console.log(`  $ ${cmd}`);
  execSync(cmd, { stdio: 'inherit', shell: process.platform === 'win32' });
}

function main(): void {
  const dir = resolve(process.cwd(), 'backups', stamp());
  mkdirSync(dir, { recursive: true });
  console.log(`\n备份目录：${dir}\n`);

  // 1. 数据库
  const sqlFile = join(dir, 'database.sql');
  const flag = isRemote ? '--remote' : '--local';
  console.log('[1/3] 导出 D1 数据库…');
  try {
    run(`npx wrangler d1 export ${DB_NAME} ${flag} --output "${sqlFile}"`);
  } catch (e) {
    console.error('数据库导出失败：', (e as Error).message);
    console.error('提示：本地库导出前请先执行 npm run db:migrate:local');
    process.exit(1);
  }

  // 2. 图片（仅远程库支持 r2 object sync 的远端到本地方向时使用）
  const mediaDir = join(dir, 'media');
  console.log('\n[2/3] 同步 R2 图片…');
  try {
    run(`npx wrangler r2 object sync ${BUCKET} "${mediaDir}"`);
    console.log(`  图片已保存到：${mediaDir}`);
  } catch (e) {
    console.warn('  图片同步失败：', (e as Error).message);
    console.warn('  可手动执行：npx wrangler r2 object sync ' + BUCKET + ' "' + mediaDir + '"');
  }

  // 3. 记录元信息
  console.log('\n[3/3] 写入备份信息…');
  const meta = {
    createdAt: new Date().toISOString(),
    database: DB_NAME,
    bucket: BUCKET,
    remote: isRemote,
    node: process.version,
    note: '恢复步骤见 docs/backup-restore.md'
  };
  writeFileSync(join(dir, 'backup-meta.json'), JSON.stringify(meta, null, 2), 'utf-8');

  console.log('\n' + '='.repeat(52));
  console.log('✓ 备份完成');
  console.log('='.repeat(52));
  console.log(`数据库：${sqlFile}`);
  console.log(`图片  ：${existsSync(mediaDir) ? mediaDir : '（未同步，请手动执行）'}`);
  console.log('');
  console.log('恢复方法见 docs/backup-restore.md');
  console.log('请把整个目录复制到异地存储（云盘 / 另一台机器）。');
}

main();
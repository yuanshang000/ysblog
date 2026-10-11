/**
 * 初始化管理员脚本 —— 在 Postgres 上创建首个管理员账号。
 *
 * 用法：
 *   npm run db:setup-admin -- --username admin --password 'Passw0rd2026'
 *
 * 连接串读取顺序：POSTGRES_URL → DATABASE_URL → .env.local
 * 密码强度校验与服务端一致：≥10 位且同时含字母与数字。
 * 密码不写入日志与命令历史时，建议使用交互式输入：
 *   npm run db:setup-admin -- --username admin --password-stdin
 */
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import pg from 'pg';
import { hashPassword, PASSWORD_ITERATIONS } from '../apps/worker/src/lib/crypto';

interface Args {
  username: string;
  password?: string;
  email?: string;
  displayName?: string;
  passwordStdin: boolean;
}

function parseArgs(argv: string[]): Args {
  const get = (name: string): string | undefined => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const username = get('username') ?? '';
  return {
    username,
    password: get('password'),
    email: get('email'),
    displayName: get('display-name'),
    passwordStdin: argv.includes('--password-stdin')
  };
}

function assertStrength(pw: string): void {
  if (pw.length < 10) throw new Error('密码至少 10 位');
  if (pw.length > 200) throw new Error('密码过长');
  if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) throw new Error('密码必须同时包含字母和数字');
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(Buffer.from(c));
  return Buffer.concat(chunks).toString('utf8').trim();
}

/** 依次尝试环境变量与 .env.local，取到第一个非空的连接串 */
async function resolveConnectionString(): Promise<string> {
  const fromEnv = process.env.POSTGRES_URL || process.env.DATABASE_URL;
  if (fromEnv) return fromEnv;

  if (existsSync('.env.local')) {
    const raw = await readFile('.env.local', 'utf8');
    const m = raw.match(/^\s*(?:POSTGRES_URL|DATABASE_URL)\s*=\s*(.+)$/m);
    if (m) {
      return m[1].trim().replace(/^["']|["']$/g, '');
    }
  }
  throw new Error('未找到数据库连接串，请设置 POSTGRES_URL 或 DATABASE_URL，或写入 .env.local');
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!/^[A-Za-z0-9_.-]{3,32}$/.test(args.username)) {
    console.error('✗ --username 需为 3-32 位字母、数字、下划线、点或连字符');
    process.exit(1);
  }

  let password = args.password ?? '';
  if (args.passwordStdin || !password) {
    if (!process.stdin.isTTY && !args.password) {
      console.error('✗ 未提供密码。使用 --password <密码> 或 --password-stdin 传入。');
      process.exit(1);
    }
    password = await readStdin();
  }
  try {
    assertStrength(password);
  } catch (e) {
    console.error(`✗ ${(e as Error).message}`);
    process.exit(1);
  }

  const conn = await resolveConnectionString();
  const hash = await hashPassword(password);

  const client = new pg.Client({
    connectionString: conn,
    ssl: process.env.POSTGRES_SSL === 'false' ? false : { rejectUnauthorized: false }
  });

  await client.connect();
  try {
    const exists = await client.query('SELECT 1 FROM users WHERE username = $1', [args.username]);
    if (exists.rowCount && exists.rowCount > 0) {
      console.error(`✗ 用户 ${args.username} 已存在，如需重置密码请走后台「修改密码」`);
      process.exit(1);
    }

    await client.query(
      `INSERT INTO users (username, email, display_name, password_hash, password_algo, role, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'pbkdf2-sha256', 'admin', 'active', NOW(), NOW())`,
      [args.username, args.email ?? null, args.displayName ?? args.username, hash]
    );

    console.log(`✓ 管理员 ${args.username} 创建成功（PBKDF2-SHA256, ${PASSWORD_ITERATIONS} 轮）`);
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(`✗ ${(e as Error).message}`);
  process.exit(1);
});
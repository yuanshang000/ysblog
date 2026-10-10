/**
 * 初始化管理员脚本 —— 在真实 D1 上创建首个管理员账号。
 *
 * 用法（远程库）：
 *   ADMIN_SETUP_TOKEN=xxx npm run setup:admin -- --username admin --password 'Passw0rd2026'
 *
 * 密码强度校验与服务端一致：≥10 位且同时含字母与数字。
 * 密码不写入日志与命令历史时，建议使用交互式输入：
 *   npm run setup:admin -- --username admin --password-stdin
 */
import { hashPassword } from '../apps/worker/src/lib/crypto';

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

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!/^[A-Za-z0-9_.-]{3,32}$/.test(args.username)) {
    console.error('✗ --username 需为 3-32 位字母、数字、下划线、点或连字符');
    process.exit(1);
  }

  let password = args.password ?? '';
  if (args.passwordStdin || !password) {
    if (!process.stdin.isTTY) {
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

  const dbPath = process.env.D1_PATH ?? '.wrangler/state/v3/d1';
  console.log(`ℹ 将在 ${dbPath} 下的本地数据库执行；远程库请使用 wrangler d1 execute --remote`);

  const hash = await hashPassword(password);
  console.log(`✓ 密码已哈希（PBKDF2-SHA256, 210000 轮）`);
  console.log('');
  console.log('请把下面这条命令复制执行，密码哈希不会经过日志：');
  console.log('');
  console.log(
    `npx wrangler d1 execute myblog --remote --command "INSERT INTO users (username, email, display_name, password_hash, password_algo, role, status, created_at, updated_at) VALUES ('${args.username}', ${sqlStr(args.email)}, ${sqlStr(args.displayName ?? args.username)}, '${hash}', 'pbkdf2-sha256', 'admin', 'active', datetime('now'), datetime('now'))"`
  );
  console.log('');
  console.log('或使用初始化 API（需先配置 ADMIN_SETUP_TOKEN secret）：');
  console.log(`  curl -X POST <你的域名>/api/v1/setup -H 'Content-Type: application/json' \\`);
  console.log(`    -d '{"token":"<ADMIN_SETUP_TOKEN>","username":"${args.username}","password":"<你的密码>"}'`);
}

function sqlStr(v?: string): string {
  return v === undefined ? 'NULL' : `'${v.replace(/'/g, "''")}'`;
}

main().catch((e) => {
  console.error(`✗ ${(e as Error).message}`);
  process.exit(1);
});
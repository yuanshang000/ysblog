/**
 * 预编译 Worker 业务代码为 ESM JavaScript。
 *
 * 背景：Vercel 只转译项目根目录下 api/ 里的入口文件，
 * 不会处理 apps/worker/src/** 下的 TypeScript 源码。
 * 若让入口直接 import 这些 .ts，运行时会出现 ERR_MODULE_NOT_FOUND。
 * 因此构建阶段先把整个 worker（含 packages/shared）打包成单文件 ESM，
 * 产物写到 dist-server/_worker.js，入口再以动态 import() 加载它
 * （vercel.json 的 includeFiles 会把该产物带进 Function 包）。
 *
 * 产出：dist-server/_worker.mjs（已内联全部业务代码，外部依赖保持 external 由 node_modules 提供）
 *
 * 注意两点：
 * 1) 产物刻意放在 api/ 之外。Vercel 会把 api/ 下的每个文件都当成独立的
 *    Serverless Function 入口，_worker.mjs 若落在那里会被单独编译并抢占路由。
 * 2) 扩展名必须是 .mjs。仓库根 package.json 未声明 "type": "module"，
 *    若用 .js，Node 会按 CommonJS 解析，遇到 import.meta 直接语法报错。
 */
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { mkdir, access } from 'node:fs/promises';
import path from 'node:path';

const root = path.dirname(fileURLToPath(import.meta.url));
const entry = path.join(root, '..', 'apps', 'worker', 'src', 'index.ts');
const outDir = path.join(root, '..', 'dist-server');
const outfile = path.join(outDir, '_worker.mjs');
// 后台 SPA 外壳：Vercel Function 产物里没有 outputDirectory 指定的 public/，
// 单独用 includeFiles 带app.htm 受「只能写一个路径」限制，
// 因此在打包阶段就把它作为字符串内联进产物。
const adminHtml = path.join(root, '..', 'apps', 'worker', 'public', 'admin', 'app.htm');

await mkdir(outDir, { recursive: true });
await access(adminHtml).catch(() => {
  throw new Error('缺少 apps/worker/public/admin/app.htm，请先运行 npm run build:admin');
});

await build({
  entryPoints: [entry],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  outfile,
  // 运行时依赖（pg / @vercel/blob / markdown-it）留在 node_modules，不打进产物
  packages: 'external',
  sourcemap: false,
  logLevel: 'info',
  loader: {
    // 后台外壳以字符串形式内联，运行时无需再读文件。
    // 注意产物是 app.htm（.htm 而非 .html），两种后缀都要声明。
    '.html': 'text',
    '.htm': 'text'
  },
  banner: {
    js: [
      "import { createRequire as __createRequire } from 'node:module';",
      'const require = __createRequire(import.meta.url);'
    ].join('\n')
  }
});

console.log('✓ worker 预编译完成 → dist-server/_worker.mjs');
/**
 * 构建产物校验 —— CI 中在 deploy 前拦截「资源缺失导致白屏」类问题。
 *
 * 背景：后台入口文件是 app.htm（不是 index.html，原因是早期为兼容本地模拟器
 * 读不到 .html）。若构建配置改动导致该文件缺失，部署后后台会直接白屏，
 * 而deploy 本身不会报错——只能靠这个校验提前拦截。
 *
 * 用法：node scripts/verify-build-assets.mjs
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const PUB = join(ROOT, 'apps/worker/public');

const errors = [];
const warns = [];

/** @param {string} rel 相对路径 @param {number} minBytes 最小体积 */
function mustExist(rel, minBytes) {
  const abs = join(PUB, rel);
  if (!existsSync(abs)) {
    errors.push(`缺少文件：apps/worker/public/${rel}`);
    return false;
  }
  const size = statSync(abs).size;
  if (size < minBytes) {
    errors.push(`文件过小（${size} < ${minBytes} 字节）：apps/worker/public/${rel}`);
    return false;
  }
  return true;
}

// ---- 前台岛脚本 ----
if (mustExist('islands/app.js', 1000)) {
  const js = readFileSync(join(PUB, 'islands/app.js'), 'utf8');
  if (!js.includes('/api/v1')) {
    warns.push('islands/app.js 中未发现 API 调用，交互功能可能未打包进来');
  }
}

// ---- 后台入口（必须是 app.htm，Worker 只读这个）----
const adminEntry = mustExist('admin/app.htm', 300);
if (adminEntry) {
  const html = readFileSync(join(PUB, 'admin/app.htm'), 'utf8');
  if (!/<div id="app"/.test(html)) {
    errors.push('admin/app.htm 缺少挂载点 <div id="app">');
  }
  if (!html.includes('noindex')) {
    warns.push('admin/app.htm 缺少 noindex，后台可能被搜索引擎索引');
  }

  // 校验 HTML 引用的每个资源都真实存在
  const refs = [...html.matchAll(/(?:src|href)="(\/admin\/assets\/[^"]+)"/g)].map((m) => m[1]);
  if (refs.length === 0) {
    errors.push('admin/app.htm 未引用任何 JS 资源，后台无法启动');
  }
  for (const ref of refs) {
    const abs = join(PUB, ref.replace(/^\//, ''));
    if (!existsSync(abs)) {
      errors.push(`admin/app.htm 引用了不存在的资源：${ref}`);
    } else if (statSync(abs).size < 200) {
      errors.push(`资源过小（可能是空文件）：${ref}`);
    }
  }
  console.log(`  后台入口引用 ${refs.length} 个资源，均已校验`);
}

// ---- 汇总 ----
if (warns.length) {
  console.log('\n警告：');
  for (const w of warns) console.log('  ⚠ ' + w);
}

if (errors.length) {
  console.error('\n构建产物校验失败：');
  for (const e of errors) console.error('  ✗ ' + e);
  console.error('\n提示：先执行 npm run build:ci（会clean 后完整重建）');
  process.exit(1);
}

console.log('✓ 构建产物校验通过');
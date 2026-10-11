import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath } from 'node:url';
import { copyFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 后台管理端构建：产出 SPA 到 apps/worker/public/admin/。
 *
 * 关键：产物入口落地为 app.htm 而非 index.html。
 * 原因：服务端在 dev 环境用静态目录提供后台壳，历史上为兼容
 * miniflare 的 .html 处理逻辑而改用 .htm 扩展名（实测 .htm 可正常读取，
 * .html 返回 404）。该命名已沿用至今，保持不变以免破坏既有部署缓存与引用。
 */
export default defineConfig({
  plugins: [
    vue(),
    {
      // 构建结束后把 index.html 复制为 app.htm（见文件头注释）
      name: 'emit-admin-html-as-htm',
      closeBundle() {
        const dir = fileURLToPath(new URL('../worker/public/admin', import.meta.url));
        const from = join(dir, 'index.html');
        const to = join(dir, 'app.htm');
        if (existsSync(from)) copyFileSync(from, to);
      }
    }
  ],
  resolve: {
    // 顺序敏感：精确别名必须在通配别名之前
    alias: [
      {
        find: '@myblog/shared/api-client',
        replacement: fileURLToPath(new URL('../../packages/shared/src/api-client.ts', import.meta.url))
      },
      {
        find: '@myblog/shared',
        replacement: fileURLToPath(new URL('../../packages/shared/src/index.ts', import.meta.url))
      },
      { find: /^@\//, replacement: fileURLToPath(new URL('src/', import.meta.url)) }
    ]
  },
  base: '/admin/',
  build: {
    outDir: '../worker/public/admin',
    // outDir 的父目录同时存放 islands/ 产物，关闭自动清空以免误删同级目录
    emptyOutDir: false,
    target: 'es2020',
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      input: fileURLToPath(new URL('index.html', import.meta.url)),
      output: {
        // 入口文件重命名为 app.htm（见文件头注释）
        entryFileNames: 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name][extname]'
      }
    }
  },
  server: {
    port: 5174,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: false
      }
    }
  }
});
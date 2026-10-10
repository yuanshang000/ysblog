import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath } from 'node:url';

/**
 * 前台构建：产出交互岛脚本到 apps/worker/public/islands/。
 * Worker 在 SSR 时注入这些脚本，实现渐进增强。
 */
export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@myblog/shared': fileURLToPath(new URL('../../packages/shared/src/index.ts', import.meta.url))
    }
  },
  build: {
    outDir: '../worker/public/islands',
    // outDir 的父目录同时存放 admin/ 产物，交由构建脚本分步清空，
    // 这里关闭自动清空以免误删同级目录。
    emptyOutDir: false,
    target: 'es2020',
    minify: 'esbuild',
    rollupOptions: {
      input: fileURLToPath(new URL('src/islands/main.ts', import.meta.url)),
      output: {
        entryFileNames: 'app.js',
        chunkFileNames: '[name].js',
        assetFileNames: '[name][extname]'
      }
    }
  }
});
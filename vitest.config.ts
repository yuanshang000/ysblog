import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@myblog/shared': fileURLToPath(new URL('./packages/shared/src/index.ts', import.meta.url))
    }
  },
  // Windows 下系统临时目录可能无写权限，缓存放到项目内
  cacheDir: fileURLToPath(new URL('./.tmp/vite-cache', import.meta.url)),
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    globals: false,
    reporters: ['default']
  }
});
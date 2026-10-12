/**
 * 让 TypeScript 认识 esbuild 的 text loader 产物。
 *
 * 构建阶段 scripts/build-worker.mjs 配置了 `.htm: 'text'`，
 * 因此 import 进来的后台外壳是一个字符串常量，而不是解析后的 DOM。
 */
declare module '*.htm' {
  const content: string;
  export default content;
}

declare module '*.html' {
  const content: string;
  export default content;
}
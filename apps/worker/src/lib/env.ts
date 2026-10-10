/**
 * 环境变量与绑定类型。
 *
 * 密钥约定（必须通过 wrangler secret put 设置，绝不写入代码或仓库）：
 *   SESSION_SECRET  会话/令牌哈希盐
 *   IP_HASH_SALT    IP 哈希盐（统计与限流使用，不存原始 IP）
 *   ADMIN_SETUP_TOKEN 初始管理员创建令牌（仅首次部署需要，可随后删除）
 */
export interface Env {
  DB: D1Database;
  BUCKET: R2Bucket;
  ASSETS: Fetcher;

  /** 站点公开 URL，例如 https://blog.example.com */
  SITE_URL?: string;
  /** 允许的后台来源，逗号分隔；缺省用请求自身 origin */
  ALLOWED_ORIGINS?: string;
  SESSION_SECRET?: string;
  IP_HASH_SALT?: string;
  ADMIN_SETUP_TOKEN?: string;

  /** 上传限制 */
  MAX_UPLOAD_MB?: string;
  ALLOW_SVG?: string;

  ENVIRONMENT?: string;
}

export interface SessionUser {
  id: number;
  username: string;
  role: 'admin' | 'editor' | 'author';
  status: 'active' | 'disabled';
}

export const SESSION_COOKIE = 'mb_session';
export const CSRF_COOKIE = 'mb_csrf';
export const SESSION_TTL_DAYS = 14;
export const SESSION_TTL_MS = SESSION_TTL_DAYS * 24 * 60 * 60 * 1000;

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export const SAFE_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/x-icon': 'ico',
  'image/vnd.microsoft.icon': 'ico'
};

export const DOC_MIME: Record<string, string> = {
  'application/pdf': 'pdf',
  'text/plain': 'txt',
  'text/markdown': 'md',
  'application/zip': 'zip'
};

/** 明确禁止的文件类型：可执行脚本与可被浏览器执行的主动内容 */
export const BLOCKED_EXT = new Set([
  'exe','dll','scr','com','bat','cmd','ps1','msi','hta','jar','js','mjs','cjs',
  'vbs','wsf','wsh','pif','reg','lnk','cgi','php','asp','aspx','jsp','sh','py','rb'
]);
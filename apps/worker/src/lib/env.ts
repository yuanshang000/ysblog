/**
 * 环境变量与绑定类型。
 *
 * 密钥约定（必须通过平台的环境变量配置，绝不写入代码或仓库）：
 *   SESSION_SECRET  会话/令牌哈希盐
 *   IP_HASH_SALT    IP 哈希盐（统计与限流使用，不存原始 IP）
 *   ADMIN_SETUP_TOKEN 初始管理员创建令牌（仅首次部署需要，可随后删除）
 *   POSTGRES_URL    数据库连接串（Vercel Postgres）
 *   BLOB_READ_WRITE_TOKEN 媒体存储令牌（Vercel Blob）
 */
import type { DbLike } from './db-adapter';

export interface Env {
  /**
   * 数据库句柄。
   *
   * 保持 D1 的 prepare().bind().first() 调用形状，但底层已是 Postgres，
   * 由 db-adapter 完成语法与返回值转换 —— 这样业务代码无需感知数据库差异。
   */
  DB: DbLike;
  BUCKET: BlobStore;

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

/**
 * 对象存储接口（Vercel Blob）。
 *
 * 与 Cloudflare R2 的 API 不同，此处只暴露本项目实际需要的能力，
 * 由 services/media 层的具体实现提供。
 */
export interface BlobStore {
  put(key: string, body: ArrayBuffer | Uint8Array, opts?: { contentType?: string; httpMetadata?: { contentType?: string } }): Promise<void>;
  get(key: string): Promise<{
    body: ReadableStream<Uint8Array>;
    httpMetadata?: { contentType?: string };
    size: number;
    uploadedAt?: Date;
  } | null>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  /** 返回可直接访问的公开 URL */
  url(key: string): string;
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
/**
 * 对象存储 —— Vercel Blob 实现。
 *
 * 替换原先的 Cloudflare R2。两者的 SDK 差异较大，但本项目用到的能力很少：
 * 写入、读取、删除、存在性判断、生成公开 URL。
 * 这里把这些能力收敛成 env.ts 中的 BlobStore 接口，
 * 使上层业务代码（admin-media、index 的媒体路由）只需极小改动。
 *
 * 访问方式：
 * - 写入/删除/存在性：需服务端令牌（BLOB_READ_WRITE_TOKEN）
 * - 读取：走公开 URL（store 需配置为 public），由 Vercel CDN 分发
 */
import { put as blobPut, del as blobDel, head as blobHead } from '@vercel/blob';
import type { BlobStore } from './env';

export interface VercelBlobOptions {
  /** Blob store 名称，默认 'media' */
  storeName?: string;
  /** 读取 URL 的域名，缺省用 Vercel 自动分配的公网域名 */
  baseUrl?: string;
}

/**
 * 创建 BlobStore 实现。
 *
 * 注意：Vercel Blob 的公开 URL 由平台分配，形如
 *   https://<storeId>.public.blob.vercel-storage.com/<pathname>
 * 若在 Vercel 控制台为 store 配置了自定义域名，可用 baseUrl 覆盖。
 */
export function createBlobStore(opts: VercelBlobOptions = {}): BlobStore {
  const storeName = opts.storeName ?? process.env.BLOB_STORE_NAME ?? 'media';

  /**
   * 生成公开访问 URL。
   *
   * pathname 必须以 '/' 开头，且整体做 encodeURI 处理 ——
   * object_key 形如 2026/10/xxx-photo.png，含中文文件名时必须转义。
   */
  const url = (key: string): string => {
    const encoded = key.split('/').map(encodeURIComponent).join('/');
    if (opts.baseUrl) {
      return `${opts.baseUrl.replace(/\/$/, '')}/${encoded}`;
    }
    return `/${encoded}`;
  };

  return {
    async put(key, body, putOpts) {
      const contentType = putOpts?.contentType ?? putOpts?.httpMetadata?.contentType;
      // @vercel/blob 的 PutBody 不接受裸 Uint8Array，需包成 Buffer。
      // Buffer 继承自 Uint8Array，因此 ArrayBuffer 与 TypedArray 两种入参都能处理。
      const payload =
        body instanceof Uint8Array
          ? Buffer.from(body.buffer, body.byteOffset, body.byteLength)
          : Buffer.from(body);
      await blobPut(key, payload, {
        access: 'public',
        token: process.env.BLOB_READ_WRITE_TOKEN,
        addRandomSuffix: false,
        contentType
      });
    },

    async get(key) {
      // 公开 store 可直接读取，无需令牌
      const res = await fetch(url(key), { method: 'GET' });
      if (!res.ok) {
        if (res.status === 404) return null;
        throw new Error(`读取媒体失败：HTTP ${res.status}`);
      }
      const buffer = await res.arrayBuffer();
      const len = Number(res.headers.get('content-length') ?? buffer.byteLength);
      return {
        body: new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new Uint8Array(buffer));
            controller.close();
          }
        }),
        httpMetadata: { contentType: res.headers.get('content-type') ?? 'application/octet-stream' },
        size: len,
        uploadedAt: res.headers.get('last-modified') ? new Date(res.headers.get('last-modified')!) : undefined
      };
    },

    async delete(key) {
      await blobDel(url(key), { token: process.env.BLOB_READ_WRITE_TOKEN });
    },

    async exists(key) {
      try {
        const meta = await blobHead(url(key), { token: process.env.BLOB_READ_WRITE_TOKEN });
        return Boolean(meta);
      } catch {
        return false;
      }
    },

    url
  };
}
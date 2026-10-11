/** 媒体库 API —— 上传到 R2，元数据入 D1 */
import type { Ctx } from '../lib/context';
import { requireUser, readJson, intParam } from '../lib/context';
import { HttpError, jsonOk } from '../lib/http';
import { BLOCKED_EXT, DOC_MIME, SAFE_MIME } from '../lib/env';
import { sha256Hex } from '../lib/crypto';
import { logOperation, mapMedia } from '../repositories/db';
import { fileMeta } from '@myblog/shared';
import type { Media } from '@myblog/shared';

interface MediaRow {
  id: number;
  original_name: string;
  object_key: string;
  mime_type: string;
  file_size: number;
  width: number | null;
  height: number | null;
  alt_text: string | null;
  caption: string | null;
  file_hash: string | null;
  created_at: string;
}

function maxBytes(ctx: Ctx): number {
  const mb = Number(ctx.env.MAX_UPLOAD_MB ?? 10);
  return (Number.isFinite(mb) && mb > 0 ? mb : 10) * 1024 * 1024;
}

function allowSvg(ctx: Ctx): boolean {
  return ctx.env.ALLOW_SVG === 'true';
}

/** 从二进制头部嗅探真实类型，不信任浏览器上报的 Content-Type */
function sniffType(bytes: Uint8Array): string | null {
  const b = bytes;
  if (b.length < 12) return null;
  const ascii = (start: number, len: number) => String.fromCharCode(...b.slice(start, start + len));

  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (ascii(0, 3) === 'GIF') return 'image/gif';
  if (ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') return 'image/webp';
  if (ascii(4, 4) === 'ftyp' && ascii(8, 4).includes('avif')) return 'image/avif';;
  if (ascii(0, 4) === '%PDF') return 'application/pdf';
  return null;
}

/** 解析 PNG / JPEG / GIF / WebP 宽高 */
function readDimensions(
  bytes: Uint8Array,
  mime: string
): { width: number | null; height: number | null } {
  try {
    if (mime === 'image/png' && bytes.length > 24) {
      const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      return { width: dv.getUint32(16), height: dv.getUint32(20) };
    }
    if (mime === 'image/gif' && bytes.length > 10) {
      const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      return { width: dv.getUint16(6, true), height: dv.getUint16(8, true) };
    }
    if (mime === 'image/webp' && bytes.length > 30) {
      const ascii = (start: number, len: number) =>
        String.fromCharCode(...bytes.slice(start, start + len));
      const fourcc = ascii(12, 4);
      const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      if (fourcc === 'VP8 ') return { width: dv.getUint16(26, true) & 0x3fff, height: dv.getUint16(28, true) & 0x3fff };
      if (fourcc === 'VP8L') {
        const bits = dv.getUint32(21, true);
        return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
      }
      if (fourcc === 'VP8X') {
        const w = bytes[24] | (bytes[25] << 8) | (bytes[26] << 16);
        const h = bytes[27] | (bytes[28] << 8) | (bytes[29] << 16);
        return { width: w + 1, height: h + 1 };
      }
    }
    if (mime === 'image/jpeg' && bytes.length > 4) {
      let offset = 2;
      while (offset + 9 < bytes.length) {
        if (bytes[offset] !== 0xff) {
          offset++;
          continue;
        }
        const marker = bytes[offset + 1];
        const len = (bytes[offset + 2] << 8) | bytes[offset + 3];
        // SOF0-SOF15，排除 DHT(C4)/JPG(C8)/DAC(CC)
        if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
          const h = (bytes[offset + 5] << 8) | bytes[offset + 6];
          const w = (bytes[offset + 7] << 8) | bytes[offset + 8];
          return { width: w, height: h };
        }
        offset += 2 + len;
      }
    }
  } catch {
    /* 解析失败不影响上传，返回 null 尺寸 */
  }
  return { width: null, height: null };
}

function isBot(ua: string): boolean {
  return /bot|crawler|spider|crawling|slurp|bingpreview|headlesschrome|lighthouse|curl\/|wget\/|python-requests/i.test(
    ua
  );
}

export async function handleMediaList(ctx: Ctx): Promise<Response> {
  requireUser(ctx);
  const page = intParam(ctx.url.searchParams.get('page'), 1, 1, 10000);
  const pageSize = intParam(ctx.url.searchParams.get('pageSize'), 40, 1, 100);
  const keyword = ctx.url.searchParams.get('q')?.trim();
  const mimeFilter = ctx.url.searchParams.get('mime');

  const where: string[] = [];
  const binds: unknown[] = [];
  if (keyword) {
    where.push('(original_name LIKE ? OR alt_text LIKE ?)');
    binds.push(`%${keyword}%`, `%${keyword}%`);
  }
  if (mimeFilter === 'image') where.push("mime_type LIKE 'image/%'");
  if (mimeFilter === 'doc') where.push("mime_type NOT LIKE 'image/%'");
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const totalRow = await ctx.env.DB.prepare(`SELECT COUNT(*) AS n FROM media ${whereSql}`)
    .bind(...binds)
    .first<{ n: number }>();

  const rows = await ctx.env.DB.prepare(
    `SELECT * FROM media ${whereSql} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`
  )
    .bind(...binds, pageSize, (page - 1) * pageSize)
    .all<MediaRow>();

  const items = rows.results.map((r) => mapMedia(r, ctx.url.origin));
  const total = totalRow?.n ?? 0;
  return jsonOk({
    items,
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    usage: await ctx.env.DB.prepare('SELECT COUNT(*) AS n FROM media').first<{ n: number }>()
  });
}

/** 上传单个文件 */
export async function handleMediaUpload(ctx: Ctx): Promise<Response> {
  const user = requireUser(ctx);
  const form = await ctx.request.formData().catch(() => null);
  if (!form) throw new HttpError(400, '请求必须为 multipart/form-data');

  const file = form.get('file') as File | null;
  if (!file || typeof file.arrayBuffer !== 'function' || typeof file.size !== 'number') {
    throw new HttpError(422, '请选择要上传的文件', { field: 'file' });
  }
  if (file.size === 0) throw new HttpError(422, '文件为空', { field: 'file' });

  const limit = maxBytes(ctx);
  if (file.size > limit) {
    throw new HttpError(413, `文件超过大小限制（${(limit / 1024 / 1024).toFixed(0)}MB）`, {
      field: 'file'
    });
  }

  const { ext } = fileMeta(file.name);
  if (ext && BLOCKED_EXT.has(ext)) {
    throw new HttpError(422, `不允许上传 .${ext} 类型的文件`, { field: 'file' });
  }

  const buf = new Uint8Array(await file.arrayBuffer());
  const sniffed = sniffType(buf);
  const declared = file.type || '';
  const isSvgFile = ext === 'svg' || declared === 'image/svg+xml';

  let mime: string;
  let storedExt: string;

  if (isSvgFile) {
    if (!allowSvg(ctx)) {
      throw new HttpError(422, '出于安全考虑已禁用 SVG 上传（SVG 可包含脚本）', { field: 'file' });
    }
    const text = new TextDecoder().decode(buf.slice(0, 2048)).toLowerCase();
    if (/<script|onload=|onerror=|javascript:|<foreignobject/i.test(text)) {
      throw new HttpError(422, 'SVG 含有潜在脚本内容，已拒绝上传', { field: 'file' });
    }
    mime = 'image/svg+xml';
    storedExt = 'svg';
  } else if (sniffed && SAFE_MIME[sniffed]) {
    mime = sniffed;
    storedExt = SAFE_MIME[sniffed];
  } else if (sniffed && DOC_MIME[sniffed]) {
    mime = sniffed;
    storedExt = DOC_MIME[sniffed];
  } else if (declared && (SAFE_MIME[declared] || DOC_MIME[declared])) {
    mime = declared;
    storedExt = (SAFE_MIME[declared] ?? DOC_MIME[declared]);
  } else {
    throw new HttpError(422, `不支持的文件类型：${declared || ext || '未知'}`, { field: 'file' });
  }

  // 内容与声明类型一致性校验：声明图片但嗅探不是图片 → 拒绝
  if (declared.startsWith('image/') && sniffed && !sniffed.startsWith('image/')) {
    throw new HttpError(422, '文件内容与类型不符，已拒绝上传', { field: 'file' });
  }

  const hash = await sha256Hex(`${file.size}:${Array.from(buf.slice(0, 4096)).join(',')}`);

  // 相同内容直接复用，避免重复占用存储
  const dup = await ctx.env.DB.prepare('SELECT * FROM media WHERE file_hash = ? AND file_size = ?')
    .bind(hash, file.size)
    .first<MediaRow>();
  if (dup) {
    const media = mapMedia(dup, ctx.url.origin);
    return jsonOk(
      { ...media, markdown: `![${media.altText || media.originalName}](${media.url})`, deduplicated: true },
      200,
      '已存在相同文件，直接复用'
    );
  }

  const now = ctx.now;
  const yyyy = now.slice(0, 4);
  const mm = now.slice(5, 7);
  const base = fileMeta(file.name).base.replace(/[^\w.\-一-龥]/g, '_').slice(0, 60) || 'file';
  const objectKey = `${yyyy}/${mm}/${Date.now().toString(36)}-${base}.${storedExt}`;

  // Vercel Blob 不支持自定义元数据，上传者与原始文件名改记入数据库
// （media 表已有 original_name 字段，uploaded_by 见操作日志）。
  await ctx.env.BUCKET.put(objectKey, buf, {
    httpMetadata: { contentType: mime }
  });

  const dims = mime.startsWith('image/') ? readDimensions(buf, mime) : { width: null, height: null };
  const altText = (form.get('altText') as string) ?? '';

  const result = await ctx.env.DB.prepare(
    `INSERT INTO media
      (original_name, object_key, mime_type, file_size, width, height, alt_text, caption, file_hash, created_at, uploaded_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      file.name.slice(0, 200),
      objectKey,
      mime,
      file.size,
      dims.width,
      dims.height,
      altText.slice(0, 300) || null,
      (form.get('caption') as string)?.slice(0, 300) ?? null,
      hash,
      now,
      user.id
    )
    .run();

  const row = await ctx.env.DB.prepare('SELECT * FROM media WHERE id = ?')
    .bind(Number(result.meta.last_row_id))
    .first<MediaRow>();
  const media = mapMedia(row!, ctx.url.origin);
  await logOperation(ctx.env, user.id, user.username, 'media.upload', 'media', media.id, file.name);

  return jsonOk(
    {
      ...media,
      markdown: `![${media.altText || media.originalName}](${media.url})`,
      deduplicated: false
    },
    201,
    '上传成功'
  );
}

/** 更新媒体元信息（替代文本、图注） */
export async function handleMediaUpdate(ctx: Ctx): Promise<Response> {
  const user = requireUser(ctx);
  const id = intParam(ctx.params.id, 0, 1, 1e9);
  const body = await readJson<{ altText?: string; caption?: string; originalName?: string }>(ctx);
  await ctx.env.DB.prepare(
    'UPDATE media SET alt_text = ?, caption = ?, original_name = ? WHERE id = ?'
  )
    .bind(
      body.altText?.slice(0, 300) ?? null,
      body.caption?.slice(0, 300) ?? null,
      body.originalName?.slice(0, 200) ?? null,
      id
    )
    .run();
  const row = await ctx.env.DB.prepare('SELECT * FROM media WHERE id = ?')
    .bind(id)
    .first<MediaRow>();
  if (!row) throw new HttpError(404, '媒体不存在');
  await logOperation(ctx.env, user.id, user.username, 'media.update', 'media', id);
  return jsonOk(mapMedia(row, ctx.url.origin), 200, '已更新');
}

/** 引用检查：删除前确认是否仍被文章或页面引用 */
export async function handleMediaUsage(ctx: Ctx): Promise<Response> {
  requireUser(ctx);
  const id = intParam(ctx.params.id, 0, 1, 1e9);
  const row = await ctx.env.DB.prepare('SELECT object_key FROM media WHERE id = ?')
    .bind(id)
    .first<{ object_key: string }>();
  if (!row) throw new HttpError(404, '媒体不存在');

  const posts = await ctx.env.DB.prepare(
    `SELECT id, title, slug, type, status FROM posts
      WHERE content LIKE ? AND deleted_at IS NULL`
  )
    .bind(`%${row.object_key}%`)
    .all<{ id: number; title: string; slug: string; type: string; status: string }>();

  const asCover = await ctx.env.DB.prepare(
    `SELECT id, title, slug FROM posts WHERE cover_media_id = ? AND deleted_at IS NULL`
  )
    .bind(id)
    .all<{ id: number; title: string; slug: string }>();

  const refs = [
    ...posts.results.map((p) => ({ id: p.id, title: p.title, slug: p.slug, kind: '正文引用' })),
    ...asCover.results.map((p) => ({ id: p.id, title: p.title, slug: p.slug, kind: '封面引用' }))
  ];
  return jsonOk({ referenced: refs.length > 0, references: refs });
}

/** 删除媒体（默认检查引用） */
export async function handleMediaDelete(ctx: Ctx): Promise<Response> {
  const user = requireUser(ctx);
  const id = intParam(ctx.params.id, 0, 1, 1e9);
  const force = ctx.url.searchParams.get('force') === 'true';

  const row = await ctx.env.DB.prepare('SELECT * FROM media WHERE id = ?')
    .bind(id)
    .first<MediaRow>();
  if (!row) throw new HttpError(404, '媒体不存在');

  if (!force) {
    const used = await ctx.env.DB.prepare(
      'SELECT COUNT(*) AS n FROM posts WHERE cover_media_id = ? OR content LIKE ?'
    )
      .bind(id, `%${row.object_key}%`)
      .first<{ n: number }>();
    if ((used?.n ?? 0) > 0) {
      throw new HttpError(409, `该文件仍被 ${used!.n} 处内容引用，请先解除引用或使用强制删除`, {
        references: used!.n
      });
    }
  }

  await ctx.env.BUCKET.delete(row.object_key);
  await ctx.env.DB.prepare('DELETE FROM media WHERE id = ?').bind(id).run();
  await logOperation(ctx.env, user.id, user.username, 'media.delete', 'media', id, row.original_name);
  return jsonOk({ id, deleted: true }, 200, '已删除');
}

/** 统计信息（工作台用） */
export async function handleMediaStats(ctx: Ctx): Promise<Response> {
  requireUser(ctx);
  const row = await ctx.env.DB.prepare(
    `SELECT COUNT(*) AS count, IFNULL(SUM(file_size),0) AS bytes FROM media`
  ).first<{ count: number; bytes: number }>();
  const imageCount = await ctx.env.DB.prepare(
    "SELECT COUNT(*) AS n FROM media WHERE mime_type LIKE 'image/%'"
  ).first<{ n: number }>();
  return jsonOk({
    count: row?.count ?? 0,
    totalBytes: row?.bytes ?? 0,
    images: imageCount?.n ?? 0
  });
}

export { isBot };
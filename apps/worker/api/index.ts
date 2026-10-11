/**
 * Vercel Functions 入口。
 *
 * Vercel 的 Node.js 运行时期望导出一个 (req, res) 风格的处理函数，
 * 与 Web Fetch 风格的 handler 不同，因此这里做一层薄适配：
 * 把 Node 的 IncomingMessage / ServerResponse 桥接成 Request / Response。
 *
 * 真正的业务逻辑仍在 apps/worker/src/index.ts 中（平台无关的 Web 标准代码），
 * 这里只负责协议转换，不含任何业务判断。
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import handler, { cronHandler } from '../src/index';

/** 读取请求体 */
function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/** 组装出标准的 Request 对象 */
async function toWebRequest(req: IncomingMessage, origin: string): Promise<Request> {
  const url = new URL(req.url ?? '/', origin);
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (v === undefined) continue;
    if (Array.isArray(v)) {
      for (const item of v) headers.append(k, item);
    } else {
      headers.set(k, v);
    }
  }

  const method = req.method ?? 'GET';
  // GET/HEAD 无请求体；其余方法需显式读取，
  // 否则 Node 端 body 为 null，multipart 上传会失败。
  const hasBody = !['GET', 'HEAD'].includes(method);
  const body = hasBody ? await readBody(req) : undefined;

  return new Request(url.toString(), {
    method,
    headers,
    // Buffer 不是标准的 BodyInit，这里转成 ArrayBuffer 交给 undici。
    body: body && body.length > 0 ? new Uint8Array(body) : undefined
  });
}

/** 把 Response 写回 Node 响应 */
async function sendWebResponse(res: Response, out: ServerResponse): Promise<void> {
  // 先写状态码与响应头（含 Set-Cookie 的多条值）
  res.headers.forEach((value, key) => {
    if (key.toLowerCase() === 'set-cookie') return; // 单独处理，避免被合并
    out.setHeader(key, value);
  });

  const setCookies = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  if (setCookies.length > 0) {
    out.setHeader('Set-Cookie', setCookies);
  }

  out.statusCode = res.status;

  if (!res.body) {
    out.end();
    return;
  }

  const buffer = Buffer.from(await res.arrayBuffer());
  out.end(buffer);
}

export default async function vercelHandler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    // Vercel 会注入 x-forwarded-host / host，据此还原真实 origin
    const forwardedHost = (req.headers['x-forwarded-host'] as string) ?? req.headers.host ?? 'localhost';
    const proto = (req.headers['x-forwarded-proto'] as string) ?? 'https';
    const origin = `${proto}://${forwardedHost}`;

    const request = await toWebRequest(req, origin);

    // 定时任务端点单独路由
    const webResponse =
      request.url.includes('/api/cron') && req.method === 'GET'
        ? await cronHandler(request)
        : await handler(request);

    await sendWebResponse(webResponse, res);
  } catch (err) {
    console.error('[vercel] 未捕获异常', err);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
    }
    res.end(
      JSON.stringify({
        code: 500,
        message: err instanceof Error ? err.message : '服务器内部错误',
        data: {}
      })
    );
  }
}
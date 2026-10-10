/** 统一响应封装 —— 全站 API 遵循同一契约 */

export interface ApiEnvelope<T> {
  code: number;
  message: string;
  data: T;
}

export function jsonOk<T>(data: T, status = 200, message = 'success'): Response {
  const body: ApiEnvelope<T> = { code: 0, message, data };
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    }
  });
}

export function jsonError(status: number, message: string, extra?: Record<string, unknown>): Response {
  const body: ApiEnvelope<Record<string, unknown>> = {
    code: status,
    message,
    data: extra ?? {}
  };
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}

export const badRequest = (msg = '请求格式错误', extra?: Record<string, unknown>) => jsonError(400, msg, extra);
export const unauthorized = (msg = '未登录或登录已过期') => jsonError(401, msg);
export const forbidden = (msg = '权限不足') => jsonError(403, msg);
export const notFound = (msg = '资源不存在') => jsonError(404, msg);
export const conflict = (msg = '资源冲突', extra?: Record<string, unknown>) => jsonError(409, msg, extra);
export const unprocessable = (msg = '请求参数校验失败', field?: string) =>
  jsonError(422, msg, field ? { field } : undefined);
export const tooMany = (msg = '请求过于频繁，请稍后再试') => jsonError(429, msg);
export const serverError = (msg = '服务器内部错误') => jsonError(500, msg);

/** 业务异常：由路由层统一捕获并转换为 HTTP 响应 */
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public extra?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export function handleError(err: unknown): Response {
  if (err instanceof HttpError) {
    return jsonError(err.status, err.message, err.extra);
  }
  console.error('[unhandled]', err);
  const msg = err instanceof Error ? err.message : String(err);
  // SQLite 约束冲突转为可读提示
  if (/UNIQUE constraint failed/i.test(msg)) {
    return jsonError(409, '数据已存在，请检查唯一性字段（slug / 名称）');
  }
  if (/FOREIGN KEY constraint failed/i.test(msg)) {
    return jsonError(422, '关联数据不存在或仍被引用');
  }
  return jsonError(500, '服务器内部错误');
}
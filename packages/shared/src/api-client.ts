/** API 请求封装 —— 后台与前台岛共用 */

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: number,
    message: string,
    public field?: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface RequestOptions {
  method?: string;
  body?: unknown;
  signal?: AbortSignal;
  headers?: Record<string, string>;
}

async function parseError(res: Response): Promise<never> {
  let payload: { code?: number; message?: string; data?: { field?: string } } | null = null;
  try {
    payload = await res.json();
  } catch {
    payload = null;
  }
  throw new ApiError(
    res.status,
    payload?.code ?? res.status,
    payload?.message ?? `请求失败 (${res.status})`,
    payload?.data?.field
  );
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...(options.headers ?? {})
  };
  let body: BodyInit | undefined;
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(options.body);
  }

  const csrf = readCookie('mb_csrf');
  if (csrf && !headers['X-CSRF-Token']) headers['X-CSRF-Token'] = csrf;

  const res = await fetch(path.startsWith('http') ? path : `/api/v1${path}`, {
    method: options.method ?? 'GET',
    headers,
    body,
    credentials: 'same-origin',
    signal: options.signal
  } as RequestInit);

  if (!res.ok) await parseError(res);
  const json = (await res.json()) as { data: T };
  return json.data;
}

export function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

export function apiUpload<T>(path: string, file: File, extra: Record<string, string> = {}): Promise<T> {
  const form = new FormData();
  form.append('file', file);
  for (const [k, v] of Object.entries(extra)) form.append(k, v);
  const csrf = readCookie('mb_csrf');
  return apiRequest<T>(path, {
    method: 'POST',
    body: form,
    headers: {
      ...(csrf ? { 'X-CSRF-Token': csrf } : {}),
      'Content-Type': undefined as unknown as string
    }
  } as RequestOptions).catch(async (e) => {
    if (e instanceof ApiError) throw e;
    throw e;
  });
}

/** FormData 不能走 JSON 序列化，这里单独处理 */
export async function apiUploadForm<T>(path: string, form: FormData): Promise<T> {
  const csrf = readCookie('mb_csrf');
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (csrf) headers['X-CSRF-Token'] = csrf;
  const res = await fetch(path.startsWith('http') ? path : `/api/v1${path}`, {
    method: 'POST',
    headers,
    body: form,
    credentials: 'same-origin'
  } as RequestInit);
  if (!res.ok) await parseError(res);
  const json = (await res.json()) as { data: T };
  return json.data;
}
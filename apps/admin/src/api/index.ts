/** 后台 API 封装 —— 统一错误处理与 CSRF */
import { apiRequest, apiUploadForm, ApiError, readCookie } from '@myblog/shared/api-client';
import type {
  Category,
  Comment,
  DashboardData,
  LinkItem,
  Media,
  MenuItem,
  OperationLog,
  Paginated,
  Post,
  PostStatus,
  PostSummary,
  Redirect,
  Revision,
  SiteSettings,
  Tag,
  UploadResult,
  User
} from '@myblog/shared';

export { ApiError };

/* ---------------- 认证 ---------------- */

export const authApi = {
  login: (username: string, password: string) =>
    apiRequest<User>('/admin/auth/login', { method: 'POST', body: { username, password } }),
  logout: () => apiRequest<{ ok: boolean }>('/admin/auth/logout', { method: 'POST', body: {} }),
  me: () => apiRequest<User>('/admin/me'),
  updateProfile: (data: Partial<Pick<User, 'displayName' | 'email' | 'avatarUrl' | 'bio'>>) =>
    apiRequest<User>('/admin/profile', { method: 'PUT', body: data }),
  changePassword: (currentPassword: string, newPassword: string) =>
    apiRequest<{ ok: boolean }>('/admin/password', {
      method: 'PUT',
      body: { currentPassword, newPassword }
    }),
  setupStatus: () => apiRequest<{ initialized: boolean }>('/setup-status'),
  setup: (token: string, username: string, password: string) =>
    apiRequest<{ id: number; username: string }>('/setup', {
      method: 'POST',
      body: { token, username, password }
    })
};

/* ---------------- 文章 ---------------- */

export interface PostListParams {
  status?: PostStatus | 'any';
  type?: 'post' | 'page';
  q?: string;
  categoryId?: number;
  page?: number;
  pageSize?: number;
}

export interface PostListResult extends Paginated<PostSummary> {
  counts: Record<string, number>;
}

export interface PostInput {
  title: string;
  slug?: string;
  content: string;
  excerpt?: string;
  coverMediaId?: number | null;
  coverAlt?: string | null;
  status?: PostStatus;
  type?: 'post' | 'page';
  isFeatured?: boolean;
  seoTitle?: string | null;
  seoDescription?: string | null;
  canonicalUrl?: string | null;
  robotsIndex?: boolean;
  categoryIds?: number[];
  tagNames?: string[];
  scheduledAt?: string | null;
  baseRevision?: number;
  autoSave?: boolean;
}

export const postApi = {
  list: (params: PostListParams = {}) => {
    const q = new URLSearchParams();
    if (params.status && params.status !== 'any') q.set('status', params.status);
    if (params.type) q.set('type', params.type);
    if (params.q) q.set('q', params.q);
    if (params.categoryId) q.set('categoryId', String(params.categoryId));
    q.set('page', String(params.page ?? 1));
    q.set('pageSize', String(params.pageSize ?? 20));
    return apiRequest<PostListResult>(`/admin/posts?${q}`);
  },
  get: (id: number) => apiRequest<Post & { prev: PostSummary | null; next: PostSummary | null; related: PostSummary[] }>(`/admin/posts/${id}`),
  create: (data: Partial<PostInput>) => apiRequest<Post>('/admin/posts', { method: 'POST', body: data }),
  update: (id: number, data: Partial<PostInput>) =>
    apiRequest<Post>(`/admin/posts/${id}`, { method: 'PUT', body: data }),
  publish: (id: number) => apiRequest<Post>(`/admin/posts/${id}/publish`, { method: 'POST', body: {} }),
  schedule: (id: number, scheduledAt: string) =>
    apiRequest<Post>(`/admin/posts/${id}/schedule`, { method: 'POST', body: { scheduledAt } }),
  unschedule: (id: number) => apiRequest<Post>(`/admin/posts/${id}/schedule`, { method: 'DELETE', body: {} }),
  archive: (id: number) => apiRequest<Post>(`/admin/posts/${id}/archive`, { method: 'POST', body: {} }),
  trash: (id: number) => apiRequest<{ id: number }>(`/admin/posts/${id}`, { method: 'DELETE', body: {} }),
  restore: (id: number) => apiRequest<Post>(`/admin/posts/${id}/restore`, { method: 'POST', body: {} }),
  destroy: (id: number) => apiRequest<{ deleted: boolean }>(`/admin/posts/${id}/permanent?confirm=true`, { method: 'DELETE', body: {} }),
  duplicate: (id: number) => apiRequest<Post>(`/admin/posts/${id}/duplicate`, { method: 'POST', body: {} }),
  batch: (ids: number[], action: string, categoryIds?: number[]) =>
    apiRequest<{ affected: number }>('/admin/posts/batch', { method: 'POST', body: { ids, action, categoryIds } }),
  revisions: (id: number) => apiRequest<Revision[]>(`/admin/posts/${id}/revisions`),
  revision: (id: number, revId: number) => apiRequest<Revision & { html: string }>(`/admin/posts/${id}/revisions/${revId}`),
  restoreRevision: (id: number, revId: number) =>
    apiRequest<Post>(`/admin/posts/${id}/revisions/${revId}/restore`, { method: 'POST', body: {} }),
  preview: (slug: string) => apiRequest<Post & { html: string }>(`/admin/preview/${slug}`)
};

/* ---------------- 分类 / 标签 ---------------- */

export const categoryApi = {
  list: () => apiRequest<Category[]>('/admin/categories'),
  create: (data: Partial<Category>) => apiRequest<Category>('/admin/categories', { method: 'POST', body: data }),
  update: (id: number, data: Partial<Category>) =>
    apiRequest<Category>(`/admin/categories/${id}`, { method: 'PUT', body: data }),
  remove: (id: number, mode: 'detach' | 'restrict' = 'detach') =>
    apiRequest<{ detachedPosts: number }>(`/admin/categories/${id}?mode=${mode}`, { method: 'DELETE', body: {} })
};

export const tagApi = {
  list: () => apiRequest<Tag[]>('/admin/tags'),
  create: (data: Partial<Tag>) => apiRequest<Tag>('/admin/tags', { method: 'POST', body: data }),
  update: (id: number, data: Partial<Tag>) => apiRequest<Tag>(`/admin/tags/${id}`, { method: 'PUT', body: data }),
  remove: (id: number) => apiRequest<{ id: number }>(`/admin/tags/${id}`, { method: 'DELETE', body: {} }),
  merge: (sourceId: number, targetId: number) =>
    apiRequest<{ merged: number }>('/admin/tags/merge', { method: 'POST', body: { sourceId, targetId } })
};

/* ---------------- 媒体 ---------------- */

export const mediaApi = {
  list: (params: { page?: number; pageSize?: number; q?: string; mime?: string } = {}) => {
    const q = new URLSearchParams();
    q.set('page', String(params.page ?? 1));
    q.set('pageSize', String(params.pageSize ?? 40));
    if (params.q) q.set('q', params.q);
    if (params.mime) q.set('mime', params.mime);
    return apiRequest<Paginated<Media>>(`/admin/media?${q}`);
  },
  upload: (file: File, extra: { altText?: string; caption?: string } = {}) => {
    const form = new FormData();
    form.append('file', file);
    if (extra.altText) form.append('altText', extra.altText);
    if (extra.caption) form.append('caption', extra.caption);
    return apiUploadForm<UploadResult>('/admin/media/upload', form);
  },
  update: (id: number, data: { altText?: string; caption?: string; originalName?: string }) =>
    apiRequest<Media>(`/admin/media/${id}`, { method: 'PUT', body: data }),
  usage: (id: number) =>
    apiRequest<{ referenced: boolean; references: { id: number; title: string; slug: string; kind: string }[] }>(
      `/admin/media/${id}/usage`
    ),
  remove: (id: number, force = false) =>
    apiRequest<{ deleted: boolean }>(`/admin/media/${id}${force ? '?force=true' : ''}`, { method: 'DELETE', body: {} }),
  stats: () => apiRequest<{ count: number; totalBytes: number; images: number }>('/admin/media/stats')
};

/* ---------------- 设置 / 菜单 / 友链 / 重定向 ---------------- */

export const settingsApi = {
  get: () => apiRequest<SiteSettings>('/admin/settings'),
  update: (data: Partial<SiteSettings>) => apiRequest<SiteSettings>('/admin/settings', { method: 'PUT', body: data })
};

export const menuApi = {
  list: () => apiRequest<MenuItem[]>('/admin/menus'),
  create: (data: Partial<MenuItem>) => apiRequest<MenuItem[]>('/admin/menus', { method: 'POST', body: data }),
  update: (id: number, data: Partial<MenuItem>) => apiRequest<MenuItem[]>(`/admin/menus/${id}`, { method: 'PUT', body: data }),
  remove: (id: number) => apiRequest<MenuItem[]>(`/admin/menus/${id}`, { method: 'DELETE', body: {} }),
  reorder: (ids: number[]) => apiRequest<MenuItem[]>('/admin/menus/reorder', { method: 'POST', body: { ids } })
};

export const linkApi = {
  list: () => apiRequest<LinkItem[]>('/admin/links'),
  create: (data: Partial<LinkItem>) => apiRequest<LinkItem[]>('/admin/links', { method: 'POST', body: data }),
  update: (id: number, data: Partial<LinkItem>) => apiRequest<LinkItem[]>(`/admin/links/${id}`, { method: 'PUT', body: data }),
  remove: (id: number) => apiRequest<LinkItem[]>(`/admin/links/${id}`, { method: 'DELETE', body: {} })
};

export const redirectApi = {
  list: () => apiRequest<Redirect[]>('/admin/redirects'),
  create: (data: Partial<Redirect>) => apiRequest<Redirect[]>('/admin/redirects', { method: 'POST', body: data }),
  remove: (id: number) => apiRequest<Redirect[]>(`/admin/redirects/${id}`, { method: 'DELETE', body: {} })
};

/* ---------------- 评论 ---------------- */

export const commentApi = {
  list: (params: { status?: string; page?: number; pageSize?: number } = {}) => {
    const q = new URLSearchParams();
    if (params.status) q.set('status', params.status);
    q.set('page', String(params.page ?? 1));
    q.set('pageSize', String(params.pageSize ?? 20));
    return apiRequest<Paginated<Comment & { postTitle: string }>>(`/admin/comments?${q}`);
  },
  update: (id: number, status: Comment['status']) =>
    apiRequest<{ id: number; status: string }>(`/admin/comments/${id}`, { method: 'PATCH', body: { status } }),
  batch: (ids: number[], status: string) =>
    apiRequest<{ affected: number }>('/admin/comments/batch', { method: 'POST', body: { ids, status } }),
  remove: (id: number) => apiRequest<{ deleted: boolean }>(`/admin/comments/${id}`, { method: 'DELETE', body: {} })
};

/* ---------------- 工作台 / 日志 ---------------- */

export const dashboardApi = {
  get: () => apiRequest<DashboardData>('/admin/dashboard'),
  logs: (limit = 50) => apiRequest<OperationLog[]>(`/admin/logs?limit=${limit}`),
  runJobs: () => apiRequest<{ published: number }>('/admin/jobs/run', { method: 'POST', body: {} })
};

export { readCookie };
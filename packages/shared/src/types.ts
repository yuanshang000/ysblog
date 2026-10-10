/**
 * MyBlog 共享类型定义 —— 前后台 + Worker 三端共用的数据契约。
 */

export type PostStatus = 'draft' | 'published' | 'scheduled' | 'archived' | 'trashed';

export type PostType = 'post' | 'page';

export const POST_STATUSES: PostStatus[] = ['draft', 'published', 'scheduled', 'archived', 'trashed'];

export const POST_STATUS_LABEL: Record<PostStatus, string> = {
  draft: '草稿',
  published: '已发布',
  scheduled: '定时发布',
  archived: '已归档',
  trashed: '回收站'
};

export type UserRole = 'admin' | 'editor' | 'author';

export interface User {
  id: number;
  username: string;
  email: string | null;
  role: UserRole;
  status: 'active' | 'disabled';
  avatarUrl: string | null;
  bio: string | null;
  displayName: string | null;
  createdAt: string;
  lastLoginAt: string | null;
}

export interface Category {
  id: number;
  name: string;
  slug: string;
  description: string | null;
  parentId: number | null;
  sortOrder: number;
  seoTitle: string | null;
  seoDescription: string | null;
  postCount?: number;
  createdAt: string;
  updatedAt: string;
}

export interface Tag {
  id: number;
  name: string;
  slug: string;
  description: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  postCount?: number;
  createdAt: string;
}

export interface Media {
  id: number;
  originalName: string;
  objectKey: string;
  mimeType: string;
  fileSize: number;
  width: number | null;
  height: number | null;
  altText: string | null;
  caption: string | null;
  fileHash: string | null;
  url: string;
  createdAt: string;
}

export interface Post {
  id: number;
  authorId: number;
  authorName?: string;
  type: PostType;
  title: string;
  slug: string;
  excerpt: string | null;
  content: string;
  contentFormat: string;
  coverMediaId: number | null;
  coverUrl: string | null;
  coverAlt: string | null;
  status: PostStatus;
  isFeatured: boolean;
  sortOrder: number;
  wordCount: number;
  readingTime: number;
  seoTitle: string | null;
  seoDescription: string | null;
  canonicalUrl: string | null;
  robotsIndex: boolean;
  revision: number;
  publishedAt: string | null;
  scheduledAt: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  categories: Category[];
  tags: Tag[];
}

export interface PostSummary {
  id: number;
  title: string;
  slug: string;
  excerpt: string | null;
  status: PostStatus;
  type: PostType;
  isFeatured: boolean;
  wordCount: number;
  readingTime: number;
  publishedAt: string | null;
  updatedAt: string;
  coverUrl: string | null;
  coverAlt: string | null;
  authorName?: string;
  categoryName: string | null;
  categorySlug: string | null;
  tags: { id: number; name: string; slug: string }[];
}

export interface Revision {
  id: number;
  postId: number;
  title: string;
  excerpt: string | null;
  content: string;
  revision: number;
  createdAt: string;
  createdBy: string | null;
}

export interface MenuItem {
  id: number;
  label: string;
  href: string;
  sortOrder: number;
  isVisible: boolean;
  isExternal: boolean;
  openInNew: boolean;
  location: 'header' | 'footer' | 'social';
}

export interface LinkItem {
  id: number;
  name: string;
  url: string;
  avatarUrl: string | null;
  description: string | null;
  sortOrder: number;
  isVisible: boolean;
}

export interface Redirect {
  id: number;
  fromPath: string;
  toPath: string;
  statusCode: number;
  isActive: boolean;
  hitCount: number;
  createdAt: string;
}

export interface Comment {
  id: number;
  postId: number;
  parentId: number | null;
  authorName: string;
  authorEmail: string | null;
  authorWebsite: string | null;
  content: string;
  status: 'pending' | 'approved' | 'spam' | 'deleted';
  ipHash: string | null;
  userAgent: string | null;
  createdAt: string;
  children?: Comment[];
}

export interface SiteSettings {
  siteName: string;
  siteDescription: string;
  siteUrl: string;
  logoUrl: string | null;
  faviconUrl: string | null;
  accentColor: string;
  defaultTheme: 'light' | 'dark' | 'system';
  heroTitle: string;
  heroSubtitle: string;
  heroDescription: string;
  heroAvatarUrl: string | null;
  aboutContent: string;
  footerText: string;
  footerIcp: string | null;
  defaultSeoTitle: string | null;
  defaultSeoDescription: string | null;
  postsPerPage: number;
  commentEnabled: boolean;
  commentModeration: boolean;
  analyticsEnabled: boolean;
  analyticsRetentionDays: number;
  robotsIndex: boolean;
  icpBeian: string | null;
}

export interface PageViewStats {
  totalPosts: number;
  publishedPosts: number;
  draftPosts: number;
  scheduledCount: number;
  archivedPosts: number;
  trashedPosts: number;
  totalViews: number;
  totalVisitors: number;
  todayViews: number;
  todayVisitors: number;
  pendingComments: number;
}

export interface TrendPoint {
  date: string;
  views: number;
  visitors: number;
}

export interface OperationLog {
  id: number;
  userId: number | null;
  username: string | null;
  action: string;
  targetType: string | null;
  targetId: number | null;
  detail: string | null;
  ip: string | null;
  createdAt: string;
}

/** 统一响应封装 */
export interface ApiResponse<T = unknown> {
  code: number;
  message: string;
  data: T;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface AuthState {
  user: User | null;
}

export interface NavConfig {
  menus: MenuItem[];
  siteName: string;
  accentColor: string;
  defaultTheme: 'light' | 'dark' | 'system';
}

export interface HomeData {
  site: SiteSettings;
  featured: PostSummary[];
  latest: PostSummary[];
  categories: Category[];
  totalPosts: number;
  pageViews: number;
}

export interface PostDetail extends Post {
  related: PostSummary[];
  prev: PostSummary | null;
  next: PostSummary | null;
  html: string;
  toc: TocItem[];
  commentCount: number;
}

export interface TocItem {
  id: string;
  text: string;
  level: number;
}

export interface ArchiveGroup {
  year: number;
  month: number;
  count: number;
  posts: PostSummary[];
}

export interface SearchResult {
  items: PostSummary[];
  total: number;
  keyword: string;
}

export interface DashboardData {
  stats: PageViewStats;
  trend: TrendPoint[];
  recentPosts: PostSummary[];
  topPosts: { slug: string; title: string; views: number }[];
  recentLogs: OperationLog[];
}

export interface UploadResult extends Media {
  markdown: string;
}

export const ACCENT_PRESETS = [
  { name: '靛蓝', value: '#4f46e5' },
  { name: '墨绿', value: '#0f766e' },
  { name: '砖红', value: '#b45309' },
  { name: '玫紫', value: '#9d174d' },
  { name: '钢蓝', value: '#1d4ed8' }
];

export const DEFAULT_SITE_SETTINGS: SiteSettings = {
  siteName: '我的博客',
  siteDescription: '技术文章、项目记录与个人随笔',
  siteUrl: '',
  logoUrl: null,
  faviconUrl: null,
  accentColor: '#4f46e5',
  defaultTheme: 'light',
  heroTitle: '你好，我是 Lala',
  heroSubtitle: '写代码，也写字',
  heroDescription: '',
  heroAvatarUrl: null,
  aboutContent: '',
  footerText: '© 2026 保留所有权利',
  footerIcp: null,
  defaultSeoTitle: null,
  defaultSeoDescription: null,
  postsPerPage: 10,
  commentEnabled: false,
  commentModeration: true,
  analyticsEnabled: true,
  analyticsRetentionDays: 180,
  robotsIndex: true,
  icpBeian: null
};
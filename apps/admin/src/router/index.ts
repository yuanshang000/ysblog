import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router';
import { authApi, readCookie } from '@/api';

const routes: RouteRecordRaw[] = [
  { path: '/login', name: 'login', component: () => import('@/views/Login.vue'), meta: { public: true } },
  { path: '/setup', name: 'setup', component: () => import('@/views/Setup.vue'), meta: { public: true } },

  { path: '/', redirect: '/dashboard' },
  { path: '/dashboard', name: 'dashboard', component: () => import('@/views/Dashboard.vue'), meta: { title: '工作台' } },

  { path: '/posts', name: 'posts', component: () => import('@/views/Posts.vue'), meta: { title: '文章管理' } },
  { path: '/posts/new', name: 'post-new', component: () => import('@/views/Editor.vue'), meta: { title: '写文章' } },
  { path: '/posts/:id', name: 'post-edit', component: () => import('@/views/Editor.vue'), meta: { title: '编辑文章' } },
  { path: '/revisions/:id', name: 'revisions', component: () => import('@/views/Revisions.vue'), meta: { title: '版本历史' } },

  { path: '/pages', name: 'pages', component: () => import('@/views/Pages.vue'), meta: { title: '页面管理' } },
  { path: '/categories', name: 'categories', component: () => import('@/views/Taxonomy.vue'), meta: { title: '分类与标签' } },
  { path: '/media', name: 'media', component: () => import('@/views/Media.vue'), meta: { title: '媒体库' } },
  { path: '/comments', name: 'comments', component: () => import('@/views/Comments.vue'), meta: { title: '评论管理' } },
  { path: '/links', name: 'links', component: () => import('@/views/Links.vue'), meta: { title: '链接与重定向' } },
  { path: '/appearance', name: 'appearance', component: () => import('@/views/Appearance.vue'), meta: { title: '外观设置' } },
  { path: '/settings', name: 'settings', component: () => import('@/views/Settings.vue'), meta: { title: '站点设置' } },
  { path: '/logs', name: 'logs', component: () => import('@/views/Logs.vue'), meta: { title: '操作日志' } },

  { path: '/:pathMatch(.*)*', name: 'not-found', component: () => import('@/views/NotFound.vue'), meta: { title: '页面不存在' } }
];

export const router = createRouter({
  history: createWebHistory('/admin/'),
  routes,
  scrollBehavior: () => ({ top: 0 })
});

/**
 * 是否可能已登录。
 *
 * mb_session 是 HttpOnly，JS 读不到，因此这里用前端可读的 mb_csrf 作为启发式判断：
 * 服务端在创建会话时一定会同时下发 mb_csrf，两者生命周期一致。
 * 没有它就说明从未登录过，不必再请求 /admin/me。
 *
 * 目的：避免未登录用户一打开页面就看到控制台的 401 报错。
 */
function mayBeLoggedIn(): boolean {
  return !!readCookie('mb_csrf');
}

router.beforeEach(async (to) => {
  if (to.meta.public) {
    // 已登录时访问登录/初始化页，直接回工作台。
    // 未登录时不要发请求，否则控制台会留下一条 401。
    if ((to.name === 'login' || to.name === 'setup') && mayBeLoggedIn()) {
      try {
        await authApi.me();
        return { name: 'dashboard' };
      } catch {
        /* 会话已失效，清掉残留 Cookie 后继续显示登录页 */
        clearSessionCookies();
      }
    }
    return true;
  }

  // 受保护页面：没有会话 Cookie 直接跳登录，不发无意义的请求
  if (!mayBeLoggedIn()) {
    return { name: 'login', query: { redirect: to.fullPath } };
  }

  try {
    await authApi.me();
    return true;
  } catch {
    clearSessionCookies();
    return { name: 'login', query: { redirect: to.fullPath } };
  }
});

/** 清除前端可读的两个 Cookie，避免失效状态反复触发 /admin/me */
function clearSessionCookies(): void {
  if (typeof document === 'undefined') return;
  for (const name of ['mb_csrf']) {
    document.cookie = `${name}=; Path=/; Max-Age=0; SameSite=Lax`;
  }
}
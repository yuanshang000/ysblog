import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router';
import { authApi } from '@/api';

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

let authChecked = false;

router.beforeEach(async (to) => {
  if (to.meta.public) {
    // 已登录时访问登录/初始化页，直接回工作台
    if (to.name === 'login' || to.name === 'setup') {
      try {
        await authApi.me();
        return { name: 'dashboard' };
      } catch {
        /* 未登录，继续 */
      }
    }
    return true;
  }

  if (!authChecked) {
    authChecked = true;
  }

  try {
    await authApi.me();
    return true;
  } catch {
    return { name: 'login', query: { redirect: to.fullPath } };
  }
});
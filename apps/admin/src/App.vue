<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { useAuthStore } from '@/stores';
import { authApi, readCookie } from '@/api';

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();

const sidebarOpen = ref(false);
const siteName = ref('MyBlog');

const menus = [
  { group: '', items: [{ path: '/dashboard', label: '工作台', icon: 'DataBoard' }] },
  {
    group: '内容',
    items: [
      { path: '/posts', label: '文章管理', icon: 'Document' },
      { path: '/pages', label: '页面管理', icon: 'Files' },
      { path: '/categories', label: '分类与标签', icon: 'Collection' },
      { path: '/media', label: '媒体库', icon: 'Picture' },
      { path: '/comments', label: '评论管理', icon: 'ChatDotRound' }
    ]
  },
  {
    group: '站点',
    items: [
      { path: '/links', label: '链接与重定向', icon: 'Connection' },
      { path: '/appearance', label: '外观设置', icon: 'Brush' },
      { path: '/settings', label: '站点设置', icon: 'Setting' },
      { path: '/logs', label: '操作日志', icon: 'Tickets' }
    ]
  }
];

const pageTitle = computed(() => (route.meta.title as string) ?? '管理后台');
const isEditor = computed(() => route.name === 'post-edit' || route.name === 'post-new');

/**
 * 拉取当前登录用户，展示在侧边栏。
 *
 * 用 watch 而非 onMounted：App 组件在路由守卫完成跳转「之前」就已挂载，
 * 此刻 route 仍是 /admin 这类受保护路径。若在 onMounted 里直接请求 /admin/me，
 * 未登录用户一打开页面就会在控制台看到 401 报错，容易误判为系统故障。
 * 监听 meta.public 可确保只在该路径下已经登录时才请求。
 */
watch(
  () => route.meta.public,
  (isPublic) => {
    siteName.value = '';
    // 公共页（登录/初始化）不需要用户信息。
    // 受保护页面也必须确认已持有会话 Cookie 才请求，
    // 因为 immediate 首次执行时路由守卫可能尚未完成跳转。
    if (isPublic || !readCookie('mb_csrf')) return;
    void (async () => {
      await auth.fetchUser();
      try {
        const s = await authApi.me();
        siteName.value = s.displayName || s.username;
      } catch {
        /* 登录态失效由路由守卫处理 */
      }
    })();
  },
  { immediate: true }
);

async function handleLogout(): Promise<void> {
  await auth.logout();
  ElMessage.success('已退出登录');
  router.push('/login');
}
</script>

<template>
  <div class="mb-layout">
    <aside class="mb-sidebar" :class="{ 'is-open': sidebarOpen }">
      <div class="mb-brand">
        <span class="mb-brand-dot">B</span>
        <span>{{ siteName }} 后台</span>
      </div>

      <nav class="mb-menu">
        <template v-for="group in menus" :key="group.group">
          <div v-if="group.group" class="mb-menu-group-title">{{ group.group }}</div>
          <router-link
            v-for="item in group.items"
            :key="item.path"
            :to="item.path"
            class="mb-menu-link"
            :class="{ 'is-active': route.path === item.path || (item.path !== '/dashboard' && route.path.startsWith(item.path)) }"
            @click="sidebarOpen = false"
          >
            <el-icon><component :is="item.icon" /></el-icon>
            <span>{{ item.label }}</span>
          </router-link>
        </template>

        <div class="mb-menu-group-title">快捷</div>
        <a class="mb-menu-link" href="/" target="_blank" rel="noopener">
          <el-icon><View /></el-icon>
          <span>查看前台</span>
        </a>
      </nav>

      <div class="mb-footer-brand">MyBlog · Vercel</div>
    </aside>

    <div class="mb-main">
      <header class="mb-topbar">
        <el-button
          v-if="!isEditor"
          class="mb-menu-toggle"
          text
          @click="sidebarOpen = !sidebarOpen"
          style="display: none"
        >
          <el-icon><Fold /></el-icon>
        </el-button>
        <h1>{{ pageTitle }}</h1>
        <div style="flex: 1"></div>
        <template v-if="isEditor">
          <router-link to="/posts">
            <el-button text size="small">
              <el-icon><Back /></el-icon>
              <span style="margin-left: 4px">返回列表</span>
            </el-button>
          </router-link>
        </template>
        <el-dropdown>
          <span class="mb-user" style="cursor: pointer; display: inline-flex; align-items: center; gap: 6px">
            <el-avatar :size="26" style="background: var(--mb-accent)">
              {{ (auth.user?.username ?? 'A').slice(0, 1).toUpperCase() }}
            </el-avatar>
            <span style="font-size: 13px">{{ auth.user?.username }}</span>
            <el-icon><ArrowDown /></el-icon>
          </span>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item @click="router.push('/settings')">
                <el-icon><Setting /></el-icon> 账号设置
              </el-dropdown-item>
              <el-dropdown-item divided @click="handleLogout">
                <el-icon><SwitchButton /></el-icon> 退出登录
              </el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </header>

      <main class="mb-content" :style="isEditor ? { padding: 0 } : {}">
        <router-view v-slot="{ Component }">
          <keep-alive :include="['Posts', 'Media', 'Comments']">
            <component :is="Component" />
          </keep-alive>
        </router-view>
      </main>
    </div>
  </div>
</template>

<style scoped>
.mb-menu-link {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border-radius: 8px;
  color: #57565e;
  text-decoration: none;
  font-size: 13.5px;
  transition: all 0.14s;
  margin-bottom: 1px;
}

.mb-menu-link:hover {
  background: #f4f4f6;
  color: #1c1c1e;
}

.mb-menu-link.is-active {
  background: color-mix(in srgb, var(--mb-accent) 10%, transparent);
  color: var(--mb-accent);
  font-weight: 560;
}

.mb-menu-link .el-icon {
  font-size: 15px;
}

.mb-user:hover {
  color: var(--mb-accent);
}
</style>
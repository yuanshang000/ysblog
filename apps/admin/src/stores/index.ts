import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { Category, SiteSettings, Tag, User } from '@myblog/shared';
import { authApi, settingsApi } from '@/api';

export const useAuthStore = defineStore('auth', () => {
  const user = ref<User | null>(null);
  const loaded = ref(false);

  async function fetchUser(): Promise<User | null> {
    if (loaded.value && user.value) return user.value;
    try {
      user.value = await authApi.me();
    } catch {
      user.value = null;
    }
    loaded.value = true;
    return user.value;
  }

  async function login(username: string, password: string): Promise<void> {
    user.value = await authApi.login(username, password);
    loaded.value = true;
  }

  async function logout(): Promise<void> {
    await authApi.logout();
    user.value = null;
    loaded.value = false;
  }

  return { user, loaded, fetchUser, login, logout };
});

export const useTaxonomyStore = defineStore('taxonomy', () => {
  const categories = ref<Category[]>([]);
  const tags = ref<Tag[]>([]);
  const settings = ref<SiteSettings | null>(null);

  async function loadAll(): Promise<void> {
    const [c, t, s] = await Promise.all([
      import('@/api').then((m) => m.categoryApi.list()),
      import('@/api').then((m) => m.tagApi.list()),
      settingsApi.get()
    ]);
    categories.value = c;
    tags.value = t;
    settings.value = s;
  }

  async function loadSettings(): Promise<void> {
    settings.value = await settingsApi.get();
  }

  return { categories, tags, settings, loadAll, loadSettings };
});
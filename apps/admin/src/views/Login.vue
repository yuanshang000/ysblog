<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { authApi } from '@/api';
import { useAuthStore } from '@/stores';

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();

const form = reactive({ username: '', password: '' });
const loading = ref(false);
const needSetup = ref(false);

/** 与服务端一致的用户名规则：字母、数字、下划线、点、连字符 */
const USERNAME_RE = /^[A-Za-z0-9_.-]{3,32}$/;

onMounted(async () => {
  try {
    const status = await authApi.setupStatus();
    if (!status.initialized) {
      needSetup.value = true;
      router.replace('/setup');
    }
  } catch {
    /* 接口异常时按已初始化处理 */
  }
});

async function submit(): Promise<void> {
  const username = form.username.trim();
  if (!username || !form.password) {
    ElMessage.warning('请输入用户名和密码');
    return;
  }
  // 提前拦下格式错误，避免提交后只得到「用户名或密码错误」而无从排查
  if (!USERNAME_RE.test(username)) {
    ElMessage.warning('用户名只能包含字母、数字、下划线、点或连字符，请勿把密码填入用户名框');
    return;
  }
  loading.value = true;
  try {
    await auth.login(username, form.password);
    ElMessage.success('登录成功');
    const redirect = (route.query.redirect as string) ?? '/dashboard';
    router.push(redirect.startsWith('/') ? redirect : '/dashboard');
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '登录失败');
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="mb-login">
    <div class="mb-login-card">
      <div class="mb-login-brand">
        <div class="mb-login-logo">B</div>
        <h1 class="mb-login-title">登录管理后台</h1>
        <p class="mb-login-sub">MyBlog 内容管理系统</p>
      </div>

      <el-form label-position="top" @submit.prevent="submit">
        <el-form-item label="用户名">
          <el-input
            v-model="form.username"
            size="large"
            placeholder="请输入用户名"
            autocomplete="username"
            autofocus
            @keyup.enter="submit"
          >
            <template #prefix><el-icon><User /></el-icon></template>
          </el-input>
        </el-form-item>

        <el-form-item label="密码">
          <el-input
            v-model="form.password"
            type="password"
            size="large"
            placeholder="请输入密码"
            show-password
            autocomplete="current-password"
            @keyup.enter="submit"
          >
            <template #prefix><el-icon><Lock /></el-icon></template>
          </el-input>
        </el-form-item>

        <el-alert type="info" :closable="false" style="margin-bottom: 14px">
          <template #title>
            <span style="font-size: 12px; line-height: 1.7">
              用户名与密码请分别填入上方两个输入框。<br />
              密码中的 <code>/</code> <code>@</code> <code>.</code> 等符号属于密码内容，请勿填入用户名框。
            </span>
          </template>
        </el-alert>

        <el-button type="primary" size="large" style="width: 100%" :loading="loading" @click="submit">
          登录
        </el-button>
      </el-form>

      <div style="margin-top: 18px; text-align: center">
        <a href="/" style="font-size: 12.5px; color: #8a8a93; text-decoration: none">← 返回博客前台</a>
      </div>
    </div>
  </div>
</template>
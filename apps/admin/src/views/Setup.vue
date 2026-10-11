<script setup lang="ts">
import { reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { authApi } from '@/api';

const router = useRouter();
const form = reactive({ token: '', username: '', password: '', confirm: '' });
const loading = ref(false);

async function submit(): Promise<void> {
  if (!form.token.trim()) { ElMessage.warning('请填写初始化令牌'); return; }
  if (!/^[A-Za-z0-9_.-]{3,32}$/.test(form.username.trim())) {
    { ElMessage.warning('用户名需为 3-32 位字母、数字、下划线、点或连字符'); return; }
  }
  if (form.password.length < 10) { ElMessage.warning('密码至少 10 位'); return; }
  if (!/[A-Za-z]/.test(form.password) || !/[0-9]/.test(form.password)) {
    { ElMessage.warning('密码必须同时包含字母和数字'); return; }
  }
  if (form.password !== form.confirm) { ElMessage.warning('两次输入的密码不一致'); return; }

  loading.value = true;
  try {
    await authApi.setup(form.token.trim(), form.username.trim(), form.password);
    ElMessage.success('管理员创建成功，请登录');
    router.push('/login');
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '初始化失败');
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
        <h1 class="mb-login-title">首次初始化</h1>
        <p class="mb-login-sub">创建你的管理员账号</p>
      </div>

      <el-alert type="info" :closable="false" style="margin-bottom: 16px">
        <template #title>
          <span style="font-size: 12.5px">
            需要先通过 <code>vercel env add ADMIN_SETUP_TOKEN production</code> 配置初始化令牌
          </span>
        </template>
      </el-alert>

      <el-form label-position="top" @submit.prevent="submit">
        <el-form-item label="初始化令牌">
          <el-input v-model="form.token" size="large" placeholder="ADMIN_SETUP_TOKEN" />
        </el-form-item>
        <el-form-item label="用户名">
          <el-input v-model="form.username" size="large" placeholder="3-32 位字母、数字、下划线" />
        </el-form-item>
        <el-form-item label="密码">
          <el-input v-model="form.password" type="password" size="large" placeholder="至少 10 位，含字母和数字" show-password />
        </el-form-item>
        <el-form-item label="确认密码">
          <el-input v-model="form.confirm" type="password" size="large" placeholder="再次输入密码" show-password @keyup.enter="submit" />
        </el-form-item>

        <el-button type="primary" size="large" style="width: 100%" :loading="loading" @click="submit">
          创建管理员
        </el-button>
      </el-form>
    </div>
  </div>
</template>
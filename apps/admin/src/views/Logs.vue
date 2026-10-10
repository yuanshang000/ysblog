<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { dashboardApi } from '@/api';
import type { OperationLog } from '@myblog/shared';
import { formatDate } from '@myblog/shared';

const loading = ref(false);
const logs = ref<OperationLog[]>([]);

const actionMeta: Record<string, { label: string; type: 'success' | 'info' | 'warning' | 'danger' | '' }> = {
  'auth.login': { label: '登录', type: 'success' },
  'auth.logout': { label: '退出', type: 'info' },
  'post.create': { label: '创建文章', type: 'info' },
  'post.update': { label: '更新文章', type: '' },
  'post.publish': { label: '发布文章', type: 'success' },
  'post.schedule': { label: '定时发布', type: 'warning' },
  'post.unschedule': { label: '取消定时', type: 'info' },
  'post.archive': { label: '归档', type: 'warning' },
  'post.trash': { label: '移入回收站', type: 'warning' },
  'post.restore': { label: '恢复文章', type: 'success' },
  'post.delete_forever': { label: '永久删除', type: 'danger' },
  'post.duplicate': { label: '复制文章', type: 'info' },
  'post.restore_revision': { label: '恢复版本', type: 'warning' },
  'post.auto_publish': { label: '定时自动发布', type: 'success' },
  'media.upload': { label: '上传媒体', type: 'info' },
  'media.delete': { label: '删除媒体', type: 'danger' },
  'media.update': { label: '更新媒体信息', type: '' },
  'settings.update': { label: '修改站点设置', type: 'warning' },
  'user.password_change': { label: '修改密码', type: 'warning' },
  'user.profile_update': { label: '更新个人资料', type: '' },
  'system.setup': { label: '系统初始化', type: 'success' }
};

async function load(): Promise<void> {
  loading.value = true;
  try {
    logs.value = await dashboardApi.logs(200);
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '加载失败');
  } finally {
    loading.value = false;
  }
}

onMounted(load);
</script>

<template>
  <div>
    <el-alert type="info" :closable="false" style="margin-bottom: 16px">
      <template #title>
        <span style="font-size: 12.5px">
          记录所有重要操作，便于排查「谁在什么时候改了什么」。最多显示最近 200 条
        </span>
      </template>
    </el-alert>

    <div class="mb-card" style="padding: 0">
      <el-table v-loading="loading" :data="logs" size="small">
        <el-table-column label="时间" width="170">
          <template #default="{ row }">{{ formatDate(row.createdAt, true) }}</template>
        </el-table-column>
        <el-table-column label="操作人" width="110" prop="username">
          <template #default="{ row }">{{ row.username ?? '系统' }}</template>
        </el-table-column>
        <el-table-column label="操作" width="150">
          <template #default="{ row }">
            <el-tag size="small" :type="actionMeta[row.action]?.type ?? ''" effect="plain">
              {{ actionMeta[row.action]?.label ?? row.action }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="对象" width="90">
          <template #default="{ row }">{{ row.targetType ?? '—' }}</template>
        </el-table-column>
        <el-table-column label="详情" min-width="220" show-overflow-tooltip>
          <template #default="{ row }">
            <span v-if="row.detail">{{ row.detail }}</span>
            <span v-else class="mb-muted">—</span>
          </template>
        </el-table-column>
        <template #empty><el-empty description="还没有操作记录" :image-size="80" /></template>
      </el-table>
    </div>
  </div>
</template>

<script lang="ts">
export default { name: 'Logs' };
</script>
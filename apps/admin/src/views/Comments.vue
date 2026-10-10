<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { commentApi, settingsApi } from '@/api';
import type { Comment } from '@myblog/shared';
import { formatRelative } from '@myblog/shared';

const loading = ref(false);
const items = ref<(Comment & { postTitle: string })[]>([]);
const total = ref(0);
const page = ref(1);
const status = ref('pending');
const selected = ref<Comment[]>([]);
const commentEnabled = ref(false);

const tabs = [
  { value: 'pending', label: '待审核' },
  { value: 'approved', label: '已通过' },
  { value: 'spam', label: '垃圾箱' },
  { value: 'deleted', label: '已删除' },
  { value: '', label: '全部' }
];

async function load(): Promise<void> {
  loading.value = true;
  try {
    const r = await commentApi.list({ status: status.value || undefined, page: page.value, pageSize: 20 });
    items.value = r.items;
    total.value = r.total;
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '加载失败');
  } finally {
    loading.value = false;
  }
}

async function setStatus(c: Comment, s: Comment['status']): Promise<void> {
  try {
    await commentApi.update(c.id, s);
    ElMessage.success('已更新');
    load();
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '操作失败');
  }
}

async function batch(s: string): Promise<void> {
  const ids = selected.value.map((c) => c.id);
  if (!ids.length) return;
  try {
    const r = await commentApi.batch(ids, s);
    ElMessage.success(`已处理 ${r.affected} 条`);
    load();
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '操作失败');
  }
}

async function remove(c: Comment): Promise<void> {
  await ElMessageBox.confirm('确定永久删除这条评论？', '确认', { type: 'warning' });
  try {
    await commentApi.remove(c.id);
    ElMessage.success('已删除');
    load();
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '删除失败');
  }
}

onMounted(async () => {
  const s = await settingsApi.get();
  commentEnabled.value = s.commentEnabled;
  load();
});
</script>

<template>
  <div>
    <el-alert v-if="!commentEnabled" type="info" :closable="false" style="margin-bottom: 16px">
      <template #title>
        <div style="font-size: 12.5px">
          评论功能当前处于<b>关闭</b>状态。请到
          <router-link to="/settings" style="color: var(--mb-accent)">站点设置 → 评论设置</router-link>
          开启后访客才能提交评论。
        </div>
      </template>
    </el-alert>

    <div class="mb-table-toolbar">
      <el-radio-group v-model="status" @change="((page = 1), load())">
        <el-radio-button v-for="t in tabs" :key="t.value" :value="t.value">{{ t.label }}</el-radio-button>
      </el-radio-group>
      <div class="mb-toolbar-spacer"></div>
      <template v-if="selected.length">
        <span class="mb-muted" style="font-size: 12.5px">已选 {{ selected.length }} 条</span>
        <el-button size="small" type="success" plain @click="batch('approved')">批量通过</el-button>
        <el-button size="small" type="warning" plain @click="batch('spam')">标记垃圾</el-button>
        <el-button size="small" type="danger" plain @click="batch('deleted')">批量删除</el-button>
      </template>
    </div>

    <div class="mb-card" style="padding: 0">
      <el-table v-loading="loading" :data="items" @selection-change="(v: Comment[]) => (selected = v)">
        <el-table-column type="selection" width="42" />
        <el-table-column label="评论内容" min-width="300">
          <template #default="{ row }">
            <div style="font-size: 13.5px; white-space: pre-wrap; word-break: break-word; line-height: 1.65">{{ row.content }}</div>
          </template>
        </el-table-column>
        <el-table-column label="访客" width="140">
          <template #default="{ row }">
            <div style="font-size: 13px; font-weight: 540">{{ row.authorName }}</div>
            <div class="mb-muted" style="font-size: 11.5px">{{ row.authorEmail || '未留邮箱' }}</div>
          </template>
        </el-table-column>
        <el-table-column label="文章" min-width="150" show-overflow-tooltip>
          <template #default="{ row }">{{ row.postTitle }}</template>
        </el-table-column>
        <el-table-column label="时间" width="100">
          <template #default="{ row }">{{ formatRelative(row.createdAt) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="150" fixed="right">
          <template #default="{ row }">
            <el-button v-if="row.status !== 'approved'" link type="success" size="small" @click="setStatus(row, 'approved')">
              通过
            </el-button>
            <el-button v-if="row.status !== 'spam'" link type="warning" size="small" @click="setStatus(row, 'spam')">
              垃圾
            </el-button>
            <el-button link type="danger" size="small" @click="remove(row)">删除</el-button>
          </template>
        </el-table-column>
        <template #empty>
          <el-empty :description="status === 'pending' ? '没有待审核的评论' : '暂无评论'" :image-size="80" />
        </template>
      </el-table>
    </div>

    <div v-if="total > 20" style="margin-top: 14px; display: flex; justify-content: flex-end">
      <el-pagination v-model:current-page="page" :page-size="20" :total="total" layout="total, prev, pager, next" background @current-change="load" />
    </div>
  </div>
</template>

<script lang="ts">
export default { name: 'Comments' };
</script>
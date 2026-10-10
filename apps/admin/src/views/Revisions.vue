<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { postApi } from '@/api';
import type { Revision } from '@myblog/shared';
import { formatDate, formatRelative } from '@myblog/shared';
import { renderMarkdown } from '@myblog/shared';

const route = useRoute();
const router = useRouter();
const postId = Number(route.params.id);

const loading = ref(true);
const revisions = ref<Revision[]>([]);
const compareDialog = ref(false);
const compareTarget = ref<Revision | null>(null);
const compareHtml = ref('');

async function load(): Promise<void> {
  loading.value = true;
  try {
    revisions.value = await postApi.revisions(postId);
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '加载失败');
  } finally {
    loading.value = false;
  }
}

async function openCompare(r: Revision): Promise<void> {
  try {
    const full = await postApi.revision(postId, r.id);
    compareTarget.value = full;
    compareHtml.value = full.html || renderMarkdown(full.content).html;
    compareDialog.value = true;
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '加载版本失败');
  }
}

async function restore(r: Revision): Promise<void> {
  await ElMessageBox.confirm(
    `将内容恢复到版本 v${r.revision}（${formatRelative(r.createdAt)}）？\n\n当前内容会先自动备份为快照，不会丢失。`,
    '恢复历史版本',
    { type: 'warning', confirmButtonText: '确认恢复' }
  );
  try {
    await postApi.restoreRevision(postId, r.id);
    ElMessage.success(`已恢复到 v${r.revision}`);
    compareDialog.value = false;
    router.push(`/posts/${postId}`);
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '恢复失败');
  }
}

onMounted(load);
</script>

<template>
  <div>
    <div class="mb-table-toolbar">
      <el-button @click="router.push(`/posts/${postId}`)">
        <el-icon><Back /></el-icon><span style="margin-left: 5px">返回编辑</span>
      </el-button>
      <div class="mb-toolbar-spacer"></div>
      <span class="mb-muted" style="font-size: 12.5px">
        自动保存的快照已自动限量保留（最多 30 个版本），可随时回滚
      </span>
    </div>

    <div class="mb-card" style="padding: 0">
      <el-table v-loading="loading" :data="revisions">
        <el-table-column label="版本" width="90">
          <template #default="{ row }"><el-tag size="small" effect="plain">v{{ row.revision }}</el-tag></template>
        </el-table-column>
        <el-table-column label="标题" min-width="220" prop="title" show-overflow-tooltip />
        <el-table-column label="操作者" width="110" prop="createdBy">
          <template #default="{ row }">{{ row.createdBy ?? '系统' }}</template>
        </el-table-column>
        <el-table-column label="保存时间" width="180">
          <template #default="{ row }">
            <div>{{ formatDate(row.createdAt, true) }}</div>
            <div class="mb-muted" style="font-size: 11.5px">{{ formatRelative(row.createdAt) }}</div>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="160" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="openCompare(row)">查看 / 对比</el-button>
            <el-button link type="warning" size="small" @click="restore(row)">恢复</el-button>
          </template>
        </el-table-column>
        <template #empty>
          <el-empty description="还没有历史版本" :image-size="80" />
        </template>
      </el-table>
    </div>

    <el-dialog v-model="compareDialog" :title="compareTarget ? `版本 v${compareTarget.revision} 内容预览` : ''" width="760px" top="5vh">
      <div v-if="compareTarget" style="max-height: 62vh; overflow-y: auto">
        <h2 style="font-size: 19px; font-weight: 640; margin: 0 0 6px">{{ compareTarget.title }}</h2>
        <p class="mb-muted" style="font-size: 12px; margin: 0 0 14px">
          {{ formatDate(compareTarget.createdAt, true) }} · {{ compareTarget.createdBy ?? '系统' }}
        </p>
        <div class="mb-preview-body" style="border-top: 1px solid #e8e8ea; padding-top: 14px" v-html="compareHtml"></div>
      </div>
      <template #footer>
        <el-button @click="compareDialog = false">关闭</el-button>
        <el-button type="warning" @click="compareTarget && restore(compareTarget)">恢复此版本</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script lang="ts">
export default { name: 'Revisions' };
</script>
<script setup lang="ts">
import { onMounted, reactive, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { postApi, categoryApi } from '@/api';
import type { Category, PostSummary, PostStatus } from '@myblog/shared';
import { formatDate, formatRelative } from '@myblog/shared';

const router = useRouter();

const loading = ref(false);
const items = ref<PostSummary[]>([]);
const total = ref(0);
const counts = ref<Record<string, number>>({});
const categories = ref<Category[]>([]);
const selected = ref<PostSummary[]>([]);

const query = reactive({
  status: 'any' as PostStatus | 'any',
  q: '',
  categoryId: undefined as number | undefined,
  page: 1,
  pageSize: 20
});

const statusTabs = [
  { value: 'any', label: '全部' },
  { value: 'published', label: '已发布' },
  { value: 'draft', label: '草稿' },
  { value: 'scheduled', label: '定时' },
  { value: 'archived', label: '归档' },
  { value: 'trashed', label: '回收站' }
];

const statusMeta: Record<string, { type: 'success' | 'info' | 'warning' | 'danger'; label: string }> = {
  published: { type: 'success', label: '已发布' },
  draft: { type: 'info', label: '草稿' },
  scheduled: { type: 'warning', label: '定时' },
  archived: { type: 'warning', label: '归档' },
  trashed: { type: 'danger', label: '回收站' }
};

async function load(): Promise<void> {
  loading.value = true;
  try {
    const r = await postApi.list({
      status: query.status,
      type: 'post',
      q: query.q.trim() || undefined,
      categoryId: query.categoryId,
      page: query.page,
      pageSize: query.pageSize
    });
    items.value = r.items;
    total.value = r.total;
    counts.value = r.counts;
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '加载失败');
  } finally {
    loading.value = false;
  }
}

async function batch(action: string): Promise<void> {
  const ids = selected.value.map((p) => p.id);
  if (!ids.length) return;
  try {
    const r = await postApi.batch(ids, action);
    ElMessage.success(`已处理 ${r.affected} 篇`);
    load();
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '操作失败');
  }
}

async function duplicate(p: PostSummary): Promise<void> {
  try {
    await postApi.duplicate(p.id);
    ElMessage.success('已复制为新草稿');
    load();
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '复制失败');
  }
}

async function trashOne(p: PostSummary): Promise<void> {
  await ElMessageBox.confirm(`「${p.title}」将移入回收站`, '确认', { type: 'warning' });
  try {
    await postApi.trash(p.id);
    ElMessage.success('已移入回收站');
    load();
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '操作失败');
  }
}

async function restoreOne(p: PostSummary): Promise<void> {
  try {
    await postApi.restore(p.id);
    ElMessage.success('已恢复到草稿箱');
    load();
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '操作失败');
  }
}

async function destroyOne(p: PostSummary): Promise<void> {
  await ElMessageBox.confirm(
    `永久删除「${p.title}」？此操作不可恢复，文章及其历史版本都会被清除。`,
    '永久删除',
    { type: 'error', confirmButtonText: '永久删除', confirmButtonClass: 'el-button--danger' }
  );
  try {
    await postApi.destroy(p.id);
    ElMessage.success('已永久删除');
    load();
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '删除失败');
  }
}

async function quickPublish(p: PostSummary): Promise<void> {
  try {
    await postApi.publish(p.id);
    ElMessage.success('已发布');
    load();
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '发布失败');
  }
}

function copyLink(p: PostSummary): void {
  const url = `${location.origin}/posts/${p.slug}`;
  navigator.clipboard?.writeText(url);
  ElMessage.success('链接已复制');
}

watch(() => [query.status, query.page], () => load());
watch(() => query.q, () => {
  query.page = 1;
  load();
});

onMounted(async () => {
  categories.value = await categoryApi.list();
  load();
});
</script>

<template>
  <div>
    <div class="mb-table-toolbar">
      <el-radio-group v-model="query.status" size="small">
        <el-radio-button v-for="t in statusTabs" :key="t.value" :value="t.value">
          {{ t.label }}
          <span v-if="counts[t.value]" class="mb-muted">({{ counts[t.value] }})</span>
        </el-radio-button>
      </el-radio-group>

      <el-input
        v-model="query.q"
        placeholder="搜索标题或摘要"
        clearable
        size="default"
        style="width: 220px"
      />

      <el-select
        v-model="query.categoryId"
        placeholder="全部分类"
        clearable
        size="default"
        style="width: 150px"
        @change="((query.page = 1), load())"
      >
        <el-option v-for="c in categories" :key="c.id" :label="c.name" :value="c.id" />
      </el-select>

      <div class="mb-toolbar-spacer"></div>

      <template v-if="selected.length">
        <el-button size="small" type="success" plain @click="batch('publish')">批量发布 ({{ selected.length }})</el-button>
        <el-button size="small" plain @click="batch('archive')">批量归档</el-button>
        <el-button size="small" type="danger" plain @click="batch('trash')">批量删除</el-button>
      </template>

      <el-button type="primary" @click="router.push('/posts/new')">
        <el-icon><EditPen /></el-icon><span style="margin-left: 5px">写新文章</span>
      </el-button>
    </div>

    <div class="mb-card" style="padding: 0">
      <el-table
        v-loading="loading"
        :data="items"
        @selection-change="(v: PostSummary[]) => (selected = v)"
      >
        <el-table-column type="selection" width="42" />
        <el-table-column label="标题" min-width="320">
          <template #default="{ row }">
            <div class="mb-post-title-cell">
              <router-link :to="`/posts/${row.id}`" class="mb-post-title-link">{{ row.title }}</router-link>
              <div class="mb-post-meta">
                <el-tag size="small" :type="statusMeta[row.status]?.type" effect="plain">
                  {{ statusMeta[row.status]?.label }}
                </el-tag>
                <el-tag v-if="row.isFeatured" size="small" type="warning" effect="plain">精选</el-tag>
                <span v-if="row.excerpt" style="max-width: 260px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap">
                  {{ row.excerpt }}
                </span>
              </div>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="分类" width="120">
          <template #default="{ row }">
            <el-tag v-if="row.categoryName" size="small" effect="plain">{{ row.categoryName }}</el-tag>
            <span v-else class="mb-muted">—</span>
          </template>
        </el-table-column>
        <el-table-column label="字数" width="80" prop="wordCount" />
        <el-table-column label="阅读" width="70">
          <template #default="{ row }">{{ row.readingTime }} 分钟</template>
        </el-table-column>
        <el-table-column label="发布时间" width="115">
          <template #default="{ row }">
            <span v-if="row.publishedAt">{{ formatDate(row.publishedAt) }}</span>
            <span v-else-if="row.status === 'scheduled'" class="mb-muted">计划中</span>
            <span v-else class="mb-muted">未发布</span>
          </template>
        </el-table-column>
        <el-table-column label="更新于" width="110">
          <template #default="{ row }">{{ formatRelative(row.updatedAt) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="180" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="router.push(`/posts/${row.id}`)">编辑</el-button>
            <el-dropdown>
              <el-button link type="primary" size="small">更多</el-button>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item v-if="row.status !== 'published' && row.status !== 'trashed'" @click="quickPublish(row)">
                    立即发布
                  </el-dropdown-item>
                  <el-dropdown-item @click="copyLink(row)">复制链接</el-dropdown-item>
                  <el-dropdown-item @click="duplicate(row)">复制文章</el-dropdown-item>
                  <el-dropdown-item @click="router.push(`/revisions/${row.id}`)">版本历史</el-dropdown-item>
                  <el-dropdown-item v-if="row.status === 'published'" divided @click="router.push(`/posts/${row.id}`)">
                    查看前台
                  </el-dropdown-item>
                  <el-dropdown-item v-if="row.status === 'trashed'" divided @click="restoreOne(row)">
                    恢复到草稿箱
                  </el-dropdown-item>
                  <el-dropdown-item v-else divided @click="trashOne(row)">移入回收站</el-dropdown-item>
                  <el-dropdown-item v-if="row.status === 'trashed'" divided @click="destroyOne(row)">
                    <span style="color: var(--el-color-danger)">永久删除</span>
                  </el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
          </template>
        </el-table-column>

        <template #empty>
          <el-empty :description="query.q ? '没有匹配的文章' : '还没有文章，点击右上角开始写作'" :image-size="90">
            <el-button type="primary" @click="router.push('/posts/new')">写新文章</el-button>
          </el-empty>
        </template>
      </el-table>
    </div>

    <div v-if="total > query.pageSize" style="margin-top: 14px; display: flex; justify-content: flex-end">
      <el-pagination
        v-model:current-page="query.page"
        :page-size="query.pageSize"
        :total="total"
        layout="total, prev, pager, next"
        background
        @current-change="load"
      />
    </div>
  </div>
</template>

<script lang="ts">
export default { name: 'Posts' };
</script>
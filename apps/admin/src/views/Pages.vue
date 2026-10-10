<script setup lang="ts">
import { onMounted, reactive, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { postApi } from '@/api';
import type { PostSummary } from '@myblog/shared';
import { formatDate, formatRelative } from '@myblog/shared';

const router = useRouter();
const loading = ref(false);
const items = ref<PostSummary[]>([]);
const query = reactive({ q: '', status: 'any', page: 1, pageSize: 50 });

const PRESET_HINTS: Record<string, string> = {
  about: '前台「关于我」页面会读取 slug 为 about 的已发布页面',
  projects: '前台「项目」页面会读取 slug 为 projects 的已发布页面',
  privacy: '前台「隐私政策」页面会读取 slug 为 privacy 的已发布页面',
  links: '前台「友情链接」有独立的友链管理'
};

const statusLabel = {
  draft: '草稿',
  published: '已发布',
  archived: '归档',
  trashed: '回收站',
  scheduled: '定时'
} as const;

async function openFront(row: PostSummary): Promise<void> {
  window.open(`/p/${row.slug}`, '_blank', 'noopener');
}

async function load(): Promise<void> {
  loading.value = true;
  try {
    const r = await postApi.list({
      type: 'page',
      status: query.status as never,
      q: query.q.trim() || undefined,
      page: query.page,
      pageSize: query.pageSize
    });
    items.value = r.items;
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '加载失败');
  } finally {
    loading.value = false;
  }
}

async function create(slug: string): Promise<void> {
  const title = { about: '关于我', projects: '项目', privacy: '隐私政策' }[slug] ?? '新页面';
  try {
    const p = await postApi.create({
      title,
      slug,
      content: `## ${title}\n\n在这里编写内容。`,
      type: 'page',
      status: 'draft'
    });
    ElMessage.success('已创建，去编辑内容吧');
    router.push(`/posts/${p.id}`);
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '创建失败');
  }
}

async function createCustom(): Promise<void> {
  try {
    const { value: slug } = await ElMessageBox.prompt('请输入页面别名（英文 URL 路径）', '新建页面', {
      inputPlaceholder: '例如 resume',
      inputValidator: (v) => {
        if (!v) return '请输入别名';
        if (!/^[a-z0-9][a-z0-9-]{0,60}$/i.test(v)) return '只能包含字母、数字与连字符';
        return true;
      }
    });
    const p = await postApi.create({
      title: slug,
      slug,
      content: `## ${slug}\n\n在这里编写内容。`,
      type: 'page',
      status: 'draft'
    });
    router.push(`/posts/${p.id}`);
  } catch {
    /* 用户取消 */
  }
}

async function remove(p: PostSummary): Promise<void> {
  await ElMessageBox.confirm(`将「${p.title}」移入回收站？`, '确认', { type: 'warning' });
  try {
    await postApi.trash(p.id);
    ElMessage.success('已移入回收站');
    load();
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '操作失败');
  }
}

watch(() => [query.status, query.page], () => load());
onMounted(load);
</script>

<template>
  <div>
    <el-alert type="info" :closable="false" style="margin-bottom: 16px">
      <template #title>
        <div style="font-size: 12.5px; line-height: 1.8">
          独立页面与文章共用 Markdown 编辑器，但拥有单独的页面类型。前台特定路由会读取固定 slug：
          <code>about</code>（关于我）、<code>projects</code>（项目）、<code>privacy</code>（隐私政策）。
          其他页面通过 <code>/p/&lt;slug&gt;</code> 访问。
        </div>
      </template>
    </el-alert>

    <div class="mb-table-toolbar">
      <el-input v-model="query.q" placeholder="搜索页面标题" clearable style="width: 220px" />
      <el-select v-model="query.status" style="width: 130px" @change="((query.page = 1), load())">
        <el-option label="全部状态" value="any" />
        <el-option label="已发布" value="published" />
        <el-option label="草稿" value="draft" />
        <el-option label="回收站" value="trashed" />
      </el-select>
      <div class="mb-toolbar-spacer"></div>
      <el-button @click="create('about')">创建「关于我」</el-button>
      <el-button @click="create('projects')">创建「项目」</el-button>
      <el-button @click="create('privacy')">创建「隐私政策」</el-button>
      <el-button type="primary" @click="createCustom">
        <el-icon><Plus /></el-icon><span style="margin-left: 5px">新建页面</span>
      </el-button>
    </div>

    <div class="mb-card" style="padding: 0">
      <el-table v-loading="loading" :data="items">
        <el-table-column label="页面" min-width="260">
          <template #default="{ row }">
            <div class="mb-post-title-cell">
              <router-link :to="`/posts/${row.id}`" class="mb-post-title-link">{{ row.title }}</router-link>
              <div class="mb-post-meta">
                <code style="font-size: 11.5px">/{{ row.slug }}</code>
                <span v-if="PRESET_HINTS[row.slug]" style="color: #b45309; font-size: 11.5px">
                  {{ PRESET_HINTS[row.slug] }}
                </span>
              </div>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <el-tag
              size="small"
              effect="plain"
              :type="row.status === 'published' ? 'success' : row.status === 'trashed' ? 'danger' : 'info'"
            >
              {{ statusLabel[row.status as keyof typeof statusLabel] }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="发布时间" width="120">
          <template #default="{ row }">{{ row.publishedAt ? formatDate(row.publishedAt) : '—' }}</template>
        </el-table-column>
        <el-table-column label="更新于" width="110">
          <template #default="{ row }">{{ formatRelative(row.updatedAt) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="200" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="router.push(`/posts/${row.id}`)">编辑</el-button>
            <el-button
              v-if="row.status === 'published'"
              link
              type="primary"
              size="small"
              @click="openFront(row)"
            >
              查看
            </el-button>
            <el-button link type="danger" size="small" @click="remove(row)">删除</el-button>
          </template>
        </el-table-column>
        <template #empty>
          <el-empty description="还没有独立页面" :image-size="90" />
        </template>
      </el-table>
    </div>
  </div>
</template>

<script lang="ts">
export default { name: 'Pages' };
</script>
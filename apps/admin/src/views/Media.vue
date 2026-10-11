<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { mediaApi } from '@/api';
import type { Media } from '@myblog/shared';
import { formatBytes, formatDate } from '@myblog/shared';

const loading = ref(false);
const uploading = ref(false);
const items = ref<Media[]>([]);
const total = ref(0);
const page = ref(1);
const pageSize = ref(40);
const stats = ref({ count: 0, totalBytes: 0, images: 0 });
const dragOver = ref(false);
const fileInput = ref<HTMLInputElement | null>(null);
const query = reactive({ q: '', mime: 'all' });

const detail = ref<Media | null>(null);
const detailDialog = ref(false);

async function load(): Promise<void> {
  loading.value = true;
  try {
    const r = await mediaApi.list({
      page: page.value,
      pageSize: pageSize.value,
      q: query.q.trim() || undefined,
      mime: query.mime === 'all' ? undefined : query.mime
    });
    items.value = r.items;
    total.value = r.total;
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '加载失败');
  } finally {
    loading.value = false;
  }
}

async function loadStats(): Promise<void> {
  try {
    stats.value = await mediaApi.stats();
  } catch {
    /* 忽略 */
  }
}

async function upload(files: FileList | File[]): Promise<void> {
  const list = Array.from(files);
  if (!list.length) return;
  uploading.value = true;
  let ok = 0;
  const failed: string[] = [];
  for (const f of list) {
    try {
      await mediaApi.upload(f, { altText: f.name.replace(/\.[^.]+$/, '') });
      ok++;
    } catch (e) {
      failed.push(`${f.name}：${e instanceof Error ? e.message : '失败'}`);
    }
  }
  uploading.value = false;
  if (ok) ElMessage.success(`成功上传 ${ok} 个文件`);
  if (failed.length) {
    ElMessageBox.alert(failed.slice(0, 8).join('\n') + (failed.length > 8 ? `\n…还有 ${failed.length - 8} 个失败` : ''), '部分文件上传失败', { type: 'warning' });
  }
  load();
  loadStats();
}

function onDrop(e: DragEvent): void {
  dragOver.value = false;
  if (e.dataTransfer?.files.length) void upload(e.dataTransfer.files);
}

function openDetail(m: Media): void {
  detail.value = m;
  detailDialog.value = true;
}

async function saveDetail(): Promise<void> {
  if (!detail.value) return;
  try {
    const updated = await mediaApi.update(detail.value.id, {
      altText: detail.value.altText ?? '',
      caption: detail.value.caption ?? '',
      originalName: detail.value.originalName
    });
    detail.value = updated;
    ElMessage.success('已保存');
    load();
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '保存失败');
  }
}

async function remove(m: Media): Promise<void> {
  await ElMessageBox.confirm(`确定删除「${m.originalName}」？`, '删除媒体', { type: 'warning' });
  try {
    await mediaApi.remove(m.id);
    ElMessage.success('已删除');
    detailDialog.value = false;
    load();
    loadStats();
  } catch (e) {
    // 409 表示仍被引用
    const err = e as { status?: number; message?: string };
    if (err.status === 409) {
      const usage = await mediaApi.usage(m.id);
      const list = usage.references.map((r) => `· ${r.title}（${r.kind}）`).join('\n');
      try {
        await ElMessageBox.confirm(
          `该文件仍被以下内容引用：\n${list}\n\n强制删除会导致这些内容出现坏图。确定强制删除吗？`,
          '文件仍被引用',
          { type: 'warning', confirmButtonText: '仍然删除', confirmButtonClass: 'el-button--danger' }
        );
        await mediaApi.remove(m.id, true);
        ElMessage.success('已强制删除');
        detailDialog.value = false;
        load();
        loadStats();
      } catch {
        /* 用户取消 */
      }
    } else {
      ElMessage.error(err.message ?? '删除失败');
    }
  }
}

async function copyLink(m: Media): Promise<void> {
  await navigator.clipboard?.writeText(m.url);
  ElMessage.success('链接已复制');
}

async function copyMarkdown(m: Media): Promise<void> {
  const md = `![${m.altText || m.originalName}](${m.url})`;
  await navigator.clipboard?.writeText(md);
  ElMessage.success('Markdown 引用已复制');
}

onMounted(() => {
  load();
  loadStats();
});
</script>

<template>
  <div>
    <div class="mb-stat-grid mb-mb-16">
      <div class="mb-stat">
        <div class="mb-stat-label">文件总数</div>
        <div class="mb-stat-value">{{ stats.count }}</div>
        <div class="mb-stat-sub">其中图片 {{ stats.images }} 个</div>
      </div>
      <div class="mb-stat">
        <div class="mb-stat-label">占用空间</div>
        <div class="mb-stat-value">{{ formatBytes(stats.totalBytes) }}</div>
        <div class="mb-stat-sub">存储在 Vercel Blob</div>
      </div>
      <div class="mb-stat" style="display: grid; place-items: center">
        <el-button type="primary" :loading="uploading" @click="fileInput?.click()">
          <el-icon><Upload /></el-icon><span style="margin-left: 6px">选择文件上传</span>
        </el-button>
        <input ref="fileInput" type="file" multiple style="display: none" @change="(e) => upload((e.target as HTMLInputElement).files ?? [])" />
      </div>
    </div>

    <div
      class="mb-dropzone mb-mb-16"
      :class="{ 'is-over': dragOver }"
      @click="fileInput?.click()"
      @dragover.prevent="dragOver = true"
      @dragleave="dragOver = false"
      @drop="onDrop"
      @paste="(e) => { const f = (e as ClipboardEvent).clipboardData?.files; if (f?.length) upload(f); }"
    >
      <div v-if="uploading">正在上传，请稍候…</div>
      <div v-else>把文件拖到这里，或点击选择（支持粘贴截图）· 单次可多选 · 默认上限 10MB</div>
    </div>

    <div class="mb-table-toolbar">
      <el-input v-model="query.q" placeholder="搜索文件名或替代文本" clearable style="width: 240px" />
      <el-radio-group v-model="query.mime" @change="((page = 1), load())">
        <el-radio-button value="all">全部</el-radio-button>
        <el-radio-button value="image">图片</el-radio-button>
        <el-radio-button value="doc">文档</el-radio-button>
      </el-radio-group>
    </div>

    <div v-loading="loading" class="mb-card">
      <el-empty v-if="!items.length && !loading" description="还没有上传任何文件" :image-size="90" />
      <div v-else class="mb-media-grid">
        <div v-for="m in items" :key="m.id" class="mb-media-card" @click="openDetail(m)">
          <img
            v-if="m.mimeType.startsWith('image/')"
            :src="m.url"
            :alt="m.altText || m.originalName"
            class="mb-media-thumb"
            loading="lazy"
          />
          <div v-else class="mb-media-thumb" style="display: grid; place-items: center; color: #a1a1aa">
            {{ m.mimeType.split('/')[1]?.toUpperCase() }}
          </div>
          <div class="mb-media-info">
            <div class="mb-media-name" :title="m.originalName">{{ m.originalName }}</div>
            <div class="mb-media-sub">
              {{ formatBytes(m.fileSize) }}
              <span v-if="m.width && m.height"> · {{ m.width }}×{{ m.height }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div v-if="total > pageSize" style="margin-top: 14px; display: flex; justify-content: flex-end">
      <el-pagination
        v-model:current-page="page"
        :page-size="pageSize"
        :total="total"
        layout="total, prev, pager, next"
        background
        @current-change="load"
      />
    </div>

    <!-- 详情 -->
    <el-dialog v-model="detailDialog" title="媒体详情" width="620px">
      <div v-if="detail">
        <div style="text-align: center; margin-bottom: 16px">
          <img
            v-if="detail.mimeType.startsWith('image/')"
            :src="detail.url"
            :alt="detail.altText || detail.originalName"
            style="max-width: 100%; max-height: 300px; border-radius: 10px; border: 1px solid #e8e8ea"
          />
          <div v-else class="mb-muted">非图片文件</div>
        </div>

        <el-descriptions :column="2" border size="small">
          <el-descriptions-item label="文件名">{{ detail.originalName }}</el-descriptions-item>
          <el-descriptions-item label="大小">{{ formatBytes(detail.fileSize) }}</el-descriptions-item>
          <el-descriptions-item label="类型">{{ detail.mimeType }}</el-descriptions-item>
          <el-descriptions-item label="尺寸">
            {{ detail.width && detail.height ? `${detail.width} × ${detail.height}` : '—' }}
          </el-descriptions-item>
          <el-descriptions-item label="上传时间" :span="2">{{ formatDate(detail.createdAt, true) }}</el-descriptions-item>
          <el-descriptions-item label="链接" :span="2">
            <a :href="detail.url" target="_blank" rel="noopener" style="word-break: break-all; font-size: 12px">{{ detail.url }}</a>
          </el-descriptions-item>
        </el-descriptions>

        <el-form label-position="top" style="margin-top: 14px">
          <el-form-item label="文件名">
            <el-input v-model="detail.originalName" />
          </el-form-item>
          <el-form-item label="替代文本（alt）—— 对无障碍与 SEO 很重要">
            <el-input v-model="detail.altText" placeholder="描述图片内容，便于读屏软件与搜索引擎理解" />
          </el-form-item>
          <el-form-item label="图注（显示在图片下方）">
            <el-input v-model="detail.caption" placeholder="可选" />
          </el-form-item>
        </el-form>

        <div class="mb-flex mb-gap-2" style="flex-wrap: wrap">
          <el-button size="small" @click="copyLink(detail)">复制链接</el-button>
          <el-button size="small" @click="copyMarkdown(detail)">复制 Markdown</el-button>
          <el-button size="small" type="primary" @click="saveDetail">保存</el-button>
          <el-button size="small" type="danger" plain style="margin-left: auto" @click="remove(detail)">删除</el-button>
        </div>
      </div>
    </el-dialog>
  </div>
</template>

<script lang="ts">
export default { name: 'Media' };
</script>
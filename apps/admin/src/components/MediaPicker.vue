<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { ElMessage } from 'element-plus';
import { mediaApi } from '@/api';
import type { Media } from '@myblog/shared';
import { formatBytes, formatDate } from '@myblog/shared';

const visible = defineModel<boolean>({ default: false });
const emit = defineEmits<{ pick: [media: Media] }>();

const loading = ref(false);
const uploading = ref(false);
const items = ref<Media[]>([]);
const keyword = ref('');
const mimeFilter = ref<'all' | 'image' | 'doc'>('image');
const dragOver = ref(false);
const fileInput = ref<HTMLInputElement | null>(null);

async function load(): Promise<void> {
  loading.value = true;
  try {
    const r = await mediaApi.list({
      page: 1,
      pageSize: 60,
      q: keyword.value.trim() || undefined,
      mime: mimeFilter.value === 'all' ? undefined : mimeFilter.value
    });
    items.value = r.items;
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '加载失败');
  } finally {
    loading.value = false;
  }
}

async function upload(files: FileList | File[]): Promise<void> {
  const list = Array.from(files);
  if (!list.length) return;
  uploading.value = true;
  let ok = 0;
  for (const f of list) {
    try {
      await mediaApi.upload(f, { altText: f.name.replace(/\.[^.]+$/, '') });
      ok++;
    } catch (e) {
      ElMessage.error(`${f.name}：${e instanceof Error ? e.message : '上传失败'}`);
    }
  }
  uploading.value = false;
  if (ok) {
    ElMessage.success(`成功上传 ${ok} 个文件`);
    load();
  }
}

function onPick(m: Media): void {
  emit('pick', m);
  visible.value = false;
}

async function onDrop(e: DragEvent): Promise<void> {
  dragOver.value = false;
  const files = e.dataTransfer?.files;
  if (files?.length) await upload(files);
}

function onPaste(e: ClipboardEvent): Promise<void> {
  const items = e.clipboardData?.items;
  if (!items) return Promise.resolve();
  for (const item of Array.from(items)) {
    if (item.type.startsWith('image/')) {
      const f = item.getAsFile();
      if (f) {
        e.preventDefault();
        return upload([f]);
      }
    }
  }
  return Promise.resolve();
}

watch([keyword, mimeFilter], () => void load());
watch(visible, (v) => {
  if (v && !items.value.length) void load();
});
onMounted(() => {
  if (visible.value) void load();
});
</script>

<template>
  <el-dialog v-model="visible" title="媒体库" width="820px" top="6vh">
    <div class="mb-mb-16" style="display: flex; gap: 10px; flex-wrap: wrap; align-items: center">
      <el-input
        v-model="keyword"
        placeholder="搜索文件名或替代文本"
        clearable
        style="flex: 1; min-width: 180px"
        @keyup.enter="load"
      />
      <el-radio-group v-model="mimeFilter">
        <el-radio-button value="image">图片</el-radio-button>
        <el-radio-button value="all">全部</el-radio-button>
        <el-radio-button value="doc">文档</el-radio-button>
      </el-radio-group>
      <el-button type="primary" :loading="uploading" @click="fileInput?.click()">
        <el-icon><Upload /></el-icon><span style="margin-left: 5px">上传</span>
      </el-button>
      <input
        ref="fileInput"
        type="file"
        multiple
        accept="image/*,.pdf,.txt,.md,.zip"
        style="display: none"
        @change="(e) => upload((e.target as HTMLInputElement).files ?? [])"
      />
    </div>

    <div
      class="mb-dropzone"
      :class="{ 'is-over': dragOver }"
      style="margin-bottom: 14px; padding: 20px"
      @click="fileInput?.click()"
      @dragover.prevent="dragOver = true"
      @dragleave="dragOver = false"
      @drop="onDrop"
      @paste="onPaste"
    >
      <div v-if="uploading">正在上传…</div>
      <div v-else>拖拽图片到此处，或点击选择文件（也可直接粘贴截图）</div>
    </div>

    <div v-loading="loading" style="min-height: 200px">
      <el-empty v-if="!items.length && !loading" description="还没有媒体文件" :image-size="70" />
      <div v-else class="mb-media-grid">
        <div v-for="m in items" :key="m.id" class="mb-media-card" @click="onPick(m)">
          <img v-if="m.mimeType.startsWith('image/')" :src="m.url" :alt="m.altText || m.originalName" class="mb-media-thumb" loading="lazy" />
          <div v-else class="mb-media-thumb" style="display: grid; place-items: center; color: #a1a1aa; font-size: 12px">
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

    <template #footer>
      <span class="mb-muted" style="font-size: 12px">
        共 {{ items.length }} 个文件 · 上限由后台设置（默认 10MB）· SVG 默认禁用
      </span>
      <el-button @click="visible = false">关闭</el-button>
    </template>
  </el-dialog>
</template>
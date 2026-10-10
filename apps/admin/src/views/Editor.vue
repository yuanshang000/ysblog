<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter, onBeforeRouteLeave } from 'vue-router';
import { ElMessage, ElMessageBox, ElNotification } from 'element-plus';
import { postApi, mediaApi, categoryApi, tagApi, ApiError } from '@/api';
import type { Category, Media, Post, Tag, TocItem } from '@myblog/shared';
import { renderMarkdown, countWords, readingTime, formatDate, formatRelative } from '@myblog/shared';

const route = useRoute();
const router = useRouter();

/* ---------------- 状态 ---------------- */

const postId = ref<number | null>(null);
const loading = ref(false);
const saving = ref(false);
const publishLoading = ref(false);
const revision = ref(0);

type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error' | 'conflict';
const saveState = ref<SaveState>('idle');
const lastSavedAt = ref<string | null>(null);
const saveError = ref<string>('');

const form = reactive({
  title: '',
  slug: '',
  content: '',
  excerpt: '',
  coverMediaId: null as number | null,
  coverAlt: '',
  type: 'post' as 'post' | 'page',
  categoryIds: [] as number[],
  tagNames: [] as string[],
  tagInput: [] as string[],
  seoTitle: '',
  seoDescription: '',
  canonicalUrl: '',
  robotsIndex: true,
  isFeatured: false,
  status: 'draft' as Post['status'],
  publishedAt: null as string | null,
  scheduledAt: null as string | null
});

const categories = ref<Category[]>([]);
const tags = ref<Tag[]>([]);

const viewMode = ref<'edit' | 'split' | 'preview'>('split');
const focusMode = ref(false);
const outlineOpen = ref(true);
const inspectorTab = ref<'publish' | 'seo'>('publish');
const mediaDialog = ref(false);
const scheduledDialog = ref(false);
const scheduledAt = ref('');
const fullscreen = ref(false);

/* ---------------- 派生数据 ---------------- */

const wordCount = computed(() => countWords(form.content));
const readTime = computed(() => readingTime(wordCount.value));
const preview = computed(() => renderMarkdown(form.content));
const outline = computed<TocItem[]>(() => renderMarkdown(form.content).toc);
const isDirty = computed(() => saveState.value === 'dirty' || saveState.value === 'saving');
const canPublish = computed(() => form.title.trim() && form.content.trim());
const isTrashed = computed(() => form.status === 'trashed');
/** 封面预览 URL：由媒体列表按 id 查得 */
const coverUrl = ref<string>('');
const coverMediaId = ref<number | null>(null);

const statusLabel: Record<string, string> = {
  draft: '草稿',
  published: '已发布',
  scheduled: '定时发布',
  archived: '已归档',
  trashed: '回收站'
};

/* ---------------- 本地恢复 ---------------- */

const DRAFT_KEY = (id: number | 'new') => `mb-draft-${id}`;

function saveLocal(): void {
  try {
    localStorage.setItem(
      DRAFT_KEY(postId.value ?? 'new'),
      JSON.stringify({
        title: form.title,
        content: form.content,
        excerpt: form.excerpt,
        savedAt: new Date().toISOString()
      })
    );
  } catch {
    /* 存储不可用时忽略 */
  }
}

function clearLocal(): void {
  try {
    localStorage.removeItem(DRAFT_KEY(postId.value ?? 'new'));
  } catch {
    /* 忽略 */
  }
}

function readLocal(): { title: string; content: string; excerpt: string; savedAt: string } | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY(postId.value ?? 'new'));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/* ---------------- 数据加载 ---------------- */

async function loadMeta(): Promise<void> {
  const [c, t] = await Promise.all([categoryApi.list(), tagApi.list()]);
  categories.value = c;
  tags.value = t;
}

function fillForm(p: Post): void {
  form.title = p.title;
  form.slug = p.slug;
  form.content = p.content;
  form.excerpt = p.excerpt ?? '';
  form.coverMediaId = p.coverMediaId;
  form.coverAlt = p.coverAlt ?? '';
  form.type = p.type;
  form.categoryIds = p.categories.map((c) => c.id);
  form.tagNames = p.tags.map((t) => t.name);
  form.seoTitle = p.seoTitle ?? '';
  form.seoDescription = p.seoDescription ?? '';
  form.canonicalUrl = p.canonicalUrl ?? '';
  form.robotsIndex = p.robotsIndex;
  form.isFeatured = p.isFeatured;
  form.status = p.status;
  form.publishedAt = p.publishedAt;
  form.scheduledAt = p.scheduledAt;
  revision.value = p.revision;
}

async function load(): Promise<void> {
  loading.value = true;
  try {
    await loadMeta();
    const idParam = route.params.id;
    if (idParam) {
      const id = Number(idParam);
      const p = await postApi.get(id);
      postId.value = p.id;
      fillForm(p);

      // 检查是否有未提交的本地草稿（自动保存失败时的兜底）
      const local = readLocal();
      if (local && local.content !== p.content) {
        const localTime = formatRelative(local.savedAt);
        try {
          await ElMessageBox.confirm(
            `检测到 ${localTime} 的本地未保存内容（${local.content.length} 字符）。是否恢复？选择「取消」将丢弃本地内容并使用服务器版本。`,
            '发现未保存的本地内容',
            { confirmButtonText: '恢复本地内容', cancelButtonText: '使用服务器版本', type: 'warning' }
          );
          form.title = local.title;
          form.content = local.content;
          form.excerpt = local.excerpt;
          saveState.value = 'dirty';
          ElMessage.success('已恢复本地内容，记得保存');
        } catch {
          clearLocal();
        }
      }
    } else {
      // 新建：检查是否有未提交的本地草稿
      const local = readLocal();
      if (local?.content) {
        try {
          await ElMessageBox.confirm('检测到未提交的新文章草稿，是否恢复？', '发现本地草稿', {
            confirmButtonText: '恢复',
            cancelButtonText: '丢弃'
          });
          form.title = local.title;
          form.content = local.content;
          form.excerpt = local.excerpt;
        } catch {
          clearLocal();
        }
      }
    }
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '加载失败');
  } finally {
    loading.value = false;
  }
}

/* ---------------- 保存 ---------------- */

function buildPayload(autoSave: boolean) {
  return {
    title: form.title.trim() || '无标题文章',
    slug: form.slug.trim(),
    content: form.content,
    excerpt: form.excerpt,
    coverMediaId: form.coverMediaId,
    coverAlt: form.coverAlt,
    type: form.type,
    categoryIds: form.categoryIds,
    tagNames: [...form.tagInput, ...form.tagNames].filter(Boolean),
    seoTitle: form.seoTitle || null,
    seoDescription: form.seoDescription || null,
    canonicalUrl: form.canonicalUrl || null,
    robotsIndex: form.robotsIndex,
    isFeatured: form.isFeatured,
    baseRevision: revision.value,
    autoSave
  };
}

async function doSave(autoSave = false): Promise<boolean> {
  if (isTrashed.value) return false;
  saving.value = true;
  if (!autoSave) saveState.value = 'saving';
  try {
    let saved: Post;
    if (postId.value) {
      saved = await postApi.update(postId.value, buildPayload(autoSave));
    } else {
      saved = await postApi.create(buildPayload(autoSave));
      postId.value = saved.id;
      // 用 replace 替换路由，避免后退返回新建页
      router.replace(`/posts/${saved.id}`);
    }
    revision.value = saved.revision;
    if (form.status !== saved.status) form.status = saved.status;
    saveState.value = 'saved';
    saveError.value = '';
    void refreshCoverUrl();
    lastSavedAt.value = new Date().toISOString();
    clearLocal();
    return true;
  } catch (e) {
    if (e instanceof ApiError && e.status === 409) {
      saveState.value = 'conflict';
      ElNotification({
        title: '内容冲突',
        message: '其他标签页或会话已修改这篇文章。请选择如何处理。',
        type: 'error',
        duration: 0,
        position: 'top-right'
      });
    } else {
      saveState.value = 'error';
      saveError.value = e instanceof Error ? e.message : '保存失败';
      // 自动保存失败必须保留本地副本，绝不清空编辑器
      saveLocal();
      if (!autoSave) ElMessage.error(saveError.value);
    }
    return false;
  } finally {
    saving.value = false;
  }
}

async function manualSave(): Promise<void> {
  const ok = await doSave(false);
  if (ok) ElMessage.success('已保存');
}

/** 从服务器重新加载（解决冲突） */
async function reloadFromServer(): Promise<void> {
  if (!postId.value) return;
  try {
    const p = await postApi.get(postId.value);
    fillForm(p);
    saveState.value = 'saved';
    clearLocal();
    ElMessage.success('已加载服务器最新版本');
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '加载失败');
  }
}

/** 强制覆盖：以本地内容为准（服务端 revision 已在冲突后失效，需重取） */
async function forceOverwrite(): Promise<void> {
  if (!postId.value) return;
  try {
    const p = await postApi.get(postId.value);
    revision.value = p.revision;
    const ok = await doSave(false);
    if (ok) ElMessage.success('已用本地内容覆盖');
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '覆盖失败');
  }
}

/* ---------------- 自动保存（防抖 1.5s） ---------------- */

let autoSaveTimer: ReturnType<typeof setTimeout> | null = null;
let autoSaveEnabled = ref(true);

function scheduleAutoSave(): void {
  if (autoSaveTimer) clearTimeout(autoSaveTimer);
  saveState.value = 'dirty';
  saveLocal();
  if (!autoSaveEnabled.value) return;
  autoSaveTimer = setTimeout(() => {
    if (saveState.value === 'dirty') void doSave(true);
  }, 1500);
}

// 监听内容变化（不监听自动保存结果，避免循环）
watch(
  () => [form.title, form.content, form.excerpt, form.slug, form.seoTitle, form.seoDescription],
  () => {
    if (loading.value) return;
    scheduleAutoSave();
  }
);

// 封面变化时刷新预览 URL
watch(() => form.coverMediaId, () => void refreshCoverUrl());

/* ---------------- 发布 ---------------- */

async function publish(): Promise<void> {
  if (!canPublish.value) {
    ElMessage.warning('标题和正文不能为空');
    return;
  }
  publishLoading.value = true;
  try {
    const ok = await doSave(false);
    if (!ok) return;
    const p = await postApi.publish(postId.value!);
form.status = p.status;
      if (p.publishedAt) form.publishedAt = p.publishedAt;
      revision.value = p.revision;
      await refreshCoverUrl();
      ElMessage.success('发布成功');
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '发布失败');
  } finally {
    publishLoading.value = false;
  }
}

async function openSchedule(): Promise<void> {
  if (!canPublish.value) {
    ElMessage.warning('标题和正文不能为空');
    return;
  }
  const defaultTime = form.scheduledAt
    ? new Date(form.scheduledAt.replace(' ', 'T') + 'Z')
    : new Date(Date.now() + 3600_000);
  scheduledAt.value = defaultTime.toISOString().slice(0, 16);
  scheduledDialog.value = true;
}

async function confirmSchedule(): Promise<void> {
  if (!scheduledAt.value) return;
  try {
    const ok = await doSave(false);
    if (!ok) return;
    const iso = new Date(scheduledAt.value).toISOString();
    const p = await postApi.schedule(postId.value!, iso);
    form.status = p.status;
    form.scheduledAt = p.scheduledAt;
    revision.value = p.revision;
    scheduledDialog.value = false;
    ElMessage.success('已设定定时发布');
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '设置失败');
  }
}

async function unschedule(): Promise<void> {
  try {
    const p = await postApi.unschedule(postId.value!);
    form.status = p.status;
    form.scheduledAt = null;
    revision.value = p.revision;
    ElMessage.success('已取消定时发布');
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '操作失败');
  }
}

async function archive(): Promise<void> {
  try {
    const p = await postApi.archive(postId.value!);
    form.status = p.status;
    revision.value = p.revision;
    ElMessage.success('已归档');
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '操作失败');
  }
}

async function trash(): Promise<void> {
  await ElMessageBox.confirm('文章将移入回收站（可恢复），确定吗？', '移入回收站', { type: 'warning' });
  try {
    await postApi.trash(postId.value!);
    clearLocal();
    ElMessage.success('已移入回收站');
    router.push('/posts');
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '操作失败');
  }
}

/* ---------------- 媒体 ---------------- */

async function pickMedia(): Promise<void> {
  mediaDialog.value = true;
}

async function onMediaPicked(m: Media): Promise<void> {
  form.coverMediaId = m.id;
  form.coverAlt = m.altText || m.originalName;
  coverMediaId.value = m.id;
  coverUrl.value = m.url;
  mediaDialog.value = false;
  ElMessage.success('已设为封面');
}

/** 封面预览：从媒体列表取真实 URL */
async function refreshCoverUrl(): Promise<void> {
  const id = form.coverMediaId;
  if (!id) {
    coverUrl.value = '';
    return;
  }
  if (coverMediaId.value === id && coverUrl.value) return;
  try {
    const list = await mediaApi.list({ pageSize: 100 });
    const hit = list.items.find((m) => m.id === id);
    if (hit) {
      coverMediaId.value = id;
      coverUrl.value = hit.url;
    } else {
      coverUrl.value = '';
    }
  } catch {
    coverUrl.value = '';
  }
}

/** 拖拽 / 粘贴图片直接上传并插入 */
async function uploadInline(file: File): Promise<void> {
  try {
    const r = await mediaApi.upload(file, { altText: file.name.replace(/\.[^.]+$/, '') });
    insertAtCursor(`\n![${r.altText || file.name}](${r.url})\n`);
    ElMessage.success('图片已上传并插入');
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '上传失败');
  }
}

function insertAtCursor(text: string): void {
  const ta = document.querySelector<HTMLTextAreaElement>('.mb-md-input');
  if (!ta) {
    form.content += text;
    return;
  }
  const start = ta.selectionStart;
  const end = ta.selectionEnd;
  form.content = form.content.slice(0, start) + text + form.content.slice(end);
  requestAnimationFrame(() => {
    ta.focus();
    ta.selectionStart = ta.selectionEnd = start + text.length;
  });
}

/* ---------------- 工具栏 ---------------- */

const textareaRef = ref<HTMLTextAreaElement | null>(null);

function wrap(before: string, after = before, placeholder = '文本'): void {
  const ta = textareaRef.value;
  if (!ta) return;
  const { selectionStart: s, selectionEnd: e, value } = ta;
  const selected = value.slice(s, e) || placeholder;
  const next = `${value.slice(0, s)}${before}${selected}${after}${value.slice(e)}`;
  form.content = next;
  requestAnimationFrame(() => {
    ta.focus();
    ta.selectionStart = s + before.length;
    ta.selectionEnd = s + before.length + selected.length;
  });
}

function insertLine(prefix: string, placeholder: string): void {
  const ta = textareaRef.value;
  if (!ta) return;
  const { selectionStart, value } = ta;
  const lineStart = value.lastIndexOf('\n', selectionStart - 1) + 1;
  form.content = `${value.slice(0, lineStart)}${prefix}${value.slice(lineStart) || placeholder}`;
  requestAnimationFrame(() => ta.focus());
}

const tools = [
  { label: 'B', title: '粗体', run: () => wrap('**'), style: 'font-weight:700' },
  { label: 'I', title: '斜体', run: () => wrap('*'), style: 'font-style:italic' },
  { label: 'S', title: '删除线', run: () => wrap('~~'), style: 'text-decoration:line-through' },
  { label: 'H', title: '标题', run: () => insertLine('## ', '小节标题') },
  { label: '❝', title: '引用', run: () => insertLine('> ', '引用内容') },
  { label: '•', title: '无序列表', run: () => insertLine('- ', '列表项') },
  { label: '1.', title: '有序列表', run: () => insertLine('1. ', '列表项') },
  { label: '</>', title: '行内代码', run: () => wrap('`', '`', 'code') },
  { label: '{ }', title: '代码块', run: () => wrap('\n```js\n', '\n```\n', '// code') },
  { label: '🔗', title: '链接', run: () => wrap('[', '](https://)', '链接文字') },
  { label: '🖼', title: '图片', run: () => pickMedia() },
  { label: '▦', title: '表格', run: () => wrap('\n| 列1 | 列2 |\n|---|---|\n| 内容 | 内容 |\n', '', '') },
  { label: '—', title: '分隔线', run: () => insertLine('\n---\n', '') }
];

function onKeydown(e: KeyboardEvent): void {
  const mod = e.ctrlKey || e.metaKey;
  if (!mod) return;

  switch (e.key.toLowerCase()) {
    case 's':
      e.preventDefault();
      void manualSave();
      break;
    case 'b':
      e.preventDefault();
      wrap('**');
      break;
    case 'i':
      e.preventDefault();
      wrap('*');
      break;
    case 'k':
      e.preventDefault();
      wrap('[', '](https://)');
      break;
    case 'p':
      e.preventDefault();
      viewMode.value = viewMode.value === 'preview' ? 'split' : 'preview';
      break;
    case 'f':
      e.preventDefault();
      focusMode.value = !focusMode.value;
      break;
    default:
      break;
  }
}

function onPaste(e: ClipboardEvent): void {
  const items = e.clipboardData?.items;
  if (!items) return;
  for (const item of Array.from(items)) {
    if (item.type.startsWith('image/')) {
      const file = item.getAsFile();
      if (file) {
        e.preventDefault();
        void uploadInline(file);
        return;
      }
    }
  }
}

function onDrop(e: DragEvent): void {
  const files = e.dataTransfer?.files;
  if (!files?.length) return;
  const images = Array.from(files).filter((f) => f.type.startsWith('image/'));
  if (!images.length) return;
  e.preventDefault();
  images.forEach((f) => void uploadInline(f));
}

function scrollToHeading(id: string): void {
  const el = document.getElementById(id);
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/* ---------------- 离开确认 ---------------- */

function confirmLeave(): boolean {
  if (saveState.value === 'conflict' || saveState.value === 'error') return true;
  return !isDirty.value;
}

onBeforeRouteLeave((_to, _from, next) => {
  if (confirmLeave()) {
    next();
    return;
  }
  ElMessageBox.confirm('有未保存的内容，确定离开吗？', '未保存', {
    confirmButtonText: '离开',
    cancelButtonText: '留在此页',
    type: 'warning'
  })
    .then(() => next())
    .catch(() => next(false));
});

function onBeforeUnload(e: BeforeUnloadEvent): void {
  if (isDirty.value) {
    saveLocal();
    e.preventDefault();
    e.returnValue = '';
  }
}

onMounted(() => {
  load();
  window.addEventListener('beforeunload', onBeforeUnload);
});

onBeforeUnmount(() => {
  if (autoSaveTimer) clearTimeout(autoSaveTimer);
  window.removeEventListener('beforeunload', onBeforeUnload);
  if (isDirty.value) saveLocal();
});
</script>

<template>
  <div v-loading="loading" class="mb-editor" :class="{ 'focus-mode': focusMode }">
    <!-- 左侧：大纲 -->
    <aside class="mb-editor-side">
      <div style="padding: 14px 12px 8px; font-size: 12px; color: #8a8a93; font-weight: 600">文章大纲</div>
      <div v-if="!outline.length" class="mb-outline-empty">用 ## 标题生成大纲</div>
      <div v-else style="padding: 0 8px 14px">
        <button
          v-for="h in outline"
          :key="h.id"
          class="mb-outline-item"
          :data-level="h.level"
          :title="h.text"
          @click="scrollToHeading(h.id)"
        >
          {{ h.text }}
        </button>
      </div>

      <div style="margin-top: auto; padding: 12px; border-top: 1px solid #f0f0f2">
        <div style="font-size: 12px; color: #8a8a93; line-height: 1.8">
          <div>字数：{{ wordCount }}</div>
          <div>阅读：{{ readTime }} 分钟</div>
          <div v-if="form.publishedAt">发布：{{ formatDate(form.publishedAt) }}</div>
        </div>
      </div>
    </aside>

    <!-- 中间：编辑区 -->
    <div class="mb-editor-col mb-editor-main">
      <div class="mb-editor-bar">
        <el-button text size="small" @click="outlineOpen = !outlineOpen" :title="focusMode ? '退出专注' : '专注写作'">
          <el-icon><Expand /></el-icon>
        </el-button>

        <el-radio-group v-model="viewMode" size="small">
          <el-radio-button value="edit">编辑</el-radio-button>
          <el-radio-button value="split">分屏</el-radio-button>
          <el-radio-button value="preview">预览</el-radio-button>
        </el-radio-group>

        <el-divider direction="vertical" />

        <template v-if="viewMode !== 'preview'">
          <el-tooltip v-for="t in tools" :key="t.title" :content="t.title" placement="bottom">
            <el-button text size="small" :style="t.style" @click="t.run()">{{ t.label }}</el-button>
          </el-tooltip>
        </template>

        <div style="flex: 1"></div>

        <span class="mb-save-state" :data-state="saveState">
          <template v-if="saveState === 'saving'"><el-icon><Loading /></el-icon> 保存中…</template>
          <template v-else-if="saveState === 'saved'"><el-icon><CircleCheck /></el-icon> 已保存</template>
          <template v-else-if="saveState === 'dirty'">未保存的更改</template>
          <template v-else-if="saveState === 'error'" :title="saveError">
            <el-icon><WarningFilled /></el-icon> 保存失败
          </template>
          <template v-else-if="saveState === 'conflict'"><el-icon><CircleCloseFilled /></el-icon> 内容冲突</template>
          <template v-else>—</template>
        </span>

        <el-button size="small" :loading="saving" @click="manualSave">保存草稿</el-button>
        <el-button v-if="focusMode" size="small" @click="focusMode = false">退出专注</el-button>
        <el-button
          v-if="form.status === 'scheduled'"
          size="small"
          @click="unschedule"
        >
          取消定时
        </el-button>
        <el-button v-else size="small" @click="openSchedule">定时发布</el-button>
        <el-button type="primary" size="small" :loading="publishLoading" :disabled="!canPublish" @click="publish">
          {{ form.status === 'published' ? '更新' : '发布' }}
        </el-button>
        <el-dropdown v-if="postId">
          <el-button text size="small"><el-icon><MoreFilled /></el-icon></el-button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item @click="router.push(`/revisions/${postId}`)">版本历史</el-dropdown-item>
              <el-dropdown-item @click="form.isFeatured = !form.isFeatured; scheduleAutoSave()">
                {{ form.isFeatured ? '取消精选' : '设为精选' }}
              </el-dropdown-item>
              <el-dropdown-item v-if="form.status === 'published'" divided @click="archive">归档文章</el-dropdown-item>
              <el-dropdown-item v-if="postId" divided @click="router.push(`/posts/${postId}`)">
                <span style="float: left">查看前台</span>
              </el-dropdown-item>
              <el-dropdown-item divided @click="trash">移入回收站</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </div>

      <!-- 冲突提示条 -->
      <el-alert
        v-if="saveState === 'conflict'"
        type="error"
        :closable="false"
        show-icon
        style="margin: 10px 12px 0"
      >
        <template #title>
          <div class="mb-flex mb-gap-2" style="align-items: center; flex-wrap: wrap">
            <span>其他会话已修改此文章，你的更改未保存。</span>
            <el-button size="small" @click="reloadFromServer">放弃本地，加载最新</el-button>
            <el-button size="small" type="warning" @click="forceOverwrite">用本地内容覆盖</el-button>
          </div>
        </template>
      </el-alert>

      <el-alert
        v-else-if="saveState === 'error'"
        type="warning"
        :closable="false"
        show-icon
        style="margin: 10px 12px 0"
      >
        <template #title>
          <div class="mb-flex mb-gap-2" style="align-items: center; flex-wrap: wrap">
            <span>自动保存失败（{{ saveError }}），内容已保存在本地，联网后可重试。</span>
            <el-button size="small" @click="manualSave">重试保存</el-button>
          </div>
        </template>
      </el-alert>

      <!-- 输入区 -->
      <div class="mb-editor-panes" :data-mode="viewMode">
        <div class="mb-pane" :hidden="viewMode === 'preview'">
          <input
            v-model="form.title"
            placeholder="文章标题"
            style="border: none; outline: none; font-size: 22px; font-weight: 640; padding: 18px 22px 8px; letter-spacing: -0.02em; font-family: inherit; width: 100%; background: transparent"
          />
          <textarea
            ref="textareaRef"
            v-model="form.content"
            class="mb-md-input"
            placeholder="开始写作…支持 Markdown，拖拽或粘贴图片可直接上传"
            spellcheck="false"
            @keydown="onKeydown"
            @paste="onPaste"
            @drop="onDrop"
            @dragover.prevent
          ></textarea>
        </div>

        <div v-show="viewMode !== 'edit'" class="mb-pane">
          <div class="mb-preview">
            <div v-if="!form.content" class="mb-muted" style="padding: 40px; text-align: center; font-size: 13px">
              预览将在这里显示
            </div>
            <div v-else class="mb-preview-body" v-html="preview.html"></div>
          </div>
        </div>
      </div>
    </div>

    <!-- 右侧：属性面板 -->
    <aside class="mb-editor-inspector">
      <el-tabs v-model="inspectorTab" size="small">
        <el-tab-pane label="发布" name="publish">
          <div style="padding-top: 8px">
            <div style="margin-bottom: 14px">
              <div style="font-size: 12px; color: #8a8a93; margin-bottom: 5px">状态</div>
              <el-tag :type="form.status === 'published' ? 'success' : form.status === 'draft' ? 'info' : 'warning'">
                {{ statusLabel[form.status] }}
              </el-tag>
            </div>

            <div style="margin-bottom: 14px">
              <div style="font-size: 12px; color: #8a8a93; margin-bottom: 5px">URL 别名</div>
              <el-input v-model="form.slug" size="small" placeholder="留空自动生成" />
              <div style="font-size: 11px; color: #a1a1aa; margin-top: 4px">
                /posts/{{ form.slug || '自动生成' }}
              </div>
            </div>

            <div style="margin-bottom: 14px">
              <div style="font-size: 12px; color: #8a8a93; margin-bottom: 5px">摘要</div>
              <el-input
                v-model="form.excerpt"
                type="textarea"
                :rows="3"
                size="small"
                placeholder="留空自动从正文提取"
              />
            </div>

            <div style="margin-bottom: 14px">
              <div style="font-size: 12px; color: #8a8a93; margin-bottom: 5px">封面</div>
              <div v-if="coverUrl" style="margin-bottom: 6px">
                <el-image
                  :src="coverUrl"
                  style="width: 100%; height: 96px; border-radius: 8px; object-fit: cover"
                  fit="cover"
                />
                <el-button size="small" text type="danger" style="margin-top: 4px" @click="form.coverMediaId = null">
                  移除封面
                </el-button>
              </div>
              <el-button size="small" style="width: 100%" @click="pickMedia">从媒体库选择</el-button>
            </div>

            <div style="margin-bottom: 14px">
              <div style="font-size: 12px; color: #8a8a93; margin-bottom: 5px">分类</div>
              <el-select
                v-model="form.categoryIds"
                multiple
                size="small"
                style="width: 100%"
                placeholder="可多选"
              >
                <el-option v-for="c in categories" :key="c.id" :label="c.name" :value="c.id" />
              </el-select>
            </div>

            <div style="margin-bottom: 14px">
              <div style="font-size: 12px; color: #8a8a93; margin-bottom: 5px">标签</div>
              <el-select
                v-model="form.tagNames"
                multiple
                filterable
                allow-create
                default-first-option
                size="small"
                style="width: 100%"
                placeholder="输入后回车创建"
              >
                <el-option v-for="t in tags" :key="t.id" :label="t.name" :value="t.name" />
              </el-select>
            </div>

            <el-divider />
            <el-checkbox v-model="form.isFeatured" size="small">设为精选文章（首页展示）</el-checkbox>
          </div>
        </el-tab-pane>

        <el-tab-pane label="SEO" name="seo">
          <div style="padding-top: 8px">
            <div style="margin-bottom: 14px">
              <div style="font-size: 12px; color: #8a8a93; margin-bottom: 5px">SEO 标题</div>
              <el-input v-model="form.seoTitle" size="small" placeholder="留空使用文章标题" maxlength="70" show-word-limit />
            </div>
            <div style="margin-bottom: 14px">
              <div style="font-size: 12px; color: #8a8a93; margin-bottom: 5px">SEO 描述</div>
              <el-input
                v-model="form.seoDescription"
                type="textarea"
                :rows="3"
                size="small"
                placeholder="留空使用文章摘要"
                maxlength="160"
                show-word-limit
              />
            </div>
            <div style="margin-bottom: 14px">
              <div style="font-size: 12px; color: #8a8a93; margin-bottom: 5px">Canonical URL</div>
              <el-input v-model="form.canonicalUrl" size="small" placeholder="留空自动生成" />
            </div>
            <el-checkbox v-model="form.robotsIndex" size="small">允许搜索引擎索引</el-checkbox>
          </div>
        </el-tab-pane>
      </el-tabs>

      <el-divider style="margin: 14px 0" />

      <div style="padding: 0 2px">
        <el-checkbox v-model="autoSaveEnabled" size="small">自动保存（停止输入 1.5 秒后）</el-checkbox>
      </div>
    </aside>

    <!-- 媒体选择 -->
    <MediaPicker v-model="mediaDialog" @pick="onMediaPicked" />

    <!-- 定时发布 -->
    <el-dialog v-model="scheduledDialog" title="定时发布" width="420px">
      <el-form label-position="top">
        <el-form-item label="发布时间">
          <el-date-picker
            v-model="scheduledAt"
            type="datetime"
            placeholder="选择日期时间"
            style="width: 100%"
            :disabled-date="(d: Date) => d.getTime() < Date.now() - 86400000"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="scheduledDialog = false">取消</el-button>
        <el-button type="primary" @click="confirmSchedule">确定</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script lang="ts">
import MediaPicker from '@/components/MediaPicker.vue';
export default { name: 'Editor', components: { MediaPicker } };
</script>
<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { menuApi, settingsApi } from '@/api';
import type { MenuItem, SiteSettings } from '@myblog/shared';
import { ACCENT_PRESETS } from '@myblog/shared';

const settings = ref<SiteSettings | null>(null);
const menus = ref<MenuItem[]>([]);
const saving = ref(false);
const activeLocation = ref<'header' | 'footer' | 'social'>('header');

const dialog = ref(false);
const form = reactive({ id: 0, label: '', href: '', location: 'header' as MenuItem['location'], sortOrder: 0, openInNew: false });

const locations: { value: MenuItem['location']; label: string; hint: string }[] = [
  { value: 'header', label: '顶部导航', hint: '显示在页头导航栏' },
  { value: 'footer', label: '页脚导航', hint: '显示在页脚链接区' },
  { value: 'social', label: '社交链接', hint: '显示为图标按钮' }
];

const filteredMenus = () => menus.value.filter((m) => m.location === activeLocation.value);

async function load(): Promise<void> {
  try {
    const [s, m] = await Promise.all([settingsApi.get(), menuApi.list()]);
    settings.value = s;
    menus.value = m;
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '加载失败');
  }
}

async function saveSettings(): Promise<void> {
  if (!settings.value) return;
  saving.value = true;
  try {
    settings.value = await settingsApi.update(settings.value);
    ElMessage.success('已保存，前台刷新后生效');
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '保存失败');
  } finally {
    saving.value = false;
  }
}

function openDialog(): void {
  Object.assign(form, {
    id: 0,
    label: '',
    href: '',
    location: activeLocation.value,
    sortOrder: filteredMenus().length,
    openInNew: /^https?:/i.test(form.href)
  });
  dialog.value = true;
}

function editMenu(m: MenuItem): void {
  Object.assign(form, { ...m });
  dialog.value = true;
}

async function saveMenu(): Promise<void> {
  if (!form.label.trim()) { ElMessage.warning('请填写菜单名称'); return; }
  if (!form.href.trim()) { ElMessage.warning('请填写链接地址'); return; }
  // 站内链接一律走页面内路由，强制不在新窗口打开，避免前台出现割裂的新标签页
  const internal = !/^https?:\/\//i.test(form.href.trim());
  const payload = { ...form, href: form.href.trim(), openInNew: internal ? false : form.openInNew };
  try {
    if (form.id) menus.value = await menuApi.update(form.id, payload);
    else menus.value = await menuApi.create(payload);
    ElMessage.success('已保存');
    dialog.value = false;
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '保存失败');
  }
}

async function removeMenu(m: MenuItem): Promise<void> {
  try {
    menus.value = await menuApi.remove(m.id);
    ElMessage.success('已删除');
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '删除失败');
  }
}

async function toggleVisible(m: MenuItem): Promise<void> {
  try {
    menus.value = await menuApi.update(m.id, { ...m, isVisible: !m.isVisible });
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '操作失败');
  }
}

async function move(m: MenuItem, dir: -1 | 1): Promise<void> {
  const list = filteredMenus();
  const idx = list.findIndex((x) => x.id === m.id);
  const target = idx + dir;
  if (target < 0 || target >= list.length) return;
  const reordered = [...list];
  [reordered[idx], reordered[target]] = [reordered[target], reordered[idx]];
  try {
    menus.value = await menuApi.reorder(reordered.map((x) => x.id));
    ElMessage.success('顺序已保存');
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '排序失败');
  }
}

onMounted(load);
</script>

<template>
  <div v-if="settings">
    <div class="mb-card">
      <h3 class="mb-card-title">
        <span>首页介绍区域</span>
        <el-button type="primary" size="small" :loading="saving" @click="saveSettings">保存</el-button>
      </h3>

      <el-form label-position="top">
        <el-row :gutter="14">
          <el-col :span="12">
            <el-form-item label="一句话介绍（眉标题）">
              <el-input v-model="settings.heroSubtitle" placeholder="写代码，也写字" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="主标题">
              <el-input v-model="settings.heroTitle" placeholder="你好，我是 XXX" />
            </el-form-item>
          </el-col>
        </el-row>

        <el-form-item label="详细简介">
          <el-input v-model="settings.heroDescription" type="textarea" :rows="3" placeholder="一段话介绍自己，展示在首页顶部" />
        </el-form-item>

        <el-row :gutter="14">
          <el-col :span="12">
            <el-form-item label="头像 / Logo 图片 URL">
              <el-input v-model="settings.heroAvatarUrl" placeholder="可从媒体库复制链接" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="Logo 图片 URL（页头使用）">
              <el-input v-model="settings.logoUrl" placeholder="留空则只显示站点名称" />
            </el-form-item>
          </el-col>
        </el-row>

        <el-form-item label="Favicon URL">
          <el-input v-model="settings.faviconUrl" placeholder="留空使用默认图标" />
        </el-form-item>
      </el-form>
    </div>

    <div class="mb-card">
      <h3 class="mb-card-title">
        <span>主题色与默认主题</span>
        <el-button type="primary" size="small" :loading="saving" @click="saveSettings">保存</el-button>
      </h3>

      <el-form label-position="top">
        <el-form-item label="主题色">
          <div class="mb-flex mb-gap-2" style="flex-wrap: wrap">
            <button
              v-for="p in ACCENT_PRESETS"
              :key="p.value"
              type="button"
              :style="{ background: p.value, width: '30px', height: '30px', borderRadius: '8px', border: settings.accentColor === p.value ? '2px solid #1c1c1e' : '2px solid transparent' }"
              :title="p.name"
              @click="settings!.accentColor = p.value"
            ></button>
            <el-color-picker v-model="settings.accentColor" size="small" />
            <code style="font-size: 12.5px; margin-left: 4px">{{ settings.accentColor }}</code>
          </div>
        </el-form-item>

        <el-form-item label="默认主题模式">
          <el-radio-group v-model="settings.defaultTheme">
            <el-radio value="light">浅色</el-radio>
            <el-radio value="dark">深色</el-radio>
            <el-radio value="system">跟随系统</el-radio>
          </el-radio-group>
          <div class="mb-muted" style="font-size: 12px; margin-top: 4px">
            访客的选择会保存在其浏览器本地，优先级高于此默认值
          </div>
        </el-form-item>

        <el-form-item label="页脚文案">
          <el-input v-model="settings.footerText" placeholder="© 2026 保留所有权利" />
        </el-form-item>

        <el-form-item label="备案号（可选）">
          <el-input v-model="settings.icpBeian" placeholder="京ICP备00000000号" style="max-width: 280px" />
        </el-form-item>
      </el-form>
    </div>

    <div class="mb-card">
      <h3 class="mb-card-title">
        <span>导航菜单</span>
        <el-button type="primary" size="small" @click="openDialog">
          <el-icon><Plus /></el-icon><span style="margin-left: 4px">添加菜单项</span>
        </el-button>
      </h3>

      <el-tabs v-model="activeLocation" style="margin-bottom: 12px">
        <el-tab-pane v-for="l in locations" :key="l.value" :label="l.label" :name="l.value" />
      </el-tabs>

      <p class="mb-muted" style="font-size: 12.5px; margin: -6px 0 12px">
        {{ locations.find((l) => l.value === activeLocation)?.hint }}
      </p>

      <el-table :data="filteredMenus()" size="small">
        <el-table-column label="名称" min-width="130">
          <template #default="{ row }">
            <span :style="{ opacity: row.isVisible ? 1 : 0.45 }">{{ row.label }}</span>
          </template>
        </el-table-column>
        <el-table-column label="链接" min-width="200">
          <template #default="{ row }"><code style="font-size: 12px">{{ row.href }}</code></template>
        </el-table-column>
        <el-table-column label="打开方式" width="100">
          <template #default="{ row }">
            <el-tag size="small" :type="row.isExternal ? 'warning' : 'info'" effect="plain">
              {{ row.isExternal ? (row.openInNew ? '新窗口' : '当前') : '站内' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="显示" width="90">
          <template #default="{ row }">
            <el-switch :model-value="row.isVisible" size="small" @change="toggleVisible(row)" />
          </template>
        </el-table-column>
        <el-table-column label="排序" width="120">
          <template #default="{ $index }">
            <el-button link size="small" :disabled="$index === 0" @click="filteredMenus()[$index] && move(filteredMenus()[$index], -1)">↑</el-button>
            <el-button link size="small" :disabled="$index === filteredMenus().length - 1" @click="filteredMenus()[$index] && move(filteredMenus()[$index], 1)">↓</el-button>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="130" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="editMenu(row)">编辑</el-button>
            <el-button link type="danger" size="small" @click="removeMenu(row)">删除</el-button>
          </template>
        </el-table-column>
        <template #empty><el-empty description="该位置还没有菜单项" :image-size="70" /></template>
      </el-table>
    </div>

    <div class="mb-card">
      <h3 class="mb-card-title">
        <span>关于页面内容</span>
        <el-button type="primary" size="small" :loading="saving" @click="saveSettings">保存</el-button>
      </h3>
      <p class="mb-muted" style="font-size: 12.5px; margin: -8px 0 12px">
        仅在没有创建独立的「关于我」页面（slug = <code>about</code>）时生效。支持 Markdown
      </p>
      <el-input v-model="settings.aboutContent" type="textarea" :rows="8" placeholder="## 关于我&#10;&#10;在这里介绍自己…" />
    </div>

    <el-dialog v-model="dialog" :title="form.id ? '编辑菜单项' : '添加菜单项'" width="460px">
      <el-form label-position="top">
        <el-form-item label="显示名称" required><el-input v-model="form.label" placeholder="例如：技术笔记" /></el-form-item>
        <el-form-item label="链接地址" required>
          <el-input v-model="form.href" placeholder="/posts 或 https://github.com/xxx" />
          <div class="mb-muted" style="font-size: 11.5px; margin-top: 4px">
            以 / 开头为站内链接，http(s) 开头为外部链接（自动标记）
          </div>
        </el-form-item>
        <el-form-item label="位置">
          <el-select v-model="form.location" style="width: 100%">
            <el-option v-for="l in locations" :key="l.value" :label="l.label" :value="l.value" />
          </el-select>
        </el-form-item>
        <el-checkbox v-model="form.openInNew">外部链接在新窗口打开</el-checkbox>
      </el-form>
      <template #footer>
        <el-button @click="dialog = false">取消</el-button>
        <el-button type="primary" @click="saveMenu">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script lang="ts">
export default { name: 'Appearance' };
</script>
<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { linkApi, redirectApi } from '@/api';
import type { LinkItem, Redirect } from '@myblog/shared';
import { formatDate } from '@myblog/shared';

const links = ref<LinkItem[]>([]);
const redirects = ref<Redirect[]>([]);
const loading = ref(false);

const linkDialog = ref(false);
const linkForm = reactive({ id: 0, name: '', url: '', avatarUrl: '', description: '', sortOrder: 0, isVisible: true });

const redirectDialog = ref(false);
const redirectForm = reactive({ fromPath: '', toPath: '', statusCode: 301 });

async function load(): Promise<void> {
  loading.value = true;
  try {
    const [l, r] = await Promise.all([linkApi.list(), redirectApi.list()]);
    links.value = l;
    redirects.value = r;
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '加载失败');
  } finally {
    loading.value = false;
  }
}

function openLink(l?: LinkItem): void {
  if (l) Object.assign(linkForm, { ...l, avatarUrl: l.avatarUrl ?? '', description: l.description ?? '' });
  else Object.assign(linkForm, { id: 0, name: '', url: '', avatarUrl: '', description: '', sortOrder: 0, isVisible: true });
  linkDialog.value = true;
}

async function saveLink(): Promise<void> {
  if (!linkForm.name.trim()) { ElMessage.warning('请填写名称'); return; }
  if (!/^https?:\/\//i.test(linkForm.url)) { ElMessage.warning('请填写合法的 http(s) 链接'); return; }
  try {
    if (linkForm.id) await linkApi.update(linkForm.id, linkForm);
    else await linkApi.create(linkForm);
    ElMessage.success('已保存');
    linkDialog.value = false;
    load();
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '保存失败');
  }
}

async function removeLink(l: LinkItem): Promise<void> {
  await ElMessageBox.confirm(`删除友链「${l.name}」？`, '确认', { type: 'warning' });
  try {
    await linkApi.remove(l.id);
    ElMessage.success('已删除');
    load();
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '删除失败');
  }
}

async function saveRedirect(): Promise<void> {
  if (!redirectForm.fromPath.startsWith('/')) { ElMessage.warning('源路径必须以 / 开头'); return; }
  if (!redirectForm.toPath) { ElMessage.warning('请填写目标路径'); return; }
  try {
    await redirectApi.create(redirectForm);
    ElMessage.success('重定向已创建');
    redirectDialog.value = false;
    Object.assign(redirectForm, { fromPath: '', toPath: '', statusCode: 301 });
    load();
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '保存失败');
  }
}

async function removeRedirect(r: Redirect): Promise<void> {
  await ElMessageBox.confirm(`删除重定向 ${r.fromPath} → ${r.toPath}？`, '确认', { type: 'warning' });
  try {
    await redirectApi.remove(r.id);
    ElMessage.success('已删除');
    load();
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '删除失败');
  }
}

onMounted(load);
</script>

<template>
  <div>
    <div class="mb-card">
      <h3 class="mb-card-title">
        <span>友情链接</span>
        <el-button size="small" type="primary" @click="openLink()">
          <el-icon><Plus /></el-icon><span style="margin-left: 4px">添加友链</span>
        </el-button>
      </h3>
      <p class="mb-muted" style="font-size: 12.5px; margin: -8px 0 12px">显示在前台 <code>/links</code> 页面</p>

      <el-table v-loading="loading" :data="links" size="small">
        <el-table-column label="名称" min-width="140">
          <template #default="{ row }">
            <div class="mb-flex mb-gap-2" style="align-items: center">
              <img v-if="row.avatarUrl" :src="row.avatarUrl" alt="" style="width: 24px; height: 24px; border-radius: 6px" />
              <span style="font-weight: 540">{{ row.name }}</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="链接" min-width="200" show-overflow-tooltip>
          <template #default="{ row }">
            <a :href="row.url" target="_blank" rel="noopener nofollow" style="font-size: 12.5px; color: #1d4ed8">{{ row.url }}</a>
          </template>
        </el-table-column>
        <el-table-column prop="description" label="描述" min-width="160" show-overflow-tooltip />
        <el-table-column label="排序" width="70" prop="sortOrder" />
        <el-table-column label="显示" width="80">
          <template #default="{ row }">
            <el-tag size="small" :type="row.isVisible ? 'success' : 'info'" effect="plain">
              {{ row.isVisible ? '显示' : '隐藏' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="130" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="openLink(row)">编辑</el-button>
            <el-button link type="danger" size="small" @click="removeLink(row)">删除</el-button>
          </template>
        </el-table-column>
        <template #empty><el-empty description="还没有友情链接" :image-size="70" /></template>
      </el-table>
    </div>

    <div class="mb-card">
      <h3 class="mb-card-title">
        <span>URL 重定向</span>
        <el-button size="small" type="primary" @click="redirectDialog = true">
          <el-icon><Plus /></el-icon><span style="margin-left: 4px">添加重定向</span>
        </el-button>
      </h3>
      <p class="mb-muted" style="font-size: 12.5px; margin: -8px 0 12px">
        修改已公开文章的 slug 后，在这里添加旧路径 → 新路径的 301 规则，保留搜索引擎权重
      </p>

      <el-table v-loading="loading" :data="redirects" size="small">
        <el-table-column label="源路径" min-width="180">
          <template #default="{ row }"><code style="font-size: 12.5px">{{ row.fromPath }}</code></template>
        </el-table-column>
        <el-table-column label="目标" min-width="180">
          <template #default="{ row }"><code style="font-size: 12.5px">{{ row.toPath }}</code></template>
        </el-table-column>
        <el-table-column label="类型" width="90">
          <template #default="{ row }">
            <el-tag size="small" :type="row.statusCode === 301 ? 'success' : 'warning'" effect="plain">
              {{ row.statusCode }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="命中" width="80" prop="hitCount" />
        <el-table-column label="创建时间" width="150">
          <template #default="{ row }">{{ formatDate(row.createdAt) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="90" fixed="right">
          <template #default="{ row }">
            <el-button link type="danger" size="small" @click="removeRedirect(row)">删除</el-button>
          </template>
        </el-table-column>
        <template #empty><el-empty description="暂无重定向规则" :image-size="70" /></template>
      </el-table>
    </div>

    <!-- 友链编辑 -->
    <el-dialog v-model="linkDialog" :title="linkForm.id ? '编辑友链' : '添加友链'" width="480px">
      <el-form label-position="top">
        <el-form-item label="名称" required><el-input v-model="linkForm.name" /></el-form-item>
        <el-form-item label="链接地址" required>
          <el-input v-model="linkForm.url" placeholder="https://example.com" />
        </el-form-item>
        <el-form-item label="头像 URL（可选）"><el-input v-model="linkForm.avatarUrl" placeholder="https://…" /></el-form-item>
        <el-form-item label="描述（可选）"><el-input v-model="linkForm.description" /></el-form-item>
        <el-form-item label="排序"><el-input-number v-model="linkForm.sortOrder" :min="0" :max="999" /></el-form-item>
        <el-checkbox v-model="linkForm.isVisible">在前台显示</el-checkbox>
      </el-form>
      <template #footer>
        <el-button @click="linkDialog = false">取消</el-button>
        <el-button type="primary" @click="saveLink">保存</el-button>
      </template>
    </el-dialog>

    <!-- 重定向 -->
    <el-dialog v-model="redirectDialog" title="添加 URL 重定向" width="480px">
      <el-form label-position="top">
        <el-form-item label="源路径" required>
          <el-input v-model="redirectForm.fromPath" placeholder="/old-slug" />
        </el-form-item>
        <el-form-item label="目标路径" required>
          <el-input v-model="redirectForm.toPath" placeholder="/posts/new-slug 或完整链接" />
        </el-form-item>
        <el-form-item label="状态码">
          <el-radio-group v-model="redirectForm.statusCode">
            <el-radio :value="301">301 永久重定向（推荐，保留 SEO 权重）</el-radio>
            <el-radio :value="302">302 临时重定向</el-radio>
          </el-radio-group>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="redirectDialog = false">取消</el-button>
        <el-button type="primary" @click="saveRedirect">创建</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script lang="ts">
export default { name: 'Links' };
</script>
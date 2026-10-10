<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { categoryApi, tagApi } from '@/api';
import type { Category, Tag } from '@myblog/shared';

const loading = ref(false);
const categories = ref<Category[]>([]);
const tags = ref<Tag[]>([]);

const catDialog = ref(false);
const catForm = reactive({ id: 0, name: '', slug: '', description: '', parentId: null as number | null, sortOrder: 0, seoTitle: '', seoDescription: '' });

const tagDialog = ref(false);
const tagForm = reactive({ id: 0, name: '', slug: '', description: '', seoTitle: '', seoDescription: '' });

const mergeDialog = ref(false);
const mergeForm = reactive({ sourceId: null as number | null, targetId: null as number | null });

async function load(): Promise<void> {
  loading.value = true;
  try {
    const [c, t] = await Promise.all([categoryApi.list(), tagApi.list()]);
    categories.value = c;
    tags.value = t;
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '加载失败');
  } finally {
    loading.value = false;
  }
}

function openCat(c?: Category): void {
  if (c) {
    Object.assign(catForm, {
      id: c.id, name: c.name, slug: c.slug, description: c.description ?? '',
      parentId: c.parentId, sortOrder: c.sortOrder, seoTitle: c.seoTitle ?? '', seoDescription: c.seoDescription ?? ''
    });
  } else {
    Object.assign(catForm, { id: 0, name: '', slug: '', description: '', parentId: null, sortOrder: 0, seoTitle: '', seoDescription: '' });
  }
  catDialog.value = true;
}

async function saveCat(): Promise<void> {
  if (!catForm.name.trim()) { ElMessage.warning('请填写分类名称'); return; }
  try {
    const payload = {
      name: catForm.name, slug: catForm.slug, description: catForm.description,
      parentId: catForm.parentId, sortOrder: catForm.sortOrder,
      seoTitle: catForm.seoTitle, seoDescription: catForm.seoDescription
    };
    if (catForm.id) await categoryApi.update(catForm.id, payload);
    else await categoryApi.create(payload);
    ElMessage.success('已保存');
    catDialog.value = false;
    load();
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '保存失败');
  }
}

async function removeCat(c: Category): Promise<void> {
  await ElMessageBox.confirm(
    c.postCount
      ? `「${c.name}」下有 ${c.postCount} 篇文章。删除分类不会删除文章，但会解除它们的分类关联。确定吗？`
      : `确定删除分类「${c.name}」？`,
    '删除分类',
    { type: 'warning' }
  );
  try {
    const r = await categoryApi.remove(c.id, 'detach');
    ElMessage.success(`已删除，${r.detachedPosts} 篇文章的分类关联已解除`);
    load();
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '删除失败');
  }
}

function openTag(t?: Tag): void {
  if (t) {
    Object.assign(tagForm, { id: t.id, name: t.name, slug: t.slug, description: t.description ?? '', seoTitle: t.seoTitle ?? '', seoDescription: t.seoDescription ?? '' });
  } else {
    Object.assign(tagForm, { id: 0, name: '', slug: '', description: '', seoTitle: '', seoDescription: '' });
  }
  tagDialog.value = true;
}

async function saveTag(): Promise<void> {
  if (!tagForm.name.trim()) { ElMessage.warning('请填写标签名称'); return; }
  try {
    const payload = { name: tagForm.name, slug: tagForm.slug, description: tagForm.description, seoTitle: tagForm.seoTitle, seoDescription: tagForm.seoDescription };
    if (tagForm.id) await tagApi.update(tagForm.id, payload);
    else await tagApi.create(payload);
    ElMessage.success('已保存');
    tagDialog.value = false;
    load();
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '保存失败');
  }
}

async function removeTag(t: Tag): Promise<void> {
  await ElMessageBox.confirm(
    t.postCount ? `「${t.name}」被 ${t.postCount} 篇文章使用，删除后关联会被解除。确定吗？` : `确定删除标签「${t.name}」？`,
    '删除标签',
    { type: 'warning' }
  );
  try {
    await tagApi.remove(t.id);
    ElMessage.success('已删除');
    load();
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '删除失败');
  }
}

async function doMerge(): Promise<void> {
  if (!mergeForm.sourceId || !mergeForm.targetId) { ElMessage.warning('请选择要合并的标签'); return; }
  if (mergeForm.sourceId === mergeForm.targetId) { ElMessage.warning('源标签与目标标签不能相同'); return; }
  await ElMessageBox.confirm('合并后源标签会被删除，其所有文章改为使用目标标签。确定吗？', '合并标签', { type: 'warning' });
  try {
    const r = await tagApi.merge(mergeForm.sourceId, mergeForm.targetId);
    ElMessage.success(`已合并 ${r.merged} 篇文章`);
    mergeDialog.value = false;
    Object.assign(mergeForm, { sourceId: null, targetId: null });
    load();
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '合并失败');
  }
}

onMounted(load);
</script>

<template>
  <div>
    <div class="mb-card">
      <h3 class="mb-card-title">
        <span>分类（{{ categories.length }}）</span>
        <div>
          <el-button size="small" @click="mergeDialog = true">合并分类</el-button>
          <el-button size="small" type="primary" @click="openCat()">
            <el-icon><Plus /></el-icon><span style="margin-left: 4px">新增分类</span>
          </el-button>
        </div>
      </h3>

      <el-table v-loading="loading" :data="categories" size="small">
        <el-table-column label="名称" min-width="150">
          <template #default="{ row }">
            <div class="mb-flex mb-gap-2" style="align-items: center">
              <span style="font-weight: 540">{{ row.name }}</span>
              <el-tag v-if="row.parentId" size="small" type="info" effect="plain">子级</el-tag>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="别名" width="150">
          <template #default="{ row }"><code style="font-size: 12px">{{ row.slug }}</code></template>
        </el-table-column>
        <el-table-column prop="description" label="描述" min-width="180" show-overflow-tooltip />
        <el-table-column label="文章数" width="80">
          <template #default="{ row }">{{ row.postCount }}</template>
        </el-table-column>
        <el-table-column label="排序" width="70" prop="sortOrder" />
        <el-table-column label="操作" width="130" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="openCat(row)">编辑</el-button>
            <el-button link type="danger" size="small" @click="removeCat(row)">删除</el-button>
          </template>
        </el-table-column>
        <template #empty><el-empty description="还没有分类" :image-size="70" /></template>
      </el-table>
    </div>

    <div class="mb-card">
      <h3 class="mb-card-title">
        <span>标签（{{ tags.length }}）</span>
        <div>
          <el-button size="small" @click="mergeDialog = true">合并标签</el-button>
          <el-button size="small" type="primary" @click="openTag()">
            <el-icon><Plus /></el-icon><span style="margin-left: 4px">新增标签</span>
          </el-button>
        </div>
      </h3>

      <el-table v-loading="loading" :data="tags" size="small">
        <el-table-column label="名称" min-width="150">
          <template #default="{ row }">
            <el-tag size="small" effect="plain">#{{ row.name }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="别名" width="160">
          <template #default="{ row }"><code style="font-size: 12px">{{ row.slug }}</code></template>
        </el-table-column>
        <el-table-column prop="description" label="描述" min-width="200" show-overflow-tooltip />
        <el-table-column label="使用数" width="90">
          <template #default="{ row }">{{ row.postCount }}</template>
        </el-table-column>
        <el-table-column label="操作" width="130" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="openTag(row)">编辑</el-button>
            <el-button link type="danger" size="small" @click="removeTag(row)">删除</el-button>
          </template>
        </el-table-column>
        <template #empty><el-empty description="还没有标签，可在文章编辑时直接输入创建" :image-size="70" /></template>
      </el-table>
    </div>

    <!-- 分类编辑 -->
    <el-dialog v-model="catDialog" :title="catForm.id ? '编辑分类' : '新增分类'" width="500px">
      <el-form label-position="top">
        <el-form-item label="名称" required>
          <el-input v-model="catForm.name" placeholder="例如：技术笔记" />
        </el-form-item>
        <el-form-item label="URL 别名">
          <el-input v-model="catForm.slug" placeholder="留空自动生成，例如 tech" />
        </el-form-item>
        <el-form-item label="描述">
          <el-input v-model="catForm.description" type="textarea" :rows="2" />
        </el-form-item>
        <el-form-item label="父级分类">
          <el-select v-model="catForm.parentId" placeholder="无（顶级分类）" clearable style="width: 100%">
            <el-option
              v-for="c in categories.filter((x) => x.id !== catForm.id)"
              :key="c.id"
              :label="c.name"
              :value="c.id"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="排序（数字越小越靠前）">
          <el-input-number v-model="catForm.sortOrder" :min="0" :max="999" style="width: 100%" />
        </el-form-item>
        <el-collapse>
          <el-collapse-item title="SEO 设置（可选）" name="seo">
            <el-form-item label="SEO 标题"><el-input v-model="catForm.seoTitle" maxlength="70" /></el-form-item>
            <el-form-item label="SEO 描述"><el-input v-model="catForm.seoDescription" type="textarea" :rows="2" maxlength="160" /></el-form-item>
          </el-collapse-item>
        </el-collapse>
      </el-form>
      <template #footer>
        <el-button @click="catDialog = false">取消</el-button>
        <el-button type="primary" @click="saveCat">保存</el-button>
      </template>
    </el-dialog>

    <!-- 标签编辑 -->
    <el-dialog v-model="tagDialog" :title="tagForm.id ? '编辑标签' : '新增标签'" width="480px">
      <el-form label-position="top">
        <el-form-item label="名称" required><el-input v-model="tagForm.name" placeholder="例如：Vue" /></el-form-item>
        <el-form-item label="URL 别名"><el-input v-model="tagForm.slug" placeholder="留空自动生成" /></el-form-item>
        <el-form-item label="描述"><el-input v-model="tagForm.description" type="textarea" :rows="2" /></el-form-item>
        <el-collapse>
          <el-collapse-item title="SEO 设置（可选）" name="seo">
            <el-form-item label="SEO 标题"><el-input v-model="tagForm.seoTitle" maxlength="70" /></el-form-item>
            <el-form-item label="SEO 描述"><el-input v-model="tagForm.seoDescription" type="textarea" :rows="2" maxlength="160" /></el-form-item>
          </el-collapse-item>
        </el-collapse>
      </el-form>
      <template #footer>
        <el-button @click="tagDialog = false">取消</el-button>
        <el-button type="primary" @click="saveTag">保存</el-button>
      </template>
    </el-dialog>

    <!-- 合并 -->
    <el-dialog v-model="mergeDialog" title="合并标签" width="440px">
      <el-alert type="warning" :closable="false" style="margin-bottom: 14px">
        <template #title><span style="font-size: 12.5px">源标签会被删除，其所有文章改为使用目标标签。合并后不可撤销。</span></template>
      </el-alert>
      <el-form label-position="top">
        <el-form-item label="源标签（将被删除）">
          <el-select v-model="mergeForm.sourceId" placeholder="选择标签" clearable style="width: 100%">
            <el-option v-for="t in tags" :key="t.id" :label="`#${t.name}（${t.postCount} 篇）`" :value="t.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="目标标签（保留）">
          <el-select v-model="mergeForm.targetId" placeholder="选择标签" clearable style="width: 100%">
            <el-option v-for="t in tags" :key="t.id" :label="`#${t.name}（${t.postCount} 篇）`" :value="t.id" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="mergeDialog = false">取消</el-button>
        <el-button type="warning" @click="doMerge">确认合并</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script lang="ts">
export default { name: 'Taxonomy' };
</script>
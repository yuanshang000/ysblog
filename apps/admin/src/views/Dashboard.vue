<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { dashboardApi } from '@/api';
import type { DashboardData } from '@myblog/shared';
import { formatRelative, formatDate, compactNumber } from '@myblog/shared';

const router = useRouter();
const loading = ref(true);
const data = ref<DashboardData | null>(null);

const maxViews = computed(() => {
  const t = data.value?.trend ?? [];
  return Math.max(1, ...t.map((p) => p.views));
});

const statusLabel = {
  draft: '草稿',
  published: '已发布',
  scheduled: '定时',
  archived: '归档',
  trashed: '回收站'
} as const;

function statusTagType(status: string): 'success' | 'info' | 'warning' | 'danger' {
  if (status === 'published') return 'success';
  if (status === 'scheduled' || status === 'archived') return 'warning';
  if (status === 'trashed') return 'danger';
  return 'info';
}

async function load(): Promise<void> {
  loading.value = true;
  try {
    data.value = await dashboardApi.get();
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '加载失败');
  } finally {
    loading.value = false;
  }
}

async function runJobs(): Promise<void> {
  try {
    const r = await dashboardApi.runJobs();
    ElMessage.success(r.published > 0 ? `已发布 ${r.published} 篇定时文章` : '定时任务已执行，无待发布文章');
    load();
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '执行失败');
  }
}

onMounted(load);
</script>

<template>
  <div v-loading="loading">
    <!-- 统计卡片 -->
    <div class="mb-stat-grid mb-mb-16">
      <div class="mb-stat">
        <div class="mb-stat-label">已发布文章</div>
        <div class="mb-stat-value">{{ data?.stats.publishedPosts ?? 0 }}</div>
        <div class="mb-stat-sub">共 {{ data?.stats.totalPosts ?? 0 }} 篇内容</div>
      </div>
      <div class="mb-stat">
        <div class="mb-stat-label">草稿</div>
        <div class="mb-stat-value">{{ data?.stats.draftPosts ?? 0 }}</div>
        <div class="mb-stat-sub">待完成或待发布</div>
      </div>
      <div class="mb-stat">
        <div class="mb-stat-label">定时发布</div>
        <div class="mb-stat-value">{{ data?.stats.scheduledCount ?? 0 }}</div>
        <div class="mb-stat-sub">
          <el-button link type="primary" size="small" @click="runJobs">立即执行</el-button>
        </div>
      </div>
      <div class="mb-stat">
        <div class="mb-stat-label">总浏览量</div>
        <div class="mb-stat-value">{{ compactNumber(data?.stats.totalViews ?? 0) }}</div>
        <div class="mb-stat-sub">今日 {{ data?.stats.todayViews ?? 0 }} 次</div>
      </div>
      <div class="mb-stat">
        <div class="mb-stat-label">独立访客</div>
        <div class="mb-stat-value">{{ compactNumber(data?.stats.totalVisitors ?? 0) }}</div>
        <div class="mb-stat-sub">今日 {{ data?.stats.todayVisitors ?? 0 }} 人</div>
      </div>
      <div class="mb-stat">
        <div class="mb-stat-label">待审核评论</div>
        <div class="mb-stat-value">{{ data?.stats.pendingComments ?? 0 }}</div>
        <div class="mb-stat-sub">
          <el-button link type="primary" size="small" @click="router.push('/comments')">去处理</el-button>
        </div>
      </div>
    </div>

    <!-- 快捷操作 -->
    <div class="mb-card mb-mb-16">
      <h3 class="mb-card-title">快速开始</h3>
      <div class="mb-flex mb-gap-2" style="flex-wrap: wrap">
        <el-button type="primary" @click="router.push('/posts/new')">
          <el-icon><EditPen /></el-icon><span style="margin-left: 6px">写新文章</span>
        </el-button>
        <el-button @click="router.push('/media')">
          <el-icon><Picture /></el-icon><span style="margin-left: 6px">上传图片</span>
        </el-button>
        <el-button @click="router.push('/categories')">
          <el-icon><Collection /></el-icon><span style="margin-left: 6px">管理分类标签</span>
        </el-button>
        <el-button @click="router.push('/settings')">
          <el-icon><Setting /></el-icon><span style="margin-left: 6px">站点设置</span>
        </el-button>
      </div>
    </div>

    <el-row :gutter="16">
      <el-col :xs="24" :lg="16">
        <!-- 访问趋势 -->
        <div class="mb-card mb-mb-16">
          <h3 class="mb-card-title">
            <span>近 14 天访问趋势</span>
            <span class="mb-muted" style="font-size: 12px; font-weight: 400">
              独立访客按 (路径 + 日期 + 访客哈希) 去重估算
            </span>
          </h3>
          <div class="mb-chart">
            <div
              v-for="p in data?.trend ?? []"
              :key="p.date"
              class="mb-chart-bar"
              :style="{ height: `${Math.max(2, (p.views / maxViews) * 100)}%` }"
              :title="`${p.date}：${p.views} 次浏览 / ${p.visitors} 位访客`"
            ></div>
          </div>
          <div class="mb-flex" style="justify-content: space-between; margin-top: 8px; font-size: 11.5px; color: #a1a1aa">
            <span>{{ data?.trend?.[0]?.date }}</span>
            <span>{{ data?.trend?.[data.trend.length - 1]?.date }}</span>
          </div>
        </div>

        <!-- 最近文章 -->
        <div class="mb-card">
          <h3 class="mb-card-title">
            <span>最近文章</span>
            <el-button link type="primary" size="small" @click="router.push('/posts')">查看全部</el-button>
          </h3>
          <el-table :data="data?.recentPosts ?? []" size="small" :show-header="false" style="width: 100%">
            <el-table-column>
              <template #default="{ row }">
                <div class="mb-post-title-cell">
                  <router-link :to="`/posts/${row.id}`" class="mb-post-title-link">{{ row.title }}</router-link>
                  <div class="mb-post-meta">
                    <el-tag size="small" :type="statusTagType(row.status)" effect="plain">
                      {{ statusLabel[row.status as keyof typeof statusLabel] }}
                    </el-tag>
                    <span>{{ formatRelative(row.updatedAt) }}更新</span>
                    <span>{{ row.wordCount }} 字</span>
                  </div>
                </div>
              </template>
            </el-table-column>
          </el-table>
        </div>
      </el-col>

      <el-col :xs="24" :lg="8">
        <!-- 热门文章 -->
        <div class="mb-card mb-mb-16">
          <h3 class="mb-card-title">热门文章 TOP</h3>
          <div v-if="!data?.topPosts?.length" class="mb-muted" style="font-size: 13px; padding: 10px 0">
            暂无访问数据
          </div>
          <div v-for="(p, i) in data?.topPosts ?? []" :key="p.slug" class="mb-flex mb-gap-2" style="padding: 6px 0; align-items: baseline">
            <span class="mb-muted" style="font-size: 12px; width: 16px">{{ i + 1 }}</span>
            <a :href="`/posts/${p.slug}`" target="_blank" rel="noopener" style="flex: 1; font-size: 13.5px; color: #1c1c1e; text-decoration: none; overflow: hidden; text-overflow: ellipsis; white-space: nowrap">
              {{ p.title }}
            </a>
            <span class="mb-muted" style="font-size: 12px">{{ p.views }}</span>
          </div>
        </div>

        <!-- 最近操作 -->
        <div class="mb-card">
          <h3 class="mb-card-title">
            <span>最近操作</span>
            <el-button link type="primary" size="small" @click="router.push('/logs')">全部日志</el-button>
          </h3>
          <div v-if="!data?.recentLogs?.length" class="mb-muted" style="font-size: 13px; padding: 10px 0">
            暂无操作记录
          </div>
          <div v-for="log in data?.recentLogs ?? []" :key="log.id" style="padding: 6px 0; border-bottom: 1px solid #f5f5f7">
            <div style="font-size: 13px">
              <strong>{{ log.username ?? '系统' }}</strong>
              <span class="mb-muted">{{ log.action }}</span>
            </div>
            <div class="mb-muted" style="font-size: 11.5px">
              {{ log.detail ? log.detail.slice(0, 40) : '' }} · {{ formatDate(log.createdAt, true) }}
            </div>
          </div>
        </div>
      </el-col>
    </el-row>
  </div>
</template>

<script lang="ts">
export default { name: 'Dashboard' };
</script>
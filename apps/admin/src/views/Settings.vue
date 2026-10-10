<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { authApi, settingsApi } from '@/api';
import type { SiteSettings, User } from '@myblog/shared';

const settings = ref<SiteSettings | null>(null);
const user = ref<User | null>(null);
const saving = ref(false);
const tab = ref('basic');

const profile = reactive({ displayName: '', email: '', avatarUrl: '', bio: '' });
const pwd = reactive({ currentPassword: '', newPassword: '', confirm: '' });

const origin = computed(() => location.origin);

async function load(): Promise<void> {
  try {
    const [s, u] = await Promise.all([settingsApi.get(), authApi.me()]);
    settings.value = s;
    user.value = u;
    Object.assign(profile, {
      displayName: u.displayName ?? '',
      email: u.email ?? '',
      avatarUrl: u.avatarUrl ?? '',
      bio: u.bio ?? ''
    });
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '加载失败');
  }
}

async function save(): Promise<void> {
  if (!settings.value) return;
  saving.value = true;
  try {
    settings.value = await settingsApi.update(settings.value);
    ElMessage.success('设置已保存');
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '保存失败');
  } finally {
    saving.value = false;
  }
}

async function saveProfile(): Promise<void> {
  try {
    user.value = await authApi.updateProfile(profile);
    ElMessage.success('资料已更新');
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '保存失败');
  }
}

async function changePassword(): Promise<void> {
  if (pwd.newPassword.length < 10) { ElMessage.warning('新密码至少 10 位'); return; }
  if (!/[A-Za-z]/.test(pwd.newPassword) || !/[0-9]/.test(pwd.newPassword)) {
    { ElMessage.warning('密码必须同时包含字母和数字'); return; }
  }
  if (pwd.newPassword !== pwd.confirm) { ElMessage.warning('两次输入的新密码不一致'); return; }
  try {
    await authApi.changePassword(pwd.currentPassword, pwd.newPassword);
    ElMessage.success('密码已更新，其他设备需重新登录');
    Object.assign(pwd, { currentPassword: '', newPassword: '', confirm: '' });
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '修改失败');
  }
}

onMounted(load);
</script>

<template>
  <div v-if="settings">
    <el-tabs v-model="tab" class="mb-card" style="margin-bottom: 16px">
      <!-- 基础信息 -->
      <el-tab-pane label="基础信息" name="basic">
        <el-form label-position="top" style="max-width: 640px">
          <el-row :gutter="14">
            <el-col :span="12">
              <el-form-item label="站点名称">
                <el-input v-model="settings.siteName" />
              </el-form-item>
            </el-col>
            <el-col :span="12">
              <el-form-item label="站点 URL">
                <el-input v-model="settings.siteUrl" :placeholder="origin" />
              </el-form-item>
            </el-col>
          </el-row>

          <el-form-item label="站点描述">
            <el-input v-model="settings.siteDescription" type="textarea" :rows="2" maxlength="160" show-word-limit />
          </el-form-item>

          <el-row :gutter="14">
            <el-col :span="12">
              <el-form-item label="每页文章数">
                <el-input-number v-model="settings.postsPerPage" :min="1" :max="50" style="width: 100%" />
              </el-form-item>
            </el-col>
            <el-col :span="12">
              <el-form-item label="默认 SEO 标题（可选）">
                <el-input v-model="settings.defaultSeoTitle" placeholder="留空使用站点名称" maxlength="70" />
              </el-form-item>
            </el-col>
          </el-row>

          <el-form-item label="默认 SEO 描述（可选）">
            <el-input v-model="settings.defaultSeoDescription" type="textarea" :rows="2" maxlength="160" show-word-limit />
          </el-form-item>
        </el-form>
      </el-tab-pane>

      <!-- SEO -->
      <el-tab-pane label="SEO" name="seo">
        <el-form label-position="top" style="max-width: 640px">
          <el-form-item>
            <el-checkbox v-model="settings.robotsIndex">允许搜索引擎索引本站（关闭后 robots.txt 将禁止全部抓取）</el-checkbox>
          </el-form-item>
          <el-alert type="info" :closable="false">
            <template #title>
              <div style="font-size: 12.5px; line-height: 1.9">
                <div>· 文章可单独设置 SEO 标题、描述、canonical 与 robots 标记，未填写时回退到文章标题与摘要</div>
                <div>· Sitemap：<a :href="`/api/v1/sitemap.xml`" target="_blank">{{ origin }}/api/v1/sitemap.xml</a></div>
                <div>· RSS：<a :href="`/api/v1/feed`" target="_blank">{{ origin }}/api/v1/feed</a></div>
                <div>· robots.txt：<a :href="`/api/v1/../robots.txt`" target="_blank">{{ origin }}/robots.txt</a></div>
                <div>· 后台、预览页已通过 robots 与 noindex 标签禁止索引</div>
              </div>
            </template>
          </el-alert>
        </el-form>
      </el-tab-pane>

      <!-- 评论 -->
      <el-tab-pane label="评论" name="comment">
        <el-form label-position="top" style="max-width: 640px">
          <el-form-item>
            <el-switch v-model="settings.commentEnabled" active-text="开启评论功能" />
            <div class="mb-muted" style="font-size: 12px; margin-top: 5px">
              关闭后前台不显示评论区，评论接口也会拒绝新提交
            </div>
          </el-form-item>
          <el-form-item>
            <el-switch v-model="settings.commentModeration" active-text="评论需要审核后显示" />
            <div class="mb-muted" style="font-size: 12px; margin-top: 5px">
              关闭后评论即时公开。命中垃圾规则的评论仍会自动进入垃圾箱
            </div>
          </el-form-item>
          <el-alert type="warning" :closable="false">
            <template #title>
              <span style="font-size: 12.5px">
                评论系统会保存昵称、可选邮箱与内容；邮箱不会公开展示，IP 仅保存加盐哈希用于频率限制
              </span>
            </template>
          </el-alert>
        </el-form>
      </el-tab-pane>

      <!-- 统计 -->
      <el-tab-pane label="访问统计" name="analytics">
        <el-form label-position="top" style="max-width: 640px">
          <el-form-item>
            <el-switch v-model="settings.analyticsEnabled" active-text="启用访问统计" />
            <div class="mb-muted" style="font-size: 12px; margin-top: 5px">
              统计口径：一次文章页访问记 1 次浏览；独立访客按 (访客哈希 + 日期) 去重，机器人流量已自动排除
            </div>
          </el-form-item>
          <el-form-item label="统计数据保留天数">
            <el-input-number v-model="settings.analyticsRetentionDays" :min="7" :max="3650" :step="30" />
            <div class="mb-muted" style="font-size: 12px; margin-top: 5px">
              定时任务会定期清理超出保留期的访问记录（默认 180 天）
            </div>
          </el-form-item>
        </el-form>
      </el-tab-pane>

      <!-- 安全 -->
      <el-tab-pane label="安全" name="security">
        <el-form label-position="top" style="max-width: 640px">
          <el-form-item label="当前用户名">
            <el-input :model-value="user?.username" disabled />
            <div class="mb-muted" style="font-size: 12px; margin-top: 4px">用户名创建后不可修改</div>
          </el-form-item>

          <el-form-item label="显示名称">
            <el-input v-model="profile.displayName" placeholder="在前台文章署名中显示" />
          </el-form-item>
          <el-form-item label="邮箱">
            <el-input v-model="profile.email" placeholder="用于联系，不会公开" />
          </el-form-item>
          <el-form-item label="个人简介">
            <el-input v-model="profile.bio" type="textarea" :rows="3" />
          </el-form-item>
          <el-button type="primary" @click="saveProfile">保存个人资料</el-button>

          <el-divider style="margin: 24px 0 18px" />
          <h4 style="font-size: 14px; font-weight: 620; margin: 0 0 12px">修改密码</h4>

          <el-form-item label="当前密码">
            <el-input v-model="pwd.currentPassword" type="password" show-password style="max-width: 320px" />
          </el-form-item>
          <el-form-item label="新密码">
            <el-input v-model="pwd.newPassword" type="password" show-password placeholder="至少 10 位，含字母和数字" style="max-width: 320px" />
          </el-form-item>
          <el-form-item label="确认新密码">
            <el-input v-model="pwd.confirm" type="password" show-password style="max-width: 320px" @keyup.enter="changePassword" />
          </el-form-item>
          <el-button type="warning" @click="changePassword">修改密码</el-button>
          <div class="mb-muted" style="font-size: 12px; margin-top: 6px">修改后其他设备的所有登录会话都会失效</div>
        </el-form>

        <el-divider style="margin: 24px 0 18px" />
        <h4 style="font-size: 14px; font-weight: 620; margin: 0 0 8px">密钥管理</h4>
        <el-alert type="info" :closable="false">
          <template #title>
            <div style="font-size: 12.5px; line-height: 1.9">
              <div style="font-weight: 600; margin-bottom: 4px">敏感密钥不保存在数据库，也不在此页面配置</div>
              <div>请使用 Wrangler 命令设置，并定期轮换：</div>
              <div style="margin-top: 6px">
                <code>npx wrangler secret put SESSION_SECRET</code><br />
                <code>npx wrangler secret put IP_HASH_SALT</code><br />
                <code>npx wrangler secret put ADMIN_SETUP_TOKEN</code>
              </div>
              <div style="margin-top: 6px">初始化完成后建议删除 <code>ADMIN_SETUP_TOKEN</code>：<code>npx wrangler secret delete ADMIN_SETUP_TOKEN</code></div>
            </div>
          </template>
        </el-alert>
      </el-tab-pane>

      <!-- 备份 -->
      <el-tab-pane label="数据备份" name="backup">
        <div style="max-width: 720px">
          <el-alert type="warning" :closable="false" style="margin-bottom: 16px">
            <template #title>
              <span style="font-size: 12.5px">
                GitHub 代码仓库不是数据库备份。文章与图片必须单独导出备份
              </span>
            </template>
          </el-alert>

          <h4 style="font-size: 14px; font-weight: 620; margin: 0 0 8px">导出数据库（D1）</h4>
          <pre style="background: #f7f8fa; border: 1px solid #e8e8ea; border-radius: 8px; padding: 12px; font-size: 12px; overflow-x: auto; margin: 0 0 16px">npx wrangler d1 export myblog --remote --output backup-$(date +%Y%m%d).sql</pre>

          <h4 style="font-size: 14px; font-weight: 620; margin: 0 0 8px">同步图片（R2）</h4>
          <pre style="background: #f7f8fa; border: 1px solid #e8e8ea; border-radius: 8px; padding: 12px; font-size: 12px; overflow-x: auto; margin: 0 0 16px">npx wrangler r2 object sync myblog-media ./backup-media</pre>

          <h4 style="font-size: 14px; font-weight: 620; margin: 0 0 8px">恢复数据库</h4>
          <pre style="background: #f7f8fa; border: 1px solid #e8e8ea; border-radius: 8px; padding: 12px; font-size: 12px; overflow-x: auto; margin: 0 0 16px">npx wrangler d1 execute myblog --remote --file=backup-20260101.sql</pre>

          <h4 style="font-size: 14px; font-weight: 620; margin: 0 0 8px">建议的备份频率</h4>
          <ul style="font-size: 13px; line-height: 1.9; color: #57565e; padding-left: 20px; margin: 0">
            <li>发布重要文章后：立即导出一次数据库</li>
            <li>定期（建议每周）：执行一次数据库导出 + R2 同步</li>
            <li>图片目录与数据库备份必须<b>成对保存</b>，否则文章会出现坏图</li>
            <li>至少保留 3 份历史备份异地存放（如本地 + 云盘）</li>
          </ul>
        </div>
      </el-tab-pane>
    </el-tabs>

    <div v-if="tab !== 'security'" style="position: sticky; bottom: 0; padding: 12px 0">
      <el-button type="primary" size="large" :loading="saving" @click="save" style="min-width: 160px">
        保存设置
      </el-button>
    </div>
  </div>
</template>

<script lang="ts">
export default { name: 'Settings' };
</script>
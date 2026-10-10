/**
 * 定时任务（Cron Triggers）
 *
 *  1. 发布到期的定时文章；
 *  2. 清理过期会话与登录失败记录；
 *  3. 按保留周期清理访问统计数据；
 *  4. 清理无引用的孤儿媒体。
 */
import type { Env } from '../lib/env';
import { listPosts, logOperation } from '../repositories/db';
import { getSettings } from '../services/settings';

export async function runScheduledJobs(env: Env): Promise<void> {
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const summary = { published: 0, sessions: 0, logs: 0, views: 0, orphanMedia: 0 };

  // 1. 定时发布
  const due = await env.DB.prepare(
    `SELECT id, title FROM posts
      WHERE status = 'scheduled' AND scheduled_at IS NOT NULL AND scheduled_at <= ?`
  )
    .bind(now)
    .all<{ id: number; title: string }>();

  for (const post of due.results) {
    try {
      await env.DB.prepare(
        `UPDATE posts SET status='published', published_at = scheduled_at, scheduled_at = NULL,
          updated_at = ?, revision = revision + 1
         WHERE id = ? AND status='scheduled'`
      )
        .bind(now, post.id)
        .run();
      summary.published++;
      await logOperation(env, null, 'system', 'post.auto_publish', 'post', post.id, post.title);
    } catch (e) {
      console.error('[cron] 定时发布失败', post.id, e);
    }
  }

  // 2. 清理过期会话
  const sessions = await env.DB.prepare('DELETE FROM sessions WHERE expires_at <= ?')
    .bind(now)
    .run();
  summary.sessions = sessions.meta.changes ?? 0;

  // 3. 清理 30 天前的登录失败记录
  const logs = await env.DB.prepare(
    `DELETE FROM login_attempts WHERE created_at <= datetime('now', '-30 days')`
  ).run();
  summary.logs = logs.meta.changes ?? 0;

  // 4. 按保留周期清理统计数据
  try {
    const settings = await getSettings(env);
    if (settings.analyticsEnabled) {
      const days = Math.min(3650, Math.max(7, settings.analyticsRetentionDays));
      const views = await env.DB.prepare(
        `DELETE FROM page_views WHERE created_at <= datetime('now', ?)`
      )
        .bind(`-${days} days`)
        .run();
      summary.views = views.meta.changes ?? 0;
    }
  } catch (e) {
    console.error('[cron] 统计清理失败', e);
  }

  // 5. 清理孤儿媒体（未被任何内容引用且超过 30 天）
  const cutoff = new Date(Date.now() - 30 * 86400000).toISOString().replace('T', ' ').slice(0, 19);
  const orphans = await env.DB.prepare(
    `SELECT m.id, m.object_key FROM media m
      WHERE m.created_at <= ?
        AND NOT EXISTS (SELECT 1 FROM posts WHERE cover_media_id = m.id OR content LIKE '%' || m.object_key || '%')
        AND NOT EXISTS (SELECT 1 FROM site_settings
                        WHERE value = m.object_key OR value LIKE '%' || m.object_key || '%')`
  )
    .bind(cutoff)
    .all<{ id: number; object_key: string }>();

  for (const m of orphans.results) {
    try {
      await env.BUCKET.delete(m.object_key);
      await env.DB.prepare('DELETE FROM media WHERE id = ?').bind(m.id).run();
      summary.orphanMedia++;
    } catch (e) {
      console.error('[cron] 媒体清理失败', m.id, e);
    }
  }

  console.log(
    `[cron] 完成：发布 ${summary.published} 篇 / 清理会话 ${summary.sessions} / 登录记录 ${summary.logs} / 统计 ${summary.views} / 孤儿媒体 ${summary.orphanMedia}`
  );
}

/** 供 /api/v1/admin/jobs/run 手动触发（管理员） */
export async function runJobsNow(env: Env): Promise<{ published: number }> {
  const before = await listPosts(env, { type: 'post', status: 'scheduled', page: 1, pageSize: 1 }, '');
  await runScheduledJobs(env);
  const after = await listPosts(env, { type: 'post', status: 'scheduled', page: 1, pageSize: 1 }, '');
  return { published: Math.max(0, before.total - after.total) };
}
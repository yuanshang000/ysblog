import { describe, it, expect } from 'vitest';
import { rewriteSql } from '../apps/worker/src/lib/db-adapter';

describe('SQLite → Postgres 方言转换', () => {
  it('占位符 ? 转为 $n 并按顺序编号', () => {
    expect(rewriteSql('SELECT * FROM t WHERE a = ? AND b = ?')).toBe(
      'SELECT * FROM t WHERE a = $1 AND b = $2'
    );
  });

  it("datetime('now') → NOW()", () => {
    expect(rewriteSql("SELECT datetime('now')")).toBe('SELECT NOW()');
  });

  it("datetime('now','-1 day') → 区间表达式", () => {
    const out = rewriteSql("SELECT datetime('now','-1 day')");
    expect(out).toContain('INTERVAL');
    expect(out).toContain('day');
  });

  it("strftime('%Y-%m-%d', x) → TO_CHAR", () => {
    const out = rewriteSql("SELECT strftime('%Y-%m-%d', created_at) FROM posts");
    expect(out).toBe("SELECT TO_CHAR(created_at, 'YYYY-MM-DD') FROM posts");
  });

  it("date(expr) → TO_CHAR(expr, 'YYYY-MM-DD')", () => {
    const out = rewriteSql('SELECT date(created_at) FROM page_views');
    expect(out).toBe("SELECT TO_CHAR(created_at, 'YYYY-MM-DD') FROM page_views");
  });

  it('INSERT OR IGNORE → INSERT INTO（由调用方补ON CONFLICT）', () => {
    const out = rewriteSql('INSERT OR IGNORE INTO post_tags (post_id) VALUES (?)');
    expect(out).toBe('INSERT INTO post_tags (post_id) VALUES ($1)');
    expect(out).not.toContain('OR IGNORE');
  });

  it('日期函数与占位符共存时都能正确转换', () => {
    const sql = "SELECT TO_CHAR(x,'YYYY') FROM t WHERE d >= date('now', ?) AND id = ?";
    const out = rewriteSql(sql.replace(/TO_CHAR\(x,'YYYY'\)/, "strftime('%Y-%m-%d', x)"));
    // date('now', ?) 展开后内部的 ? 应编号为 $1，其后的 ? 为 $2
    expect(out).toContain('$1');
    expect(out).toContain('$2');
  });

  it('普通 SQL 不受影响', () => {
    const sql = 'SELECT id, title FROM posts WHERE status = $1 ORDER BY published_at DESC LIMIT $2';
    expect(rewriteSql(sql)).toBe(sql);
  });

  it('字符串字面量中的问号不被误替换（参数不错位）', () => {
    // 回归用例：曾经用全局 /[?]/g 替换，导致 'why?' 也被编号，
    // 真正的占位符被推到 $2，查询会命中错误的列。
    const out = rewriteSql("SELECT * FROM t WHERE note = 'why?' AND id = ?");
    expect(out).toBe("SELECT * FROM t WHERE note = 'why?' AND id = $1");
    expect(out).not.toContain('$2');
  });

  it('转义单引号不会破坏字符串边界判定', () => {
    const out = rewriteSql("SELECT * FROM t WHERE a = 'it''s ok?' AND b = ?");
    expect(out).toContain("'it''s ok?'");
    expect(out).toContain('$1');
  });

  it('|| 拼接保持原样（Postgres 语义一致，无需改写）', () => {
    const sql = "SELECT * FROM t WHERE name LIKE '%' || ? || '%'";
    expect(rewriteSql(sql)).toBe("SELECT * FROM t WHERE name LIKE '%' || $1 || '%'");
  });
});
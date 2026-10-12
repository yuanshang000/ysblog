import { describe, it, expect } from 'vitest';
import { rewriteSql, normalizeRow } from '../apps/worker/src/lib/db-adapter';

describe('SQLite → Postgres 方言转换', () => {
  it('IFNULL → COALESCE（Postgres 无 ifnull 函数）', () => {
    // 回归：媒体库统计接口曾报 function ifnull(numeric, integer) does not exist
    expect(rewriteSql('SELECT COUNT(*) AS c, IFNULL(SUM(file_size),0) AS bytes FROM media')).toBe(
      'SELECT COUNT(*) AS c, COALESCE(SUM(file_size),0) AS bytes FROM media'
    );
    expect(rewriteSql("SELECT LOWER(IFNULL(p.excerpt,'')) FROM posts p")).toBe(
      "SELECT LOWER(COALESCE(p.excerpt,'')) FROM posts p"
    );
  });

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

  // 以下两组为线上 500（operator does not exist: text = date）的回归用例。
  // 该报错使后台「仪表盘」接口完全不可用。

  it("date('now') 返回 TEXT，与 date(col) 的结果类型一致", () => {
    const out = rewriteSql("SELECT COUNT(*) FROM page_views WHERE date(created_at) = date('now')");
    expect(out).toBe(
      "SELECT COUNT(*) FROM page_views WHERE TO_CHAR(created_at, 'YYYY-MM-DD') = TO_CHAR(CURRENT_DATE, 'YYYY-MM-DD')"
    );
    // 两边都必须是 TO_CHAR，否则一边 TEXT 一边 date 会导致运算符不存在
    const matches = out.match(/TO_CHAR\(/g);
    expect(matches).toHaveLength(2);
  });

  it("date('now', ?) 带偏移时返回 date 类型，可与 timestamp 列比较", () => {
    const out = rewriteSql("SELECT * FROM page_views WHERE created_at >= date('now', ?)");
    // 必须是 date 而非 TEXT，否则 timestamp >= text 会报运算符不存在
    expect(out).toContain('::date');
    expect(out).toContain('CAST($1 AS INTERVAL)');
    // 绑定值已含单位（'-7 days'），不能再次拼接
    expect(out).not.toContain("' days'");
  });

  it("datetime('now', ?) 带偏移时同样交给 interval 解析", () => {
    const out = rewriteSql("DELETE FROM page_views WHERE created_at <= datetime('now', ?)");
    expect(out).toContain('CAST($1 AS INTERVAL)');
    // 重复拼接单位会得到 '-7 days days'，Postgres 直接报错
    expect(out).not.toContain("' days'");
  });

  it('仪表盘统计 SQL 改写后不含裸 date() 调用', () => {
    const sql =
      'SELECT date(created_at) AS date, COUNT(*) AS views FROM page_views ' +
      "WHERE is_bot = 0 AND created_at >= date('now', ?) GROUP BY date(created_at) ORDER BY date ASC";
    const out = rewriteSql(sql);
    // Postgres 没有 date() 函数，残留即报错
    expect(out).not.toMatch(/\bdate\(/i);
    expect(out).toContain('TO_CHAR');
  });
});

describe('Postgres 行归一（对齐 SQLite 的返回类型）', () => {
  // 回归用例：COUNT(*) 在 Postgres 返回 bigint，pg 驱动给出字符串 "3"，
  // 业务代码 `0 + '3'` 得到 "03"，后台工作台 totalPosts 曾显示为 "03000"。

  it('纯数字字符串还原为 number', () => {
    const r = normalizeRow({ published: '3', draft: '0' });
    expect(r.published).toBe(3);
    expect(r.draft).toBe(0);
  });

  it('还原后可正确参与数值累加', () => {
    const counts = normalizeRow({ a: '3', b: '2' });
    const total = Object.values(counts).reduce((x, y) => (x as number) + (y as number), 0);
    expect(total).toBe(5);
  });

  it('bigint 原生类型同样转number', () => {
    const r = normalizeRow({ n: 42n });
    expect(r.n).toBe(42);
  });

  it('Date 归一为 SQLite 风格的日期字符串', () => {
    const r = normalizeRow({ created_at: new Date('2026-10-11T06:13:30Z') });
    expect(r.created_at).toBe('2026-10-11 06:13:30');
  });

  it('不应误转的业务文本', () => {
    const r = normalizeRow({
      slug: '007',
      version: '1.2.3',
      code: '03000',
      note: 'why?',
      title: 'TypeScript 类型体操入门'
    });
    expect(r.slug).toBe('007');
    expect(r.version).toBe('1.2.3');
    expect(r.code).toBe('03000');
    expect(r.note).toBe('why?');
    expect(r.title).toBe('TypeScript 类型体操入门');
  });
});
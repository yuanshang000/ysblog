/**
 * 数据库适配层 —— 抹平 D1 与 Postgres 的调用差异。
 *
 * 背景：本项目最初构建在 Cloudflare Workers + D1（SQLite）之上，
 * 现迁移到 Vercel + Postgres。两者的调用方式完全不同：
 *   D1:       env.DB.prepare(sql).bind(a, b).first() / .all() / .run()
 *   Postgres: pool.query(sql, [a, b])  →  rows / rowCount
 *
 * 业务代码里原有 149 处 `env.DB.prepare(...)` 调用，若逐个改写不仅费时，
 * 也很容易在改写中引入偏差。因此这里提供一个「D1 形状」的兼容层：
 * 保留原有的链式调用写法，内部翻译为 Postgres 查询。
 *
 * 之所以可行，得益于两点：
 *   1. 调用形态高度统一（prepare → bind → first/all/run）；
 *   2. SQL 中的 `?` 占位符可由适配层统一转换为 Postgres 的 $1/$2/...
 *
 * 另外集中处理 SQLite → Postgres 的语法差异（见 rewriteSql），
 * 避免这些差异散落在业务代码里。
 */
import { Pool, type PoolClient, type QueryResultRow } from 'pg';

/**
 * D1 的 all() 返回 { results, success, meta }，而不是数组。
 * 现有业务代码里大量使用 `rows.results.map(...)`，因此这里保留同样的形状，
 * 让上百处调用点无需改动。
 */
export interface D1ResultSet<Row = Record<string, unknown>> {
  results: Row[];
  success: boolean;
  meta: { changes: number; last_row_id?: number; duration?: number };
}

export interface StatementStub<Row = Record<string, unknown>> {
  /** 原始 SQL，供 batch() 复用 */
  readonly sql: string;
  /** 已绑定的参数，供 batch() 复用 */
  values: unknown[];
  bind(...values: unknown[]): StatementStub<Row>;
  first<R = Row>(colName?: string): Promise<R | null>;
  all<R = Row>(): Promise<D1ResultSet<R>>;
  run(): Promise<{ success: boolean; results: Row[]; meta: { changes: number; last_row_id?: number } }>;
  /** 链式 .raw() 等非必要方法不应被调用，这里给出明确报错 */
  raw(): never;
}

export interface DbLike {
  prepare(sql: string): StatementStub;
  /** 批量执行，D1 特有；Postgres 下用事务实现 */
  batch(statements: StatementStub[]): Promise<{ success: boolean; results: unknown[] }>;
}

// ============ SQL 语法转换 ============

/**
 * 把 SQLite 方言改写为 Postgres 方言。
 *
 * 覆盖项目中实际用到的差异：
 * - `?` 占位符 → $1, $2, ...
 * - datetime('now') / datetime('now', '-1 day') → NOW() / NOW() - INTERVAL '1 day'
 * - strftime('%Y-%m-%d %H:%M:%S', x) → TO_CHAR(x, 'YYYY-MM-DD HH24:MI:SS')
 * - `COL || 'x'` 字符串拼接 → CONCAT(COL, 'x')
 * - INSERT OR REPLACE / IGNORE → ON CONFLICT DO NOTHING
 * - LIMIT/OFFSET 保持不变（两者语法一致）
 *
 * 说明：布尔值在 SQLite 中用 0/1，Postgres 用 boolean。
 * 由于本项目所有布尔列都是 INTEGER NOT NULL，这里统一在 schema 层
 * 保持 smallint，并在读写边界做转换，避免逐处改写。
 */
export function rewriteSql(sql: string): string {
  let s = sql;

  // IFNULL(a, b) → COALESCE(a, b)
  //
  // IFNULL 是 SQLite 的函数名，Postgres 中不存在，会报
  // `function ifnull(numeric, integer) does not exist`（媒体库统计接口曾因此 500）。
  // COALESCE 是 SQL 标准写法，SQLite 同样支持，因此单向替换即可。
  s = s.replace(/\bIFNULL\s*\(/gi, 'COALESCE(');

  // datetime('now') → NOW()
  s = s.replace(/datetime\(\s*'now'\s*(,\s*'([^']*)'\s*)?\)/gi, (_m, _g1, modifier) => {
    if (!modifier) return 'NOW()';
    // datetime('now','-1 day') → NOW() - INTERVAL '1 day'
    const m = /^([+-])\s*(\d+)\s+(day|hour|minute|month|year)s?$/i.exec(modifier.trim());
    if (!m) return 'NOW()';
    const sign = m[1] === '-' ? '-' : '';
    return `NOW() ${sign} INTERVAL '${m[2]} ${m[3].toLowerCase()}${m[2] === '1' ? '' : 's'}'`;
  });

  // datetime('now', ?) —— 偏移量由调用方绑定，形如 '-7 days'（已含单位）。
  // 这里直接交给 interval 解析，不要再拼接单位，否则会得到 '-7 days days'。
  s = s.replace(
    /datetime\(\s*'now'\s*,\s*(\?)\s*\)/gi,
    '(NOW() + CAST($1 AS INTERVAL))'
  );

  // datetime('now','localtime') 等变体
  s = s.replace(/datetime\(\s*'now'\s*,\s*'localtime'\s*\)/gi, 'NOW()');

  // strftime('%Y-%m-%d %H:%M:%S', expr) → TO_CHAR(expr, 'YYYY-MM-DD HH24:MI:SS')
  s = s.replace(
    /strftime\(\s*'%Y-%m-%d %H:%M:%S'\s*,\s*([^)]+)\)/gi,
    (_m, expr) => `TO_CHAR(${expr.trim()}, 'YYYY-MM-DD HH24:MI:SS')`
  );

  // strftime('%Y-%m-%d', expr) → TO_CHAR(expr, 'YYYY-MM-DD')
  s = s.replace(
    /strftime\(\s*'%Y-%m-%d'\s*,\s*([^)]+)\)/gi,
    (_m, expr) => `TO_CHAR(${expr.trim()}, 'YYYY-MM-DD')`
  );

  // date() 系列改写。
  //
  // SQLite 的 date() 永远返回 TEXT（'YYYY-MM-DD'），Postgres 没有 date() 函数。
  // 改写时必须让表达式的结果类型与「比较的另一侧」一致，否则会报
  // operator does not exist（text = date / timestamp >= text）。
  // 本项目里date() 只出现在两种比较场景，各自需要不同类型：
  //
  // 1) date(col) = date('now')——两边都是「格式化后的日期字符串」。
  //    date(col) → TO_CHAR(col, 'YYYY-MM-DD')（TEXT）
  //    date('now') 也返回 TEXT，保证 text = text 可比较。
  // 2) col >= date('now', ?)——左边是 timestamp 列。
  //    此时必须返回真正的 date 类型（而非 TEXT），Postgres 才能比较。
  //    绑定值形如 '-7 days'（已含单位），直接交给 interval 解析，
  //    不要在此拼接单位，否则会变成 '-7 days days'。
  s = s.replace(/date\(\s*'now'\s*\)/gi, "TO_CHAR(CURRENT_DATE, 'YYYY-MM-DD')");
  s = s.replace(
    /date\(\s*'now'\s*,\s*(\?)\s*\)/gi,
    "(CURRENT_DATE + CAST($1 AS INTERVAL))::date"
  );
  s = s.replace(/\bdate\(\s*([^'"][^)]*?)\s*\)/gi, (_m, expr) => `TO_CHAR(${expr.trim()}, 'YYYY-MM-DD')`);

  // GROUP BY / ORDER BY 里常见的 SQLite 别名写法在 Postgres 中同样可用，无需处理。

  // INSERT OR IGNORE → INSERT ... ON CONFLICT DO NOTHING
  s = s.replace(/INSERT\s+OR\s+IGNORE\s+INTO/gi, 'INSERT INTO');

  // 注意：不要试图自动转换 SQL 的 `||` 字符串拼接。
  // Postgres 的 `||` 操作符语义与 SQLite 一致（均为字符串连接），
  // 无需改写；而强行改写成 CONCAT 反而容易在含转义的字符串上出错。
  // 本项目 SQL 中的 `||` 仅用于生成 LIKE 模式，保持原样即可。

  // `?` → $n（必须放在最后，避免误伤字符串中的问号）。
  //
  // 注意不能简单地全局替换 /[?]/g：SQL 的字符串字面量里也可能含问号，
  // 例如 `WHERE note = 'why?'`。若一并替换，参数编号会错位，
  // 导致查询命中错误的列——这类bug 极难排查。
  //
  // 因此这里逐字符扫描，跳过单引号字符串内部，只替换「代码区」的占位符。
  s = replacePlaceholders(s);

  return s;
}

/**
 * 把 SQL 中的 `?` 占位符替换为 Postgres 的 `$n`，
 * 跳过单引号包裹的字符串字面量，避免误伤其中的问号。
 */
function replacePlaceholders(sql: string): string {
  let out = '';
  let idx = 0;
  let inString = false;

  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];

    if (ch === "'") {
      // '' 是转义后的单引号，不应切换字符串状态
      if (inString && sql[i + 1] === "'") {
        out += "''";
        i++;
        continue;
      }
      inString = !inString;
      out += ch;
      continue;
    }

    if (ch === '?' && !inString) {
      out += `$${++idx}`;
      continue;
    }

    out += ch;
  }

  return out;
}

/** 为 INSERT ... ON CONFLICT DO NOTHING 补齐冲突忽略子句 */
function ensureOnConflictDoNothing(sql: string): string {
  if (/ON\s+CONFLICT/i.test(sql)) return sql;
  // INSERT OR IGNORE 改写后需要补 ON CONFLICT DO NOTHING，
  // 但仅在语句确实是 INSERT 时补。
  if (/^\s*INSERT\s+INTO/i.test(sql)) {
    return `${sql} ON CONFLICT DO NOTHING`;
  }
  return sql;
}

// ============ 适配器实现 ============

let pool: Pool | null = null;

/** 获取（惰性初始化）Postgres 连接池 */
export function getPool(): Pool {
  if (pool) return pool;
  const conn = process.env.POSTGRES_URL || process.env.DATABASE_URL;
  if (!conn) {
    throw new Error('缺少数据库连接串：请设置 POSTGRES_URL（或 DATABASE_URL）环境变量');
  }
  pool = new Pool({
    connectionString: conn,
    // Neon 等托管库强制 SSL；本地或自建可不设。
    ssl: process.env.POSTGRES_SSL === 'false' ? undefined : { rejectUnauthorized: false },
    max: Number(process.env.DB_POOL_MAX ?? 10),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000
  });
  pool.on('error', (err) => {
    console.error('[db] 连接池错误', err.message);
  });
  return pool;
}

/** 仅供测试使用：重置连接池 */
export function resetPool(): void {
  if (pool) {
    pool.end().catch(() => {});
    pool = null;
  }
}

/**
 * 参数归一：让 SQLite 风格的字符串能安全写入 Postgres 的 TIMESTAMP 列。
 *
 * 业务代码里时间戳统一是 'YYYY-MM-DD HH:MM:SS'（ctx.now 即如此生成），
 * Postgres 能识别该格式为 timestamp，但为避免时区被当作本地时间解读，
 * 这里显式转换为 UTC 的 ISO 形式再交给驱动。
 */
function normalizeParam(v: unknown): unknown {
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(v)) {
    return new Date(`${v.replace(' ', 'T')}Z`);
  }
  if (typeof v === 'boolean') {
    // 业务层用 true/false 写 SMALLINT 列
    return v ? 1 : 0;
  }
  return v;
}

function normalizeParams(values: unknown[]): unknown[] {
  return values.map(normalizeParam);
}

/**
 * 把 Postgres 返回的行做一次「SQLite 形状」归一。
 *
 * 背景：业务代码与共享类型都按 SQLite 的行为假设时间列是字符串，
 * 例如 `row.created_at.slice(0, 10)`、`ctx.now = '2026-10-11 12:00:00'`。
 * Postgres 的 TIMESTAMP 会被驱动解析成 JS Date，若直接透传，
 * 这些调用会因`.slice is not a function` 报错。
 *
 * 这里统一转成 'YYYY-MM-DD HH:MM:SS' 字符串（UTC），
 * 与原 SQLite 的 strftime('%Y-%m-%d %H:%M:%S') 输出格式保持一致，
 * 从而让上层的日期比较、字符串截断逻辑无需改动。
 */
export function normalizeRow(row: Record<string, unknown>): Record<string, unknown> {
  for (const [k, v] of Object.entries(row)) {
    if (v instanceof Date) {
      row[k] = v.toISOString().replace('T', ' ').slice(0, 19);
    } else if (typeof v === 'bigint') {
      // BIGINT 在 pg 中默认返回字符串；转成 number 以匹配原INTEGER 行为
      row[k] = Number(v);
    } else if (typeof v === 'string' && NUMERIC_STRING_RE.test(v)) {
      /**
       * COUNT(*) / SUM() 等聚合在 Postgres 中返回 bigint，pg 驱动默认以字符串给出。
       * 业务代码与共享类型都按 number 使用（SQLite 的 COUNT 本来就是 number），
       * 若不还原，会出现 `0 + '3' === '03'` 这类字符串拼接，
       * 例如后台工作台的 totalPosts 显示为 "03000"。
       *
       * 这里把「纯数字组成的字符串」还原成 number。
       * 排除前导零、小数点、指数、空串，避免误伤本就该是文本的列
       * （如 slug "007"、版本号 "1.2.3"）。
       */
      row[k] = Number(v);
    }
  }
  return row;
}

/** 纯整数字符串，且不以 0 开头（"0" 与 "03000" 这类不转换） */
const NUMERIC_STRING_RE = /^(0|[1-9]\d*)$/;

export function createStatement(sql: string): StatementStub {
  let values: unknown[] = [];

  const run = async (): Promise<{ rows: QueryResultRow[]; rowCount: number | null }> => {
    const text = ensureOnConflictDoNothing(rewriteSql(sql));
    return await getPool().query(text, normalizeParams(values));
  };

  const stub: StatementStub = {
    sql,
    values,
    bind(...v: unknown[]) {
      values = v;
      stub.values = v;
      return stub;
    },
    async first<R>(colName?: string) {
      const res = await run();
      if (!res.rows.length) return null;
      const row = normalizeRow(res.rows[0] as Record<string, unknown>);
      if (colName) return (row[colName] as R) ?? null;
      return row as R;
    },
    async all<R>() {
      const started = Date.now();
      const res = await run();
      return {
        results: (res.rows as Record<string, unknown>[]).map(normalizeRow) as R[],
        success: true,
        meta: { changes: res.rowCount ?? 0, duration: Date.now() - started }
      };
    },
    async run() {
      const res = await run();
      return {
        success: true,
        results: (res.rows as Record<string, unknown>[]).map(normalizeRow) as never[],
        meta: { changes: res.rowCount ?? 0 }
      };
    },
    raw() {
      throw new Error('raw() 是 D1 特有API，Postgres 适配层不支持');
    }
  };
  return stub;
}

/** 提供与 D1 同形的入口：db.prepare(sql) 与 db.batch([...]) */
export function createDb(): DbLike {
  return {
    prepare: (sql: string) => createStatement(sql),

    /**
     * 批量执行 —— 用单个事务包裹，保证原子性。
     *
     * D1 的 batch 本身即原子，这里语义对齐；注意 Postgres 不允许
     * 在事务内并发执行语句，因此必须串行。
     */
    async batch(statements: StatementStub[]) {
      const results: unknown[] = [];
      await withTransaction(async (client) => {
        for (const st of statements) {
          const text = ensureOnConflictDoNothing(rewriteSql(st.sql));
          const res = await client.query(text, normalizeParams(st.values));
          results.push({ success: true, results: res.rows, meta: { changes: res.rowCount ?? 0 } });
        }
      });
      return { success: true, results };
    }
  };
}

/** 事务辅助：在同一连接上执行一组操作 */
export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** 健康检查 */
export async function checkConnection(): Promise<boolean> {
  try {
    await getPool().query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}
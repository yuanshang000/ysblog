#!/usr/bin/env bash
#
# 确保 D1 数据库存在，并输出 database_id。
#
# 设计要点：
# 1. 不用 `wrangler d1 list --json` —— 该 JSON 的字段名在 wrangler v3/v4 之间不一致
#    （v3 内部映射用 database_id，Cloudflare REST API 用 uuid），解析极易出错；
#    改为从「表格文本 + create 输出」中用正则提取 32 位 hex，对所有版本都稳定。
# 2. 严格匹配名称 myblog（而非 myblog-staging 等前缀相同的库），避免回填错ID。
# 3. 幂等：已存在则复用，不存在则创建。
#
# 用法：
#   ./scripts/ensure-d1.sh              # 正常执行
#   DB_ID=$(./scripts/ensure-d1.sh)     # 直接取 ID
#
# 输出：成功时 stdout 为 database_id；失败时退出码非 0 并在stderr 打印原因。

set -euo pipefail

DB_NAME="${1:-myblog}"
UUID_PATTERN='[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'

log() { echo "$*" >&2; }

# 从 wrangler d1 list 的表格输出中找出指定库的 ID。
# 表格形如：│ myblog │ <uuid> │
# 注意不能直接用 awk $NF —— 表格边框会让最后一列变成空串。
find_existing_id() {
  npx wrangler d1 list 2>/dev/null | node -e '
    const pattern = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;
    const target = process.argv[1];
    let buf = "";
    process.stdin.on("data", d => buf += d);
    process.stdin.on("end", () => {
      for (const raw of buf.split(/\r?\n/)) {
        const line = raw.trim();
        if (!line.startsWith("│")) continue;
        const cols = line.replace(/^│/, "").replace(/│$/, "").split("│").map(s => s.trim()).filter(s => s !== "");
        if (cols.length < 2) continue;
        // 不假设列顺序：uuid 可能是第 1 列也可能是第 2 列，
        // 因此在所有列里找 uuid，再在剩余列里找库名。
        const idMatch = cols.map(c => c.match(pattern)).find(Boolean);
        if (!idMatch) continue;
        const name = cols.find(c => c !== idMatch[0]);
        // 精确相等，避免 myblog 匹配到 myblog-staging
        if (name !== target) continue;
        console.log(idMatch[0]);
        return;
      }
    });
  ' "$DB_NAME"
}

log "查找 D1 数据库：$DB_NAME"
DB_ID="$(find_existing_id || true)"

if [ -n "$DB_ID" ]; then
  log "已存在，复用：$DB_ID"
else
  log "不存在，创建中…"
  CREATE_OUTPUT="$(npx wrangler d1 create "$DB_NAME" 2>&1)" || {
    log "创建失败："
    echo "$CREATE_OUTPUT" >&2
    exit 1
  }
  log "$CREATE_OUTPUT"
  DB_ID="$(echo "$CREATE_OUTPUT" | grep -oE "$UUID_PATTERN" | head -1 || true)"
fi

if [ -z "$DB_ID" ]; then
  log "错误：未能提取到 D1 database_id"
  log "请到 Cloudflare 控制台 → Workers & Pages → D1 查看 ID，手动填入 wrangler.jsonc"
  exit 1
fi

# 校验格式，防止提取到错误内容
if ! echo "$DB_ID" | grep -qE "^${UUID_PATTERN}$"; then
  log "错误：提取到的 ID 格式不合法：$DB_ID"
  exit 1
fi

log "database_id=$DB_ID"
echo "$DB_ID"
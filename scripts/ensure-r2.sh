#!/usr/bin/env bash
#
# 确保 R2 存储桶存在（幂等）。
#
# 修复记录：
#   原实现用「表格边框 │」切分 `wrangler r2 bucket list` 的输出，
#   但该命令实际输出的是 `name:  <bucket>` 这种键值文本，并不存在表格边框，
#   导致永远匹配不到目标桶 → 每次都去创建 → 桶已存在时 wrangler 报错 → 部署中止。
#
# 兼容性考虑：
#   wrangler 不同版本的输出格式不一致，这里同时兼容两种形态：
#     1) 键值文本： "name:           myblog-media"
#     2) 表格文本： "│ myblog-media │ 2026-... │"
#   只要任一形态能提取到精确匹配的桶名即视为已存在。

set -euo pipefail

BUCKET="${1:-myblog-media}"

log() { echo "$*" >&2; }

# 精确匹配桶名，避免 myblog-media-staging 之类的前缀相近名称被误判为已存在。
# 这里做整行/整字段的精确比较，不做子串匹配。
bucket_exists() {
  npx wrangler r2 bucket list 2>/dev/null | node -e '
    const target = process.argv[1];
    let buf = "";
    process.stdin.on("data", d => buf += d);
    process.stdin.on("end", () => {
      for (const raw of buf.split(/\r?\n/)) {
        const line = raw.trim();
        if (!line) continue;
        let name = null;

        // 形态 1：键值文本 "name:           myblog-media"
        const kv = /^name:\s*(.+)$/.exec(line);
        if (kv) {
          name = kv[1].trim();
        } else if (line.startsWith("│")) {
          // 形态 2：表格文本 "│ myblog-media │ ... │"
          const cols = line.replace(/^│/, "").replace(/│$/, "").split("│").map(s => s.trim());
          if (cols.length) name = cols[0];
        }

        if (name !== null && name === target) {
          console.log("FOUND");
          return;
        }
      }
    });
  ' "$BUCKET"
}

log "检查 R2 存储桶：$BUCKET"

# 注意：这里不能用 `if bucket_exists | grep -q FOUND`。
# grep -q 命中后会立刻关闭管道，导致上游 node 收到 SIGPIPE 并以非零码退出；
# 在 `set -o pipefail` 下这会让整个管道返回失败，从而把「桶已存在」误判为「不存在」。
# 因此改为把结果收进变量里再用 case 判断。
EXISTS="$(bucket_exists || true)"

if [ "$EXISTS" = "FOUND" ]; then
  log "R2 桶 $BUCKET 已存在，跳过创建"
else
  log "创建 R2 桶 $BUCKET…"
  # 桶可能在此期间被并发创建，create 报错时复查一次再决定是否失败
  if ! npx wrangler r2 bucket create "$BUCKET"; then
    RETRY="$(bucket_exists || true)"
    if [ "$RETRY" = "FOUND" ]; then
      log "创建返回失败但桶已存在（并发创建），继续"
    else
      log "错误：创建 R2 桶 $BUCKET 失败"
      exit 1
    fi
  fi
  log "R2 桶 $BUCKET 就绪"
fi
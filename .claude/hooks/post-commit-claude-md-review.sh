#!/usr/bin/env bash
#
# Claude Code PostToolUse(Bash) hook — CLAUDE.md 維護提醒
#
# 每當一次 `git commit` 真的讓 HEAD 前進，就要求 Claude 依
# .claude/rules/claude-md-review.md 檢查 CLAUDE.md 是否需要更新。
#
# 兩個實作上必須這樣做的理由（已對照官方文件 code.claude.com/docs/en/hooks）：
#   1. PostToolUse 在 exit 0 時的 stdout 只會進 debug log，Claude 看不到。
#      要讓 Claude 收到指示，唯一途徑是輸出
#      {"hookSpecificOutput":{"hookEventName":"PostToolUse","additionalContext":...}}
#   2. hook 拿不到「commit 前的 HEAD」，所以用 .git/claude-md-review-state 記住
#      上次審查過的 commit。HEAD 沒變（例如 commit 失敗、或同一 commit 又跑了
#      別的 git 指令）就不重複觸發。
#
set -uo pipefail

payload=$(cat)

# 便宜的前置過濾：絕大多數 Bash 呼叫跟 commit 無關，直接退出。
case "$payload" in
  *"git commit"*) ;;
  *) exit 0 ;;
esac

command -v python3 >/dev/null 2>&1 || exit 0

cmd=$(printf '%s' "$payload" | python3 -c '
import json, sys
try:
    print(json.load(sys.stdin).get("tool_input", {}).get("command", ""))
except Exception:
    pass
' 2>/dev/null) || exit 0

# 確認 "git commit" 出現在指令本身，而不是只出現在 payload 的其他欄位。
case "$cmd" in
  *"git commit"*) ;;
  *) exit 0 ;;
esac
# --dry-run / --help 不會產生 commit。
case "$cmd" in
  *--dry-run*|*" -h"*|*--help*) exit 0 ;;
esac

repo=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0
head=$(git -C "$repo" rev-parse HEAD 2>/dev/null) || exit 0

state="$repo/.git/claude-md-review-state"
if [ -f "$state" ] && [ "$(cat "$state" 2>/dev/null)" = "$head" ]; then
  exit 0
fi
printf '%s' "$head" > "$state"

subject=$(git -C "$repo" log -1 --pretty=%s 2>/dev/null)
files=$(git -C "$repo" show --name-only --pretty=format: HEAD 2>/dev/null \
  | sed '/^$/d' | head -40)

python3 - "$subject" "$files" <<'PY'
import json
import sys

subject = sys.argv[1] if len(sys.argv) > 1 else ""
files = sys.argv[2] if len(sys.argv) > 2 else ""

message = f"""Commit 已落地：{subject}

異動檔案：
{files or "(無法取得檔案清單)"}

現在依 `.claude/rules/claude-md-review.md` 判斷這次 commit 有沒有產生
「應該寫進 CLAUDE.md 的長期知識」。

- 有 → 直接改 CLAUDE.md，並在回覆裡告訴使用者改了哪一條、為什麼。
- 沒有 → 回一句「CLAUDE.md 無需更新」即可。

不要為了交差硬塞內容；CLAUDE.md 每多一行，之後每個 session 都要付代價。"""

print(json.dumps({
    "hookSpecificOutput": {
        "hookEventName": "PostToolUse",
        "additionalContext": message,
    }
}, ensure_ascii=False))
PY

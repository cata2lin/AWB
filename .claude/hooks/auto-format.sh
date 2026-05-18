#!/usr/bin/env bash
# Auto-format hook — runs after every Write/Edit.
# - .jsx/.js under frontend/  → npx eslint --fix
# - .py under backend/        → ruff format (preferred) or black (fallback)
# Silently skips anything else, and silently exits 0 on any tool error so the
# user's edit is never blocked by formatter issues.
#
# Uses python (not jq) to parse the stdin JSON — jq is not always installed
# on dev machines but python is required by this project anyway.

set -uo pipefail

input=$(cat)
file=$(printf '%s' "$input" | python -c "
import json, sys
try:
    d = json.load(sys.stdin)
    print(d.get('tool_response', {}).get('filePath') or d.get('tool_input', {}).get('file_path') or '')
except Exception:
    print('')
" 2>/dev/null)

[ -z "$file" ] && exit 0
[ ! -f "$file" ] && exit 0

# Resolve repo root from this script's location (.claude/hooks/ → repo root).
script_dir="$(cd "$(dirname "$0")" && pwd)"
repo_root="$(cd "$script_dir/../.." && pwd)"

case "$file" in
  *.jsx|*.js)
    case "$file" in
      *"/frontend/"*)
        (cd "$repo_root/frontend" && npx --no-install eslint --fix "$file") >/dev/null 2>&1
        ;;
    esac
    ;;
  *.py)
    case "$file" in
      *"/backend/"*)
        # Try venv first (this project's installed formatters), then system PATH.
        venv_ruff="$repo_root/backend/venv/Scripts/ruff.exe"
        venv_black="$repo_root/backend/venv/Scripts/black.exe"
        if [ -x "$venv_ruff" ]; then
          "$venv_ruff" format "$file" >/dev/null 2>&1
        elif command -v ruff >/dev/null 2>&1; then
          ruff format "$file" >/dev/null 2>&1
        elif [ -x "$venv_black" ]; then
          "$venv_black" "$file" >/dev/null 2>&1
        elif command -v black >/dev/null 2>&1; then
          black "$file" >/dev/null 2>&1
        fi
        ;;
    esac
    ;;
esac

exit 0

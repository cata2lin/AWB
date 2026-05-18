#!/usr/bin/env bash
# safety-rails.sh — PreToolUse guard that runs even in bypassPermissions mode.
#
# Static `permissions.deny` rules in settings.json catch the simple prefix
# patterns. This hook catches what static patterns can't: flags appearing
# *anywhere* in a command (e.g., `git push origin main --force` — the
# `--force` is at the end, not a prefix).
#
# How the protocol works:
# - Exit 0 with empty stdout  → no opinion, default behavior applies
# - Exit 0 with JSON stdout containing hookSpecificOutput.permissionDecision
#   set to "deny" → tool call blocked, reason shown to user and model
#
# We *only* block. We never auto-allow — that's what bypassPermissions does
# on its own. This hook is a one-way veto.

set -uo pipefail
input=$(cat)

# Parse tool + relevant payload via python (jq isn't always installed).
parsed=$(printf '%s' "$input" | python -c "
import json, sys
try:
    d = json.load(sys.stdin)
    tool = d.get('tool_name', '')
    tin = d.get('tool_input', {}) or {}
    if tool == 'Bash':
        print('Bash')
        print(tin.get('command', ''))
    elif tool in ('Edit', 'Write'):
        print(tool)
        print(tin.get('file_path', ''))
    else:
        print('')
        print('')
except Exception:
    print('')
    print('')
" 2>/dev/null)

tool=$(printf '%s\n' "$parsed" | sed -n '1p')
target=$(printf '%s\n' "$parsed" | sed -n '2,$p')

# Helper: emit a deny verdict + audit line, then exit cleanly.
deny() {
    reason="$1"
    # Audit trail (gitignored)
    audit_dir="$(cd "$(dirname "$0")/../.." && pwd)/.claude"
    mkdir -p "$audit_dir" 2>/dev/null
    printf '[%s] BLOCKED tool=%s reason=%s target=%s\n' \
        "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" "$tool" "$reason" "$target" \
        >> "$audit_dir/safety-rails.log" 2>/dev/null
    # JSON verdict to Claude Code
    python -c "
import json
print(json.dumps({
    'hookSpecificOutput': {
        'hookEventName': 'PreToolUse',
        'permissionDecision': 'deny',
        'permissionDecisionReason': '''$reason''',
    }
}))
"
    exit 0
}

case "$tool" in
    Bash)
        cmd="$target"

        # ── Force-push protection ────────────────────────────────────────────
        # Block force-push to protected branches regardless of flag position.
        if echo "$cmd" | grep -qE '\bgit\s+push\b' && \
           echo "$cmd" | grep -qE '(-f\b|--force\b|--force-with-lease)' && \
           echo "$cmd" | grep -qE '\b(main|master|production|prod|release)\b'; then
            deny "force-push to a protected branch — blocked by safety-rails. Push to a feature branch and open a PR instead."
        fi

        # ── Hard reset against remote refs ───────────────────────────────────
        if echo "$cmd" | grep -qE 'git\s+reset\s+--hard\s+(origin|upstream)/'; then
            deny "git reset --hard against a remote ref destroys local commits irreversibly — blocked by safety-rails. Use 'git reset --soft' or a new branch."
        fi

        # ── Deletion of main/master/release branches ─────────────────────────
        if echo "$cmd" | grep -qE 'git\s+branch\s+-D\s+(main|master|release)\b'; then
            deny "deleting main/master/release branch — blocked by safety-rails."
        fi

        # ── Catastrophic filesystem deletes ──────────────────────────────────
        # Match: rm -rf / | rm -rf ~ | rm -rf \$HOME | rm -rf /* | rm -rf ~/*
        # Also: variants with multiple flags (rm -fr, rm -r -f, etc.).
        if echo "$cmd" | grep -qE 'rm\s+(-[a-z]*r[a-z]*f[a-z]*|-[a-z]*f[a-z]*r[a-z]*)\s+(/|\~|\$HOME|/\*|\~/\*|\$HOME/\*)(\s|$|;|&)'; then
            deny "rm -rf of root, home, or wildcarded top-level — blocked by safety-rails. Be more specific about what to delete."
        fi

        # ── Production database connections ──────────────────────────────────
        # Production DB host per docs/DB_Reference.md.
        if echo "$cmd" | grep -qE '38\.242\.226\.83'; then
            deny "connection to production DB (38.242.226.83) — blocked by safety-rails. Use the local DB on localhost:5432 for development."
        fi

        # ── Mass dependency removal ──────────────────────────────────────────
        # Block uninstalling core framework deps that the project depends on.
        if echo "$cmd" | grep -qE '(pip|npm|yarn|pnpm)\s+(uninstall|remove)\s+.*\b(fastapi|sqlalchemy|react|react-dom|vite|sonner|pydantic|uvicorn|tailwindcss)\b'; then
            deny "uninstalling a core framework dep — blocked by safety-rails. If this is intentional, run it manually."
        fi

        # ── Git config tampering ─────────────────────────────────────────────
        # Don't let me change user identity or credential storage.
        if echo "$cmd" | grep -qE 'git\s+config\s+(--global\s+)?(user\.|credential\.|core\.hooksPath)'; then
            deny "modifying git user/credential/hooks config — blocked by safety-rails. Change it yourself if intentional."
        fi
        ;;

    Edit|Write)
        path="$target"

        # ── .env / secrets ──────────────────────────────────────────────────
        case "$path" in
            *.env|*.env.*|*/.env|*/.env.*|*/credentials*.json|*credentials.json|*.pem|*.key|*/.npmrc|*/.pypirc)
                deny "writing to a secrets/credentials file ($path) — blocked by safety-rails. Edit it yourself if intentional."
                ;;
        esac

        # ── CI/deploy infrastructure ────────────────────────────────────────
        # Changes here affect prod deploys; should be a deliberate human edit.
        case "$path" in
            .github/workflows/*|*/.github/workflows/*)
                deny "editing a GitHub Actions workflow ($path) — blocked by safety-rails. CI changes deserve a deliberate human review."
                ;;
        esac

        # ── settings.json itself ────────────────────────────────────────────
        # Claude Code already gates this, but reinforce. Future-me must explicitly
        # ask the user for permission to change the agent's own boundary.
        case "$path" in
            */.claude/settings.json|.claude/settings.json)
                deny "editing .claude/settings.json — blocked by safety-rails. Ask the user explicitly before changing the agent's own permission boundary."
                ;;
        esac
        ;;
esac

# No matches → no opinion, let Claude Code's default behavior decide.
exit 0

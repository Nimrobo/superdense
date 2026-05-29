#!/bin/bash
# Outputs a <past_sessions> block for the current working directory.
# Called by Claude shell injection or by Codex after reading the chain skill.

set -euo pipefail

cwd="$PWD"

exclude_ids=()
[ -n "${CODEX_THREAD_ID:-}" ] && exclude_ids+=("codex:$CODEX_THREAD_ID")
[ -n "${CLAUDE_CODE_SESSION_ID:-}" ] && exclude_ids+=("claude-code:$CLAUDE_CODE_SESSION_ID")
[ -n "${CLAUDE_CODE_REMOTE_SESSION_ID:-}" ] && exclude_ids+=("claude-code:$CLAUDE_CODE_REMOTE_SESSION_ID")
[ -n "${SUPERDENSE_CURRENT_SESSION_ID:-}" ] && exclude_ids+=("$SUPERDENSE_CURRENT_SESSION_ID")
if [ -n "${SUPERDENSE_EXCLUDE_SESSION_IDS:-}" ]; then
  IFS=',' read -r -a extra_exclude_ids <<< "$SUPERDENSE_EXCLUDE_SESSION_IDS"
  for id in "${extra_exclude_ids[@]}"; do
    [ -n "$id" ] && exclude_ids+=("$id")
  done
fi

exclude_json=$(printf '%s\n' "${exclude_ids[@]}" | jq -R 'select(length > 0)' | jq -s '.')

fetch_sessions() {
  superdense session list --pwd "$1" --limit 25 2>/dev/null || echo '{"items":[],"total":0}'
}

filter_sessions() {
  jq \
    --argjson excludeIds "$exclude_json" \
    '
      .items = [
        (.items // [])[]
        | . as $session
        | select(($excludeIds | index($session.id // "")) | not)
      ][:3]
      | .total = (.items | length)
    '
}

superdense index 2>/dev/null || true
raw_sessions_json=$(fetch_sessions "$cwd")
sessions_json=$(echo "$raw_sessions_json" | filter_sessions)
count=$(echo "$sessions_json" | jq '.items | length')

echo '<past_sessions>'

if [ "$count" -eq 0 ]; then
  echo "No sessions found for workspace: $cwd"
else
  id0=$(echo "$sessions_json" | jq -r '.items[0].id // ""')
  id1=$(echo "$sessions_json" | jq -r '.items[1].id // ""')
  id2=$(echo "$sessions_json" | jq -r '.items[2].id // ""')

  echo "(most recent) session #1 : $id0"
  [ -n "$id1" ] && echo "session #2 : $id1"
  [ -n "$id2" ] && echo "session #3 : $id2"
  echo ""
  echo "To get session details:"
  echo "  superdense compactor run salience $id0"
fi

echo '</past_sessions>'

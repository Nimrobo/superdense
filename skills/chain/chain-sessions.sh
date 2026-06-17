#!/bin/bash
# Outputs a <past_sessions> block for the current working directory.
# Called by Claude shell injection or by Codex after reading the chain skill.

set -euo pipefail

cwd="$PWD"
index_timeout_seconds="${SUPERDENSE_CHAIN_INDEX_TIMEOUT_SECONDS:-8}"
list_timeout_seconds="${SUPERDENSE_CHAIN_LIST_TIMEOUT_SECONDS:-4}"
context_unavailable=0

run_with_timeout() {
  local seconds="$1"
  shift

  if command -v timeout >/dev/null 2>&1; then
    timeout "$seconds" "$@"
  elif command -v gtimeout >/dev/null 2>&1; then
    gtimeout "$seconds" "$@"
  else
    perl -e 'my $seconds = shift @ARGV; alarm $seconds; exec @ARGV; exit 127' "$seconds" "$@"
  fi
}

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
  run_with_timeout "$list_timeout_seconds" superdense session list --pwd "$1" --limit 25 2>/dev/null
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

if ! run_with_timeout "$index_timeout_seconds" superdense index >/dev/null 2>&1; then
  context_unavailable=1
fi

raw_sessions_json=""
if ! raw_sessions_json=$(fetch_sessions "$cwd"); then
  context_unavailable=1
fi

if [ -z "$raw_sessions_json" ]; then
  context_unavailable=1
fi

if [ "$context_unavailable" -eq 1 ]; then
  echo '<past_sessions>'
  echo "Session context unavailable for workspace: $cwd (index/list blocked, timed out, or sandboxed)"
  echo '</past_sessions>'
  exit 0
fi

if ! sessions_json=$(echo "$raw_sessions_json" | filter_sessions); then
  echo '<past_sessions>'
  echo "Session context unavailable for workspace: $cwd (index/list blocked, timed out, or sandboxed)"
  echo '</past_sessions>'
  exit 0
fi

if ! count=$(echo "$sessions_json" | jq '.items | length'); then
  echo '<past_sessions>'
  echo "Session context unavailable for workspace: $cwd (index/list blocked, timed out, or sandboxed)"
  echo '</past_sessions>'
  exit 0
fi

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

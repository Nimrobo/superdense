#!/bin/bash
# Outputs a <past_sessions> block for the current working directory.
# Called by Claude shell injection or by Codex after reading the chain skill.

set -euo pipefail

cwd="$PWD"

fetch_sessions() {
  superdense session list --pwd "$1" --limit 3 2>/dev/null || echo '{"items":[],"total":0}'
}

sessions_json=$(fetch_sessions "$cwd")
count=$(echo "$sessions_json" | jq '.items | length')

# Auto-index on fresh worktree (no sessions yet), then retry once
if [ "$count" -eq 0 ]; then
  superdense index 2>/dev/null || true
  sessions_json=$(fetch_sessions "$cwd")
  count=$(echo "$sessions_json" | jq '.items | length')
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

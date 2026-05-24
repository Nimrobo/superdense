#!/usr/bin/env bash
# Shared helpers for scenario scripts.
# Each scenario sources this and gets:
#   - a fresh HOME under /tmp
#   - SUPERDENSE_HOME pointing inside it
#   - adapter directories empty by default
#   - assert helpers
set -uo pipefail

# shellcheck disable=SC2034
SCENARIO_DIR="$(cd "$(dirname "${BASH_SOURCE[1]}")" && pwd)"
FIXTURES="/work/fixtures"

new_home() {
  local dir
  dir="$(mktemp -d)"
  export HOME="$dir"
  export SUPERDENSE_HOME="$dir/.superdense"
  # Point adapter env overrides at locations that don't exist yet so the
  # discoverers cleanly find nothing unless the scenario seeds them.
  export CLAUDE_PROJECTS_DIR="$dir/.claude/projects"
  export CODEX_STATE_DB="$dir/.codex/state_5.sqlite"
  export OPENCODE_DB="$dir/.opencode/opencode.db"
  export CLAUDE_SKILLS_DIR="$dir/.claude/skills"
  export CODEX_SKILLS_DIR="$dir/.codex/skills"
  echo "$dir"
}

failures=0
expect() {
  local desc="$1"; shift
  if "$@"; then
    echo "  ok   $desc"
  else
    echo "  FAIL $desc"
    failures=$((failures + 1))
  fi
}

expect_eq() {
  local desc="$1" expected="$2" actual="$3"
  if [ "$expected" = "$actual" ]; then
    echo "  ok   $desc"
  else
    echo "  FAIL $desc (expected '$expected', got '$actual')"
    failures=$((failures + 1))
  fi
}

finish() {
  if [ "$failures" -gt 0 ]; then
    echo "  -> $failures assertion(s) failed"
    exit 1
  fi
  exit 0
}

# Seed a Claude Code project dir with a single synthetic JSONL transcript.
# Args: project_name session_id cwd first_prompt
seed_claude_session() {
  local project="$1" sid="$2" cwd="$3" prompt="$4"
  local dir="$CLAUDE_PROJECTS_DIR/$project"
  mkdir -p "$dir"
  local jsonl="$dir/$sid.jsonl"
  # Two lines: a user message (so firstPrompt extraction works) and an
  # assistant reply. cwd is embedded on the first line as Claude Code does.
  jq -c -n --arg cwd "$cwd" --arg prompt "$prompt" '{type:"user",cwd:$cwd,timestamp:"2026-05-01T10:00:00Z",message:{role:"user",content:$prompt}}' > "$jsonl"
  jq -c -n '{type:"assistant",timestamp:"2026-05-01T10:00:05Z",message:{role:"assistant",content:[{type:"text",text:"ok"}]}}' >> "$jsonl"
}

# Seed a Codex SQLite DB with one thread row pointing at a synthetic rollout
# JSONL. Args: session_id cwd first_prompt
seed_codex_session() {
  local sid="$1" cwd="$2" prompt="$3"
  mkdir -p "$(dirname "$CODEX_STATE_DB")"
  local rollout="$HOME/.codex/rollouts/$sid.jsonl"
  mkdir -p "$(dirname "$rollout")"
  jq -c -n --arg prompt "$prompt" '{type:"response_item",timestamp:"2026-05-01T10:00:00Z",payload:{type:"message",role:"user",content:[{type:"input_text",text:$prompt}]}}' > "$rollout"
  jq -c -n '{type:"response_item",timestamp:"2026-05-01T10:00:05Z",payload:{type:"message",role:"assistant",content:[{type:"output_text",text:"ok"}]}}' >> "$rollout"
  sqlite3 "$CODEX_STATE_DB" <<SQL
CREATE TABLE IF NOT EXISTS threads (
  id TEXT PRIMARY KEY,
  rollout_path TEXT,
  cwd TEXT,
  first_user_message TEXT,
  git_branch TEXT,
  created_at INTEGER,
  updated_at INTEGER,
  created_at_ms INTEGER,
  updated_at_ms INTEGER
);
INSERT INTO threads (id, rollout_path, cwd, first_user_message, git_branch, created_at_ms, updated_at_ms)
VALUES ('$sid', '$rollout', '$cwd', '$prompt', 'main', 1714557600000, 1714557605000);
SQL
}

# Seed an OpenCode SQLite DB with one session + one user message.
# Args: session_id cwd title prompt
seed_opencode_session() {
  local sid="$1" cwd="$2" title="$3" prompt="$4"
  mkdir -p "$(dirname "$OPENCODE_DB")"
  sqlite3 "$OPENCODE_DB" <<SQL
CREATE TABLE IF NOT EXISTS session (
  id TEXT PRIMARY KEY,
  directory TEXT,
  title TEXT,
  time_created INTEGER,
  time_updated INTEGER,
  parent_id TEXT
);
CREATE TABLE IF NOT EXISTS message (
  id TEXT PRIMARY KEY,
  session_id TEXT,
  time_created INTEGER,
  data TEXT
);
CREATE TABLE IF NOT EXISTS part (
  id TEXT PRIMARY KEY,
  message_id TEXT,
  time_created INTEGER,
  data TEXT
);
INSERT INTO session VALUES ('$sid', '$cwd', '$title', 1714557600000, 1714557605000, NULL);
INSERT INTO message VALUES ('m1', '$sid', 1714557600000, '{"role":"user"}');
INSERT INTO part VALUES ('p1', 'm1', 1714557600000, '{"type":"text","text":"$prompt"}');
SQL
}

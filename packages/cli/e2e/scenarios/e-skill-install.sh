#!/usr/bin/env bash
# E. Skill install — catches skill-asset regressions.
source "$(dirname "$0")/_common.sh"
new_home >/dev/null

# 15. Global install writes bundled skills to both Claude and Codex skill roots.
out="$(superdense skill install 2>&1)"; rc=$?
expect_eq "skill install exit code" "0" "$rc"
expect "skill install reports installed entries" bash -c "echo '$out' | jq -e '.installed | length >= 2' >/dev/null"

claude_skill="$CLAUDE_SKILLS_DIR/superdense/SKILL.md"
codex_skill="$CODEX_SKILLS_DIR/superdense/SKILL.md"
expect "Claude SKILL.md present" test -f "$claude_skill"
expect "Codex SKILL.md present" test -f "$codex_skill"
expect "Claude install marker present" test -f "$CLAUDE_SKILLS_DIR/superdense/.superdense-install.json"
expect "Codex install marker present" test -f "$CODEX_SKILLS_DIR/superdense/.superdense-install.json"
expect "Claude chain SKILL.md present" test -f "$CLAUDE_SKILLS_DIR/chain/SKILL.md"
expect "Codex chain SKILL.md present" test -f "$CODEX_SKILLS_DIR/chain/SKILL.md"
expect "Claude chain script present" test -f "$CLAUDE_SKILLS_DIR/chain/chain-sessions.sh"
expect "Codex chain script present" test -f "$CODEX_SKILLS_DIR/chain/chain-sessions.sh"
expect "Claude chain uses shell injection" grep -q '!`bash ~/.claude/skills/chain/chain-sessions.sh`' "$CLAUDE_SKILLS_DIR/chain/SKILL.md"
expect "Codex chain uses Codex script path" grep -q 'bash ~/.codex/skills/chain/chain-sessions.sh' "$CODEX_SKILLS_DIR/chain/SKILL.md"

# Marker scope should be "global"
expect_eq "global marker scope" "global" "$(jq -r '.scope' "$CLAUDE_SKILLS_DIR/superdense/.superdense-install.json")"
expect_eq "chain global marker scope" "global" "$(jq -r '.scope' "$CLAUDE_SKILLS_DIR/chain/.superdense-install.json")"

# 16. Re-install is idempotent.
out2="$(superdense skill install 2>&1)"; rc=$?
expect_eq "skill install repeat exit code" "0" "$rc"

# 17. --locally writes under cwd
work_cwd="$(mktemp -d)"
( cd "$work_cwd" && superdense skill install --locally >/dev/null )
expect "local Claude SKILL.md present" test -f "$work_cwd/.claude/skills/superdense/SKILL.md"
expect "local Codex SKILL.md present" test -f "$work_cwd/.codex/skills/superdense/SKILL.md"
expect "local Claude chain SKILL.md present" test -f "$work_cwd/.claude/skills/chain/SKILL.md"
expect "local Codex chain SKILL.md present" test -f "$work_cwd/.codex/skills/chain/SKILL.md"
expect_eq "local marker scope" "local" "$(jq -r '.scope' "$work_cwd/.claude/skills/superdense/.superdense-install.json")"
expect_eq "local chain marker scope" "local" "$(jq -r '.scope' "$work_cwd/.claude/skills/chain/.superdense-install.json")"

finish

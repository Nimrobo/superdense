#!/usr/bin/env bash
# E. Skill install — catches skill-asset regressions.
source "$(dirname "$0")/_common.sh"
new_home >/dev/null

# 15. Global install writes to both Claude and Codex skill roots.
out="$(road42 skill install road42 2>&1)"; rc=$?
expect_eq "skill install exit code" "0" "$rc"
expect "skill install reports installed entry" bash -c "echo '$out' | jq -e '.installed | length >= 1' >/dev/null"

claude_skill="$CLAUDE_SKILLS_DIR/road42/SKILL.md"
codex_skill="$CODEX_SKILLS_DIR/road42/SKILL.md"
expect "Claude SKILL.md present" test -f "$claude_skill"
expect "Codex SKILL.md present" test -f "$codex_skill"
expect "Claude install marker present" test -f "$CLAUDE_SKILLS_DIR/road42/.road42-install.json"
expect "Codex install marker present" test -f "$CODEX_SKILLS_DIR/road42/.road42-install.json"

# Marker scope should be "global"
expect_eq "global marker scope" "global" "$(jq -r '.scope' "$CLAUDE_SKILLS_DIR/road42/.road42-install.json")"

# 16. Re-install is idempotent.
out2="$(road42 skill install road42 2>&1)"; rc=$?
expect_eq "skill install repeat exit code" "0" "$rc"

# 17. --locally writes under cwd
work_cwd="$(mktemp -d)"
( cd "$work_cwd" && road42 skill install road42 --locally >/dev/null )
expect "local Claude SKILL.md present" test -f "$work_cwd/.claude/skills/road42/SKILL.md"
expect "local Codex SKILL.md present" test -f "$work_cwd/.codex/skills/road42/SKILL.md"
expect_eq "local marker scope" "local" "$(jq -r '.scope' "$work_cwd/.claude/skills/road42/.road42-install.json")"

finish

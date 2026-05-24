#!/usr/bin/env bash
# B. Adapter discovery — catches adapter path regressions.
source "$(dirname "$0")/_common.sh"
new_home >/dev/null

# 8 (first): no adapters — discover exits cleanly with zero sessions
out="$(superdense discover 2>&1)"; rc=$?
expect_eq "discover with no adapters exits 0" "0" "$rc"
expect "discover reports 0 sessions on empty home" bash -c "echo '$out' | grep -q 'discovered 0 sessions'"

# 5. Claude Code adapter
seed_claude_session "my-proj" "claude-sess-1" "/tmp/myrepo" "fix the login bug"
superdense discover >/dev/null
superdense index >/dev/null
list="$(superdense session list --agent claude-code 2>&1)"
total="$(echo "$list" | jq -r '.total')"
expect "claude-code session discovered" test "$total" -ge 1
first_prompt="$(echo "$list" | jq -r '.items[0].firstPrompt')"
expect_eq "claude-code firstPrompt extracted" "fix the login bug" "$first_prompt"
pwd_val="$(echo "$list" | jq -r '.items[0].pwd')"
expect_eq "claude-code pwd extracted from cwd field" "/tmp/myrepo" "$pwd_val"

# 6. Codex adapter
seed_codex_session "codex-sess-1" "/tmp/codex-repo" "refactor the api client"
superdense discover >/dev/null
superdense index >/dev/null
clist="$(superdense session list --agent codex 2>&1)"
ctot="$(echo "$clist" | jq -r '.total')"
expect "codex session discovered" test "$ctot" -ge 1
expect_eq "codex firstPrompt extracted" "refactor the api client" "$(echo "$clist" | jq -r '.items[0].firstPrompt')"
expect_eq "codex pwd" "/tmp/codex-repo" "$(echo "$clist" | jq -r '.items[0].pwd')"

# 7. OpenCode adapter
seed_opencode_session "oc-sess-1" "/tmp/oc-repo" "OC session" "explore docker setup"
superdense discover >/dev/null
superdense index >/dev/null
olist="$(superdense session list --agent opencode 2>&1)"
otot="$(echo "$olist" | jq -r '.total')"
expect "opencode session discovered" test "$otot" -ge 1
expect_eq "opencode firstPrompt extracted" "explore docker setup" "$(echo "$olist" | jq -r '.items[0].firstPrompt')"
expect_eq "opencode pwd" "/tmp/oc-repo" "$(echo "$olist" | jq -r '.items[0].pwd')"

finish

#!/usr/bin/env bash
# C. Query + compactor surface — catches core/CLI wiring + bundled assets.
source "$(dirname "$0")/_common.sh"
new_home >/dev/null

seed_claude_session "p" "sess-q-1" "/tmp/qrepo" "investigate flaky test"
superdense discover >/dev/null
superdense index >/dev/null

# 9. Ad hoc query
adhoc="$(superdense query --query '{"filters":{"filter":{"name":"session","params":{}}}}' 2>&1)"; rc=$?
expect_eq "ad hoc query exit code" "0" "$rc"
matched="$(echo "$adhoc" | jq -r '.matched')"
expect "ad hoc query matched >=1" test "$matched" -ge 1

# 10. Saved query lifecycle
saved="$(superdense saved-query save --name e2e-q --query '{"filters":{"filter":{"name":"session","params":{}}}}' 2>&1)"; rc=$?
expect_eq "saved-query save exit code" "0" "$rc"
qid="$(echo "$saved" | jq -r '.id')"
expect "saved query has id" test -n "$qid" -a "$qid" != "null"

list_json="$(superdense saved-query list 2>&1)"
expect "saved-query list contains new query" bash -c "echo '$list_json' | jq -e '.items | map(.id) | index(\"$qid\")' >/dev/null"

run_out="$(superdense saved-query run "$qid" 2>&1)"; rc=$?
expect_eq "saved-query run exit code" "0" "$rc"
expect "saved-query run returns matched>=1" test "$(echo "$run_out" | jq -r '.matched')" -ge 1

del="$(superdense saved-query delete "$qid" 2>&1)"; rc=$?
expect_eq "saved-query delete exit code" "0" "$rc"
expect_eq "saved-query delete returns ok" "true" "$(echo "$del" | jq -r '.ok')"

# 11. Compactor — first confirm salience is registered, then run it
clist="$(superdense compactor list 2>&1)"
expect "compactor list includes salience" bash -c "echo '$clist' | jq -e '.items | map(.name) | index(\"salience\")' >/dev/null"

sid="$(superdense session list --agent claude-code 2>&1 | jq -r '.items[0].id')"
comp_out="$(superdense compactor run salience "$sid" 2>&1)"; rc=$?
expect_eq "compactor run salience exit code" "0" "$rc"
expect "compactor produced non-empty result" bash -c "echo '$comp_out' | jq -e '.result' >/dev/null"

# 12. Insights — validates dist/insights/ shipped
ilist="$(superdense insight list 2>&1)"
expect "insight list returns >=1 item" test "$(echo "$ilist" | jq '.items | length')" -ge 1
name="$(echo "$ilist" | jq -r '.items[0].name')"
prompt_out="$(superdense insight prompt "$name" 2>&1)"; rc=$?
expect_eq "insight prompt exit code" "0" "$rc"
expect "insight prompt non-empty" test "$(echo -n "$prompt_out" | wc -c)" -gt 100

finish

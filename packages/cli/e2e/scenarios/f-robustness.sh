#!/usr/bin/env bash
# F. Negative / robustness — catches "ugly error" regressions.
source "$(dirname "$0")/_common.sh"
new_home >/dev/null

# 18. Malformed JSONL — drop a broken line alongside a valid session.
seed_claude_session "p" "good-sess" "/tmp/r" "good prompt"
mkdir -p "$CLAUDE_PROJECTS_DIR/p"
printf 'not valid json\n{"oops":\n' > "$CLAUDE_PROJECTS_DIR/p/broken.jsonl"
superdense discover >/dev/null 2>&1
superdense index >/dev/null 2>&1
out="$(superdense session list 2>&1)"; rc=$?
expect_eq "session list still works with malformed JSONL" "0" "$rc"
expect "good session still discovered" test "$(echo "$out" | jq '[.items[] | select(.sessionId=="good-sess")] | length')" -ge 1

# 19. Corrupt index.db — write garbage, expect the CLI to fail with a clean
# JSON error rather than an unhandled stack trace.
echo "this is not a sqlite file" > "$SUPERDENSE_HOME/index.db"
err="$(superdense session list 2>&1 || true)"
# Either it recovered, or it failed with a structured error. Both are
# acceptable; what we forbid is an unhandled promise rejection / raw stack.
expect "no unhandled rejection on corrupt db" bash -c "! echo '$err' | grep -qi 'UnhandledPromiseRejection\\|UNHANDLED'"

# 20. Invalid --query JSON → exit code != 0 and a readable JSON error on stderr.
new_home >/dev/null
err2="$(superdense query --query 'not-json' 2>&1)"; rc=$?
expect "invalid --query JSON fails with non-zero exit" test "$rc" -ne 0
expect "invalid --query error is a JSON object" bash -c "echo '$err2' | jq -e '.error' >/dev/null"

# 21. Unknown command — non-zero exit, structured error
err3="$(superdense totally-not-a-command 2>&1)"; rc=$?
expect "unknown command exits non-zero" test "$rc" -ne 0
expect "unknown command error is structured" bash -c "echo '$err3' | jq -e '.error' >/dev/null"

finish

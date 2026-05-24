#!/usr/bin/env bash
# In-container test runner: executes each scenario script, prints PASS/FAIL,
# and exits non-zero if any failed.
set -uo pipefail

cd /work

fail_count=0
declare -a results

for s in scenarios/*.sh; do
  name="$(basename "$s" .sh)"
  case "$name" in _*) continue ;; esac
  echo "--- $name ---"
  if bash "$s"; then
    results+=("PASS  $name")
  else
    results+=("FAIL  $name")
    fail_count=$((fail_count + 1))
  fi
done

echo
echo "=== Summary ==="
for r in "${results[@]}"; do
  echo "$r"
done

exit $fail_count

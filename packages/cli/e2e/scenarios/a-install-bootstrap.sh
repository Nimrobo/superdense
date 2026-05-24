#!/usr/bin/env bash
# A. Install & bootstrap — catches packaging regressions.
source "$(dirname "$0")/_common.sh"
new_home >/dev/null

# 1. Binary resolves
which_road42="$(command -v road42 || true)"
expect "road42 on PATH" test -n "$which_road42"

# 2. --version prints package.json version, --help mentions studio
ver="$(road42 --version 2>/dev/null || true)"
# Our CLI doesn't take --version; instead rely on `help` to confirm it boots.
# But npm install registers the version via package.json; check via npm.
pkg_ver="$(npm ls -g --depth=0 --json 2>/dev/null | jq -r '.dependencies["@nimrobo/road42"].version // empty')"
expect "globally installed package has a version" test -n "$pkg_ver"

help_out="$(road42 help 2>&1)"
expect "help mentions studio" bash -c "echo '$help_out' | grep -q 'studio'"
expect "help mentions session list" bash -c "echo '$help_out' | grep -q 'session list'"

# 3. First-run on empty HOME — session list returns empty array, no crash
out="$(road42 session list 2>&1)"
rc=$?
expect_eq "session list exit code" "0" "$rc"
items_total="$(echo "$out" | jq -r '.total')"
expect_eq "session list total=0 on fresh home" "0" "$items_total"

# 4. ~/.road42/index.db was created (better-sqlite3 native module loaded)
expect "index.db created" test -f "$ROAD42_HOME/index.db"
expect "no NODE_MODULE_VERSION error in stderr" bash -c "! echo '$out' | grep -qi 'NODE_MODULE_VERSION\\|ERR_DLOPEN_FAILED'"

finish

#!/usr/bin/env bash
# D. Server + web bundle — catches embedded-asset regressions.
source "$(dirname "$0")/_common.sh"
new_home >/dev/null

# 13. studio boots and serves /api/stats + web HTML
log="$(mktemp)"
superdense studio --no-open --no-skill-check >"$log" 2>&1 &
pid=$!

# Wait up to 20s for the server to log the bound URL.
url=""
for _ in $(seq 1 40); do
  url="$(grep -oE 'http://127\.0\.0\.1:[0-9]+' "$log" | head -n1 || true)"
  [ -n "$url" ] && break
  sleep 0.5
done

cleanup() { kill "$pid" 2>/dev/null || true; wait "$pid" 2>/dev/null || true; }
trap cleanup EXIT

expect "studio bound to a URL" test -n "$url"

if [ -n "$url" ]; then
  stats="$(curl -sS -o /dev/null -w '%{http_code}' "$url/api/stats" || echo 000)"
  expect_eq "GET /api/stats returns 200" "200" "$stats"
  html="$(curl -sS "$url/" || true)"
  # web/dist serves index.html; assert it looks like the SPA shell
  expect "/ serves HTML containing a root mount point" bash -c "echo '$html' | grep -qiE '<div[^>]*id=\"?root\"?|<!doctype html'"
fi

cleanup
trap - EXIT

# 14. Port fallback — pre-bind 4242, start studio without explicit port,
# expect it to land on a different port (Fastify portFallbackAttempts=50).
hog_log="$(mktemp)"
( exec node -e "require('net').createServer().listen(4242,'127.0.0.1',()=>setTimeout(()=>{},30000))" ) >"$hog_log" 2>&1 &
hog_pid=$!
sleep 0.5

new_home >/dev/null
log2="$(mktemp)"
superdense studio --no-open --no-skill-check >"$log2" 2>&1 &
pid2=$!
url2=""
for _ in $(seq 1 40); do
  url2="$(grep -oE 'http://127\.0\.0\.1:[0-9]+' "$log2" | head -n1 || true)"
  [ -n "$url2" ] && break
  sleep 0.5
done
cleanup2() { kill "$pid2" 2>/dev/null || true; kill "$hog_pid" 2>/dev/null || true; wait "$pid2" "$hog_pid" 2>/dev/null || true; }
trap cleanup2 EXIT

expect "studio bound while 4242 was busy" test -n "$url2"
port2="$(echo "$url2" | sed -E 's@.*:@@')"
expect "studio fell back off port 4242" test "$port2" != "4242"

cleanup2
trap - EXIT

finish

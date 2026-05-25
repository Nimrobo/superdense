#!/usr/bin/env bash
# Host driver: pack the CLI with npm, build the Docker image, run the smoke suite.
# Run before `npm publish`. Not wired into CI on purpose — manual release gate.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$here/../../.." && pwd)"

cd "$repo_root"

pack_dir="$(mktemp -d)"
trap 'rm -rf "$pack_dir"' EXIT

echo "[e2e] Packing CLI with npm workspace release path..."
npm pack --workspace packages/cli --pack-destination "$pack_dir" >/dev/null
tgz="$(ls "$pack_dir"/*.tgz | head -n1)"
echo "[e2e] Packed: $(basename "$tgz")"

echo "[e2e] Verifying packed npm contents..."
contents="$pack_dir/contents.txt"
LC_ALL=C tar -tzf "$tgz" | sort > "$contents"

for required in \
  "package/package.json" \
  "package/README.md" \
  "package/LICENSE" \
  "package/dist/index.js" \
  "package/dist/web/index.html" \
  "package/dist/skills/superdense/SKILL.md" \
  "package/dist/insights/index.json"
do
  if ! grep -Fxq "$required" "$contents"; then
    echo "[e2e] Missing required packed file: $required" >&2
    exit 1
  fi
done

if grep -Eq '^package/(src/|scripts/|e2e/|tsconfig\.json|vitest\.config\.ts|.*__tests__/)' "$contents"; then
  echo "[e2e] Source/test/config files leaked into npm package:" >&2
  grep -E '^package/(src/|scripts/|e2e/|tsconfig\.json|vitest\.config\.ts|.*__tests__/)' "$contents" >&2
  exit 1
fi

cp "$tgz" "$here/superdense.tgz"
trap 'rm -rf "$pack_dir"; rm -f "$here/superdense.tgz"' EXIT

echo "[e2e] Building Docker image (superdense-e2e)..."
docker build -t superdense-e2e "$here" >/dev/null

echo "[e2e] Running suite..."
docker run --rm superdense-e2e
status=$?

if [ $status -eq 0 ]; then
  echo "[e2e] ALL SCENARIOS PASSED"
else
  echo "[e2e] FAILED (exit $status)"
fi
exit $status

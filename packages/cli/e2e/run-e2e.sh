#!/usr/bin/env bash
# Host driver: pack the CLI, build the Docker image, run the smoke suite.
# Run before `npm publish`. Not wired into CI on purpose — manual release gate.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cli_dir="$(cd "$here/.." && pwd)"
repo_root="$(cd "$cli_dir/../.." && pwd)"

cd "$repo_root"

echo "[e2e] Building CLI bundle (prepublishOnly pipeline)..."
pnpm --filter=@nimrobo/superdense-core --filter=@nimrobo/superdense-server --filter=@nimrobo/superdense-web run build >/dev/null
node "$cli_dir/scripts/build.mjs" >/dev/null

echo "[e2e] Packing tarball..."
pack_dir="$(mktemp -d)"
trap 'rm -rf "$pack_dir"' EXIT
( cd "$cli_dir" && npm pack --pack-destination "$pack_dir" >/dev/null )
tgz="$(ls "$pack_dir"/*.tgz | head -n1)"
echo "[e2e] Packed: $(basename "$tgz")"

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

# Superdense release smoke test

Docker-based end-to-end suite that validates the **published npm tarball** of
`@nimrobo/superdense` end-to-end. **Not** wired into CI — run this manually as the
last gate before `npm publish`.

## What it covers

| Scenario              | Catches                                                                                                                                                                                       |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `a-install-bootstrap` | global install + binary on PATH; `better-sqlite3` native module loads; first-run creates `~/.superdense/index.db` on an empty HOME                                                            |
| `b-adapters`          | Claude Code, Codex, OpenCode discovery + indexing against synthetic fixtures; empty-home discover is a no-op                                                                                  |
| `c-query-compactor`   | ad hoc query, saved-query lifecycle (save/list/run/delete), `compactor run salience`, `insight list` / `insight prompt` — proves `dist/skills`, `dist/insights`, and compactor wiring shipped |
| `d-server-web`        | `superdense studio` boots, `/api/stats` returns 200, `/` serves the bundled web SPA, port fallback works when 4242 is busy                                                                    |
| `e-skill-install`     | `skill install` writes to `~/.claude/skills/superdense` and `~/.codex/skills/superdense` with the right marker; re-install is idempotent; `--locally` writes under cwd                        |
| `f-robustness`        | malformed JSONL doesn't kill discovery; corrupt index.db doesn't unhandled-reject; invalid `--query` and unknown commands exit non-zero with a structured JSON error                          |

Full scenario list is in `scenarios/*.sh` — one bash file per group, each prints
`ok` / `FAIL` lines per assertion.

## Running it

From the repo root:

```sh
bash packages/cli/e2e/run-e2e.sh
```

What it does:

1. Runs `npm pack --workspace packages/cli`, which invokes the package `prepack`
   lifecycle used for the npm release artifact.
2. Verifies the tarball contains `dist/**`, `README.md`, `LICENSE`, and
   `package.json`, and fails if `src/**`, tests, e2e files, scripts, or TypeScript
   configs leak into the package.
3. Copies that packed tarball into the Docker build context.
4. Builds the `superdense-e2e` Docker image (Node 20 slim + jq + curl + sqlite3),
   `npm install -g`s the tarball inside.
5. Runs every scenario in a fresh `$HOME` and reports `PASS` / `FAIL` per
   scenario plus an overall exit code.

Total runtime: roughly 1–2 minutes on a warm Docker.

## Verifying the suite actually catches regressions

Easiest way to confirm the suite has teeth:

```sh
# Break something deliberately and re-run.
rm -rf packages/cli/dist/insights
bash packages/cli/e2e/run-e2e.sh   # c-query-compactor should FAIL
```

## Extending

Add a new file `scenarios/<letter>-<name>.sh`, source `_common.sh`, call
`new_home`, drive the CLI, use `expect` / `expect_eq`, and end with `finish`.
Files named with a leading underscore (e.g. `_common.sh`) are skipped by the
runner.

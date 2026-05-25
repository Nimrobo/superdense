# Superdense

[![npm version](https://img.shields.io/npm/v/@nimrobo/superdense)](https://www.npmjs.com/package/@nimrobo/superdense)
[![npm downloads](https://img.shields.io/npm/dm/@nimrobo/superdense)](https://www.npmjs.com/package/@nimrobo/superdense)
[![Node.js](https://img.shields.io/node/v/@nimrobo/superdense)](https://www.npmjs.com/package/@nimrobo/superdense)
[![License](https://img.shields.io/npm/l/@nimrobo/superdense)](./LICENSE)

Uncover patterns, workflows, and failures from your coding agent sessions.

Your coding agents ran a thousand sessions this month. Tool calls, loops, dead ends, the shape of your codebase under pressure — all of it sitting in sessions nobody reads.

Superdense indexes every session from Claude Code, Codex, and friends, and hands your agent the tool to query. Local CLI. No cloud.

## Install

```bash
npm i -g @nimrobo/superdense
superdense studio
```

Requires Node 20+. The single `superdense` binary ships everything — the indexer, the local server, and the web UI.

## What you get

- **Studio** — a local web UI at `http://127.0.0.1:4242` that lists every session your agents have produced, with filters, queries, and compactor views.
- **CLI** — agent-friendly JSON output for every operation, so your *other* agents can read your *previous* agents' work.
- **Skill** — a packaged Claude/Codex skill that teaches agents how to use Superdense to inspect prior sessions.

## Quickstart

```bash
superdense studio              # boot the local UI (and discover sessions)
superdense index               # incremental re-index
superdense session list --q "billing"
superdense query --query '{"filters":{"filter":{"name":"session","params":{"agent":"codex"}}}}'
superdense saved-query list
superdense saved-query run <id>
superdense compactor run salience <session-id>
superdense skill install       # install the superdense skill into Claude + Codex
superdense help                # full command list
```

All non-`studio` commands emit JSON. See `superdense help` for the full surface.

## Concepts

- **Sessions** — one transcript from one agent run, indexed by `<agent>:<native-session-id>`.
- **Filters** — boolean predicates over session metadata or transcript content.
- **Queries** — ad hoc filter JSON (+ optional enrichers) you can run without saving.
- **Saved queries** — named saved filters (+ optional enrichers) you can replay.
- **Enrichers** — cheap per-session metadata producers (tool counts, fingerprints, error signals).
- **Compactors** — heavier summarizers that read the raw log (e.g. `salience`, `trace`).

## Development

This is a pnpm workspace.

```bash
pnpm install
pnpm dev                   # runs the CLI in studio mode + the vite dev server
pnpm -r run build          # builds all workspaces
pnpm --filter=@nimrobo/superdense run build   # produce the publishable CLI bundle
pnpm test
```

Packages:

- `packages/cli` — the only published package (`@nimrobo/superdense`). Bundles core + server + web via esbuild.
- `packages/core` — indexer, filters, enrichers, compactors, query engine, sqlite store.
- `packages/server` — Fastify server serving the JSON API and static web UI.
- `packages/web` — React UI.

## License

Apache-2.0. See [LICENSE](./LICENSE).

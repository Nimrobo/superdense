# Road42

Uncover patterns, workflows, and failures from your coding agent sessions.

Your coding agents ran a thousand sessions this month. Tool calls, loops, dead ends, the shape of your codebase under pressure — all of it sitting in sessions nobody reads.

Road42 indexes every session from Claude Code, Codex, and friends, and hands your agent the tool to query. Local CLI. No cloud.

## Why 42?

In *The Hitchhiker's Guide to the Galaxy*, the answer (42) meant nothing because nobody knew the question. Like 42, an outcome without the context is useless. Road42 indexes the journey so you can search, trace, and uncover agent patterns.

## Install

```bash
npm i -g @nimrobo/road42
road42 studio
```

Requires Node 20+. The single `road42` binary ships everything — the indexer, the local server, and the web UI.

## What you get

- **Studio** — a local web UI at `http://127.0.0.1:4242` that lists every session your agents have produced, with filters, queries, and compactor views.
- **CLI** — agent-friendly JSON output for every operation, so your *other* agents can read your *previous* agents' work.
- **Skill** — a packaged Claude/Codex skill that teaches agents how to use Road42 to inspect prior sessions.

## Quickstart

```bash
road42 studio              # boot the local UI (and discover sessions)
road42 index               # incremental re-index
road42 session list --q "billing"
road42 query list
road42 query run <id>
road42 compactor run salience <session-id>
road42 skill install       # install the road42 skill into Claude + Codex
road42 help                # full command list
```

All non-`studio` commands emit JSON. See `road42 help` for the full surface.

## Concepts

- **Sessions** — one transcript from one agent run, indexed by `<agent>:<native-session-id>`.
- **Filters** — boolean predicates over session metadata or transcript content.
- **Queries** — named saved filters (+ optional enrichers) you can replay.
- **Enrichers** — cheap per-session metadata producers (tool counts, fingerprints, error signals).
- **Compactors** — heavier summarizers that read the raw log (e.g. `salience`, `trace`).

## Development

This is a pnpm workspace.

```bash
pnpm install
pnpm dev                   # runs the CLI in studio mode + the vite dev server
pnpm -r run build          # builds all workspaces
pnpm --filter=@nimrobo/road42 run build   # produce the publishable CLI bundle
pnpm test
```

Packages:

- `packages/cli` — the only published package (`@nimrobo/road42`). Bundles core + server + web via esbuild.
- `packages/core` — indexer, filters, enrichers, compactors, query engine, sqlite store.
- `packages/server` — Fastify server serving the JSON API and static web UI.
- `packages/web` — React UI.

## License

Apache-2.0. See [LICENSE](./LICENSE).

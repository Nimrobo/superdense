# Superdense

[![npm version](https://img.shields.io/npm/v/@nimrobo/superdense)](https://www.npmjs.com/package/@nimrobo/superdense)
[![npm downloads](https://img.shields.io/npm/dm/@nimrobo/superdense)](https://www.npmjs.com/package/@nimrobo/superdense)
[![Node.js](https://img.shields.io/node/v/@nimrobo/superdense)](https://www.npmjs.com/package/@nimrobo/superdense)
[![License](https://img.shields.io/npm/l/@nimrobo/superdense)](./LICENSE)

Superdense helps coding agents learn from your past sessions.

Your agents have already explored your repos, debugged failures, retried commands, found workflows, and shipped code. Those sessions contain useful evidence: what broke, what worked, which files mattered, which commands repeated, and where the agent got stuck.

Raw logs are too long and scattered to reuse directly. Superdense indexes local sessions from Claude Code, Codex, OpenCode, and friends, lets agents search and filter them, then compacts the useful sessions so they can extract patterns, workflows, failures, and proof of work. Local CLI. No cloud.

## Why use this?

- **Find repo-specific skills to build** — scan prior sessions for repeated workflows that should become coding-agent skills.
- **Reduce repeated context fetching** — find files, commands, and explanations agents keep rediscovering, then turn them into durable repo context.
- **Find standout coding sessions** — rank sessions that best show technical depth, iteration, shipped outcomes, or founder grit.
- **Mine recurring failures and workflows** — compact similar sessions to see where agents get stuck and which patterns keep coming back.

## Install

```bash
npm i -g @nimrobo/superdense
superdense studio
```

Requires Node 20+. The single `superdense` binary ships everything — the indexer, the local server, and the web UI.

## How to Use It

**Studio.** Start with `superdense studio` to open the local UI, index sessions, and install or update the Superdense skill when prompted. Use Studio to browse prior agent work with filters, saved queries, and compacted session views. The Insights view gives you copyable prompts for higher-level analyses; paste one into Claude Code, Codex, or OpenCode and Superdense will index the resulting run.

**Direct from your agent.** Open Studio first so Superdense is running and the skills are installed. From your coding agent, use the slash command with a normal prompt:

```text
/superdense find why this architecture decision was made
```

## How Superdense works

1. **Index** sessions from Claude Code, Codex, OpenCode, and similar tools.
2. **Search and filter** by project, prompt, agent, branch, errors, tools, commands, plan mode, and other metadata.
3. **Compact** selected sessions into structural or semantic summaries such as `trace` and `salience`.
4. **Run insights** as reusable prompts that ask an agent to analyze compacted session evidence.

## What you get

- **Studio** — a local web UI at `http://127.0.0.1:4242` for sessions, filters, saved queries, compactor views, and insight runs.
- **CLI** — JSON-first commands so agents can retrieve candidate sessions, inspect metadata, and run compactors.
- **Compactors** — small evidence views over huge logs: `salience` for what happened, `trace` for the sequence the agent followed.
- **Insight recipes** — packaged prompts for higher-level analysis, including skill recommendations, durable context proposals, and session rankings.
- **Skill** — a packaged Claude/Codex skill that teaches agents how to use Superdense during future work.

## Quickstart

```bash
superdense studio              # boot the local UI (and discover sessions)
superdense index               # incremental re-index
superdense session list --q "billing"       # retrieve candidate sessions
superdense query --query '{"filters":{"filter":{"name":"session","params":{"agent":"codex"}}}}'
superdense saved-query list
superdense saved-query run <id>
superdense compactor run salience <session-id>   # what happened?
superdense compactor run trace <session-id>      # what sequence did the agent follow?
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
- **Insight recipes** — reusable prompts that guide an agent through a compacted-session analysis, such as finding skills, context files, or standout sessions.

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

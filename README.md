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

**`/chain` — give your agent recent session context.** Prefix any task with `/chain` and the agent automatically receives the 3 most recent session IDs for the current workspace. The agent can then call `superdense compactor run salience <id>` on those IDs to read what happened in prior sessions — without you having to dig up IDs or paste in history.

```text
/chain fix the auth bug
```

If no sessions exist yet, `/chain` triggers an incremental index automatically. Use it at the start of any session where the agent should be aware of prior work.

## Reward layer

Most ways to learn from outcomes hand you a score — a reward model emits a number, an analytics tool ranks the winners. Superdense's reward layer surfaces the same evidence locally and leaves the call to you. **It never scores anything.**

Superdense already indexes what your agents did. The reward layer **closes the loop**: it groups those sessions into the real things you shipped — a PR, a post, a release — links each to where it went live, records how it actually performed, and pulls that evidence into your next run. Local, agent-driven, folded over the sessions you already have — no second database, no cloud.

**One loop, concretely** (illustrative numbers). Say three sessions went into one pull request:

```text
3 indexed sessions → curate into one thread → finalize as a stable artifact ("PR #214: streaming parser")
                   → reconcile: link it to github.com/acme/app/pull/214
                   → collect: 18 review comments, merged in 2 days
                   → compare: next time you build something similar, the agent sees PR #214
                     and what made it land fast — and you decide what to reuse.
```

Nothing there is scored. Superdense surfaces the past work and its real outcomes side by side; you make the call.

**How to begin.** Open Studio (`superdense studio`) so Superdense is running and your sessions are indexed, then point your coding agent at the layer:

```text
/superdense run the reward layer for this project
```

This resolves to one command — `superdense reward status` — which the agent runs to find the next actionable stage and walk the pipeline one bounded batch at a time (the first pass starts at `profile`, which is setup). You never have to remember the stage order: status names the next move, the agent executes only that, then checks back in. Want to drive it yourself? Run `superdense reward status` directly (add `--project <id>` to focus one project — list ids with `superdense project list --needs-action`).

The pipeline walks `profile → curate → finalize → reconcile → collect → compare`:

| Stage       | What it does                                                                   | So you can                                                                                  |
| ----------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| `profile`   | Describe the project once — its roots and the kinds of things it ships.        | bootstrap the loop so later stages know what to look for.                                   |
| `curate`    | Group related sessions into a *thread* — the scattered work behind one output. | address a shipped thing as one unit instead of hunting across logs.                         |
| `finalize`  | **Freeze** a ready thread into a stable *artifact* (a PR, a post, a release).  | point to the actual thing you shipped, frozen and addressable.                              |
| `reconcile` | **Link** an artifact to where it went live (GitHub, X, npm, YouTube, …).       | tie the work to its real-world identity.                                                    |
| `collect`   | **Record** how it performed out there (views, reactions, downloads, …).        | capture the outcome, not just the effort.                                                   |
| `compare`   | **Surface** how past peers of the same kind actually did.                      | start the next build from evidence instead of guessing. Superdense never ranks; you decide. |

That last row is the loop closing: `compare` is what the agent reads *before* the next `profile`/`curate` pass on the thing you ship next.

**Reward vocabulary** (all of it folds over your existing session index — no second database):

- **thread** — related sessions that together produced one real output; mutable while you curate.
- **artifact** — the frozen record of one shipped thing; stable once finalized, lineage stays append-only.
- **connector** — a plain platform label you choose (`github`, `x`, `npm`, …) marking where an artifact went live. A string, not software Superdense installs.
- **cohort** — peer artifacts of the same kind, surfaced side by side with their outcomes. Superdense groups them; it never ranks them.

`reconcile` and `collect` reach into the real world, so they're where you (or the agent) supply the numbers — link an artifact to its live URL, then fetch its metrics with whatever you already use (a platform CLI, the provider's API, or the public page). Superdense records what you bring back; it never installs a connector or phones a cloud. Full stage references and the `superdense reward docs artifacts` / `superdense reward docs connectors …` helpers live in [`skills/superdense/reward/README.md`](./skills/superdense/reward/README.md).

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

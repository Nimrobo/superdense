# Superdense

[![npm version](https://img.shields.io/npm/v/@nimrobo/superdense)](https://www.npmjs.com/package/@nimrobo/superdense)
[![npm downloads](https://img.shields.io/npm/dm/@nimrobo/superdense)](https://www.npmjs.com/package/@nimrobo/superdense)
[![Node.js](https://img.shields.io/node/v/@nimrobo/superdense)](https://www.npmjs.com/package/@nimrobo/superdense)
[![License](https://img.shields.io/npm/l/@nimrobo/superdense)](./LICENSE)

**The outcome loop for agents: from session, to shipped, to how it landed — fed back into the next build.**

Superdense indexes your agents' past sessions, groups them into the real things you shipped, links each to how it actually performed, and pulls that evidence into the next run. Local CLI. No cloud storage.

Those sessions already hold useful evidence — what broke, what worked, which files mattered, which commands repeated, where the agent got stuck — but raw logs are too long and scattered to reuse directly. Superdense compacts them so an agent can extract patterns, workflows, failures, and proof of work. It indexes local sessions from Claude Code, Codex, OpenCode, and friends.

## Try it now

```bash
npm i -g @nimrobo/superdense   # Node 20+
superdense studio              # boots Studio, indexes your sessions, installs the agent skill
```

`superdense studio` opens the local UI at `http://127.0.0.1:4242` — browse prior agent work with filters, saved queries, and compacted session views. One binary ships everything (indexer, server, web UI), and nothing leaves your machine.

Then drive it from your coding agent — shortest first:

- **Give your agent recent context — `/chain fix the auth bug`.** The agent automatically receives the 3 most recent session IDs for the workspace and reads what happened in them — no digging up IDs or pasting history. If no sessions exist yet, `/chain` indexes first.
- **Run the outcome loop — `/superdense run the reward layer for this project`.** The agent runs `superdense reward status`, which names the next actionable stage and walks the pipeline one bounded batch at a time — you never have to remember the stage order. Prefer to drive it yourself? Run `superdense reward status` directly (add `--project <id>` to focus one — list ids with `superdense project list --needs-action`).

## The outcome loop

**Your next build starts from what already shipped and how it actually landed — not a blank slate.** Superdense puts real outcomes in front of your agent, locally, so it learns what worked and carries it into the next build.

Superdense already indexes what your agents did. The outcome loop **closes the loop**: it groups those sessions into the real things you shipped — a PR, a post, a release — links each to where it went live, records how it actually performed, and pulls that evidence into your next run. Local, agent-driven, folded over the sessions you already have — no second database, no cloud.

**One loop, concretely** (illustrative numbers). Say three sessions went into one pull request:

```text
3 indexed sessions → curate into one thread → finalize as a stable artifact ("PR #214: streaming parser")
                   → reconcile: link it to github.com/acme/app/pull/214
                   → collect: 18 review comments, merged in 2 days
                   → compare: next time you build something similar, the agent sees PR #214
                     and what made it land fast — and pulls that into the new build.
```

Superdense hands your agent the real outcome, not a verdict — so it learns what made the work land.

The pipeline walks `profile → curate → finalize → reconcile → collect → compare`:

| Stage       | What it does                                                                   | So you can                                                          |
| ----------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| `profile`   | Describe the project once — its roots and the kinds of things it ships.        | bootstrap the loop so later stages know what to look for.           |
| `curate`    | Group related sessions into a _thread_ — the scattered work behind one output. | address a shipped thing as one unit instead of hunting across logs. |
| `finalize`  | **Freeze** a ready thread into a stable _artifact_ (a PR, a post, a release).  | point to the actual thing you shipped, frozen and addressable.      |
| `reconcile` | **Link** an artifact to where it went live (GitHub, X, npm, YouTube, …).       | tie the work to its real-world identity.                            |
| `collect`   | **Record** how it performed out there (views, reactions, downloads, …).        | capture the outcome, not just the effort.                           |
| `compare`   | **Surface** how past peers of the same kind actually did.                      | start the next build from evidence instead of guessing.             |

That last row is the loop closing: `compare` is what the agent reads _before_ the next `profile`/`curate` pass on the thing you ship next.

`reconcile` and `collect` reach into the real world, so they're where you (or the agent) supply the numbers — link an artifact to its live URL, then fetch its metrics with whatever you already use (a platform CLI, the provider's API, or the public page). Superdense records what you bring back; it never installs a connector or phones a cloud. Full stage references and the `superdense reward docs artifacts` / `superdense reward docs connectors …` helpers live in [`skills/superdense/reward/README.md`](./skills/superdense/reward/README.md).

**Vocabulary** (all of it folds over your existing session index — no second database):

- **thread** — related sessions that together produced one real output; mutable while you curate.
- **artifact** — the frozen record of one shipped thing; stable once finalized, lineage stays append-only.
- **connector** — a plain platform label you choose (`github`, `x`, `npm`, …) marking where an artifact went live. A string, not software Superdense installs.
- **cohort** — peer artifacts of the same kind, surfaced side by side with their outcomes.

## What's under the hood

The loop runs on a local retrieval engine:

1. **Index** sessions from Claude Code, Codex, OpenCode, and similar tools.
2. **Search and filter** by project, prompt, agent, branch, errors, tools, commands, plan mode, and other metadata.
3. **Compact** selected sessions into structural or semantic summaries such as `salience` (what happened) and `trace` (the sequence the agent followed).
4. **Run insights** as reusable prompts that ask an agent to analyze compacted session evidence — skill recommendations, durable context proposals, session rankings.

What ships:

- **Studio** — a local web UI at `http://127.0.0.1:4242` for sessions, filters, saved queries, compactor views, and insight runs.
- **CLI** — JSON-first commands so agents can retrieve candidate sessions, inspect metadata, and run compactors.
- **Compactors** — small evidence views over huge logs: `salience` for what happened, `trace` for the sequence the agent followed.
- **Insight recipes** — packaged prompts for higher-level analysis: finding repo-specific skills to build, proposing durable context files, ranking standout sessions, mining recurring failures and workflows.
- **Skill** — a packaged Claude/Codex skill that teaches agents how to use Superdense during future work.

**Core vocabulary** (the retrieval engine the commands below operate on):

- **session** — one transcript from one agent run, indexed by `<agent>:<native-session-id>`.
- **query** — ad hoc filter JSON (+ optional enrichers) you can run without saving.
- **compactor** — a heavier summarizer that reads the raw log (e.g. `salience`, `trace`).
- **insight recipe** — a reusable prompt that guides an agent through a compacted-session analysis, such as finding skills, context files, or standout sessions.

## CLI cheat sheet

```bash
superdense studio                                # boot the local UI (and discover sessions)
superdense index                                 # incremental re-index
superdense session list --q "billing"            # retrieve candidate sessions
superdense saved-query list                      # list saved filters
superdense saved-query run <id>                  # replay one
superdense compactor run salience <session-id>   # what happened?
superdense compactor run trace <session-id>      # what sequence did the agent follow?
superdense insight list                          # list available insight recipes
superdense insight prompt <name>                 # print a paste-ready insight prompt
superdense skill install                         # install the superdense skill into Claude + Codex
superdense help                                  # full command list
```

All non-`studio` commands emit JSON. See `superdense help` for the full surface.

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

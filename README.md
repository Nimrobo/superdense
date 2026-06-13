# Superdense

[![npm version](https://img.shields.io/npm/v/@nimrobo/superdense)](https://www.npmjs.com/package/@nimrobo/superdense)
[![npm downloads](https://img.shields.io/npm/dm/@nimrobo/superdense)](https://www.npmjs.com/package/@nimrobo/superdense)
[![Node.js](https://img.shields.io/node/v/@nimrobo/superdense)](https://www.npmjs.com/package/@nimrobo/superdense)
[![License](https://img.shields.io/npm/l/@nimrobo/superdense)](./LICENSE)

**Make your agents loop on a real-world goal and keep getting better at hitting it, every run.**

Define the goal in a folder, and your agents run an outcome loop toward it: remember what already worked, ship the next move, measure how it landed. Superdense is the layer that powers it: it ships the skills, feeds each run the evidence of what worked, and keeps the record of every outcome. No cloud.

<!-- TODO: hero image — choose one from docs/assets (e.g. superdense-outcome-clean-headline.png) -->

## Try it now

```bash
npm i -g @nimrobo/superdense   # Node 20+
superdense studio              # indexes your sessions, installs the skills, sets you up (UI at http://127.0.0.1:4242)
```

Then create a folder for each outcome you want to improve, open your agent there, and run `/outcome-setup` to define the goal. A goal is one real-world result you can measure, for example:

- `growth/signups/` — "Lift signup conversion on the pricing page"
- `growth/x-reach/` — "Grow qualified followers on our X account"
- `perf/checkout/` — "Cut p95 latency on the checkout API"

From there, `/outcome-run` starts the loop and `/outcome-update` sharpens it over time. Everything stays on your machine.

## How it works

Agents start every task cold, so good work never compounds. Superdense fixes that with one loop your agents run, aimed at a goal you set once.

**1. Set the goal — `/outcome-setup`**
Make a folder for one real-world outcome (say, landing-page signups), open your coding agent there, and run `/outcome-setup`. It inspects your target surfaces, then asks only what it can't discover: your north-star metric, audience, guardrails, and analytics access. It writes two files you own: `goal.md` (the outcome and its boundaries, protected) and `run.md` (the working playbook of levers, recipes, and what to measure), and instruments the target repo if needed. It also walks you through installing any connectors it needs to fetch outcomes later (GitHub, X, npm, analytics, and so on). Done once per goal.

**2. Run the loop — `/outcome-run`**
Each run, your agent remembers before it acts: a bounded pass over Superdense gathers what already shipped, how it landed, and how comparable efforts performed. With that evidence plus `goal.md` and `run.md`, it picks exactly one move (a proven recipe, or a fix in the path), ships it in the right surface (a draft, or a branch and PR in your repo), and records the result back into Superdense. You review and approve what ships. Run it as often as you like.

**3. Sharpen on a cadence — `/outcome-update`**
After enough runs to see a pattern, your agent reviews the batch against the real outcomes and rewrites `run.md`, promoting the moves that worked and dropping the ones that didn't. `goal.md` stays fixed; only the strategy sharpens.

The loop closes here: every run starts from what already worked, so results compound toward the goal instead of resetting to zero.

## More you can do

Beyond the outcome loop, you can also:

- **Carry context into a new task — `/chain`** — your agent gets the 3 most recent sessions for the workspace, no hunting for IDs.
- **See what each run cost** — Superdense tracks session run cost and surfaces it next to outcomes in cohorts.
- **Search and filter past sessions** — by project, prompt, agent, branch, errors, tools, commands, plan mode, and more.
- **Compact a long session** — `salience` (what happened) or `trace` (the sequence the agent followed).
- **Run insights** — packaged prompts for skill recommendations, durable-context proposals, session rankings, and recurring failures or workflows.
- **Compare deliverables** — `cohort show` and `cohort chain`: run cost and outcomes across peers and versions.
- **Browse it all in Studio** — a local UI at `http://127.0.0.1:4242` for sessions, filters, saved queries, and compactor views.

## Under the hood

Superdense is local and works with the agents you already use. It indexes the sessions your tools produce into a local SQLite store, enriches and compacts them on demand, and keeps the durable record the loop reads from. It ships as one binary — indexer, server, and Studio UI — and nothing leaves your machine.

The core engine (`packages/core`) is a handful of focused modules:

- **Adapters** (`adapters/`) — read raw sessions from Claude Code, Codex, Cursor, and OpenCode.
- **Indexer + store** (`indexer.ts`, `db.ts`) — incremental indexing into a local SQLite database.
- **Enrichers** (`enrichers/`) — derive per-session signals: run cost, errors, tool and command counts, plan mode, file footprint, first intent, and subagent/workflow summaries.
- **Query engine** (`filters/`, `query/`, `queryeval.ts`) — filter and search the index by any of those signals.
- **Compactors** (`compactors/`) — `salience` (what happened) and `trace` (the sequence the agent followed) views over long logs.
- **Curation + rewards** (`curation/`, `rewards/`, `reward-status/`) — group sessions into threads, freeze artifacts, record reward snapshots, and report the loop's next actionable stage.
- **Externalization + cohorts** (`externalization/`, `cohorts/`) — link artifacts to real-world identities and compare peers by run cost and outcome.
- **Insights + stats** (`insights/`, `stats/`) — reusable analysis prompts and dashboards over the indexed sessions.

## Key terms

The words the loop uses:

- **North star** — the stable real-world result you care about (qualified signups, audience growth).
- **Lever** — a mechanism that might move the north star (hero clarity, posting time).
- **Action** — one concrete step on a lever: a rep of a proven recipe, or a fix in the path.
- **Diagnostic** — a measurement that explains why a lever did or didn't move the north star.
- **Artifact** — the frozen record of one shipped thing (a PR, a post, a release), stable once finalized.
- **Connector** — a platform label (`github`, `x`, `npm`, …) marking where an artifact went live and how to fetch its outcomes.

## CLI cheat sheet

```bash
superdense skill install                          # install the outcome + session skills into Claude & Codex
superdense reward status                          # name the next actionable stage of the outcome loop
superdense reward status --project <id>           # focus one project (ids: superdense project list --needs-action)
superdense studio                                 # local UI: sessions, filters, saved queries, compactor views
superdense index                                  # incremental re-index of local sessions
superdense session list --q "billing"             # search past sessions
superdense compactor run salience <session-id>    # what happened in a session
superdense compactor run trace <session-id>       # the sequence the agent followed
superdense insight list                           # list insight recipes
superdense cohort show <type>                     # peer deliverables with run cost + outcomes
superdense cohort chain <artifact-id>             # one deliverable across versions
superdense help                                   # full command list
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

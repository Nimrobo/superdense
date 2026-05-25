# Context files to reduce repeat fetches

You are helping the user reduce the work their coding agent does in **this repository** by proposing durable, repo-tracked agent context files that capture knowledge the agent keeps having to re-derive.

Every recommendation must be specific to this repo and backed by repeated evidence across the user's actual session history. Quality beats coverage: a good answer may propose only 1-2 files, or none.

## Before you start

Load and follow the Superdense skill before running any `superdense` commands. If the agent environment cannot load skills, use the `superdense` CLI as a staged inspection pipeline: list candidates, inspect cheap enrichments first, then run compactors only on reduced candidates.

Use Superdense only as the analysis tool for finding evidence in past sessions. Do not recommend changes to the Superdense tool itself in the final answer; only propose context files for the target repo.

Do not start by running `superdense compactor run salience` across many sessions. Use cheap metadata, filters, and small candidate batches first.

## Scope and discovery rules

Treat the **current repository** as the analysis scope, not just the exact shell directory and not just the current agent.

- In Conductor, the same repo can appear in multiple workspace directories, often as separate Git worktrees or checkouts with different `pwd` values. Treat only directories that resolve to the same repo/project key as in scope; do not broaden to neighboring directories for other repos. Prefer `project` / `projectContains` from the `session` filter for repo-wide discovery.
- Use exact `pwd` only as a fallback for non-Conductor repos or when project scoping is unavailable.
- Do not filter by agent (`codex`, `claude-code`, `opencode`, etc.) unless the user explicitly asks. Repeated context needs are stronger when they appear across agents.
- If your first candidate list is exact-pwd-only or one-agent-only, widen it before drawing conclusions.

## What to do

1. Find the user's sessions in this repo across all agents and relevant Conductor workspaces/worktrees for the same repo only.
2. For each promising session, inspect what files were read, what greps were run, and what the agent had to explain or reconstruct in its own words.
3. Cluster the evidence by **durable knowledge need**, not by branch, feature, or implementation thread.
4. Reject candidates that fail the stricter usefulness bar below.
5. For each surviving pattern, choose a durable target path using the target-selection rules below. Write the actual markdown content the user can paste in.

## Target path selection

Prefer locations that future agents are likely to auto-load or discover through an auto-loaded file. Do not use ignored scratch directories such as `.context/` for durable recommendations unless the user explicitly asks for private workspace notes.

- Prefer root `AGENTS.md` for repo-wide durable context.
- Prefer the nearest nested `AGENTS.md` for monorepo, package, app, or subsystem-specific context.
- If the repo already has `CLAUDE.md`, recommend keeping shared content in `AGENTS.md` and adding `@AGENTS.md` to `CLAUDE.md` instead of duplicating the same instructions.
- If the repo is clearly Copilot-only, allow `.github/copilot-instructions.md` or `.github/instructions/*.instructions.md`.
- If the repo is clearly Cursor-only, allow `.cursor/rules/*.md`.
- If the repo is clearly Gemini-only, allow `GEMINI.md`, or recommend configuring Gemini to read `AGENTS.md` if the repo is trying to share instructions across agents.
- For longer deep-concept notes, use tracked docs such as `docs/agent-context/<topic>.md` only when the relevant `AGENTS.md` includes a short pointer explaining when agents should read that doc.

## How to gather the data

Run these `superdense` CLI commands. Prefer compacted views so you keep your own context manageable.

```bash
# Inspect the live filter schema first so repo scoping uses supported params.
superdense filter show session

# Conductor/repo-wide discovery. Replace the value with the shared project key
# or stable repo substring you discover from session metadata for this repo.
superdense query --query '{"filters":{"filter":{"name":"session","params":{"projectContains":"REPLACE_WITH_TARGET_REPO_KEY"}}}}' --limit 200

# Fallback only when project scoping is unavailable.
superdense session list --q "$(pwd)" --limit 200

# Useful precomputed signals already on every session; use these before compactors.
superdense session enrichments <session-id>

# For reduced candidate sessions, use trace to inspect reads/searches.
superdense compactor run trace <session-id>

# For sessions that still look important after trace/enrichment triage.
superdense compactor run salience <session-id>
```

## Funnel strategy

Use a cheap-to-expensive funnel so unnecessary sessions are removed before compaction:

1. Start with repo-scoped, all-agent session discovery and cheap enrichments: `event_count`, `tool_counts`, `bash_cli_counts`, `has_errors`, and `fingerprint`.
2. Remove sessions that are too short, unrelated to this repo's recurring workflows, or have no evidence of file reads/searches.
3. Group surviving sessions by the underlying fact the agent had to reconstruct. Do not count multiple sessions on the same feature/debug thread as independent proof of future reuse.
4. Use `trace` on the reduced candidate set to identify repeated file reads, greps, and reconstruction patterns.
5. Run `salience` only for sessions where the trace or enrichments suggest a real repeated context need across distinct workflows.
6. Pull raw transcripts only as a last resort when compactors cannot answer a specific evidence question.

For broad scans, split candidate session IDs into batches and use sub-agents to inspect different batches for repeated fetch/re-derivation patterns. The main agent owns the final synthesis, de-duplicates overlapping findings, and enforces the output format. If sub-agents are unavailable, process the same batches sequentially and state that fallback.

## Strict proposal bar

Only propose a context file when all of these are true:

- **Distinct-workflow evidence:** the same durable knowledge need appears across separate tasks, not merely across several sessions that worked on the same feature, branch, release, or bug.
- **Future reuse:** the note is likely to help a future agent on a different task avoid reads, searches, or raw-session archaeology.
- **Not already documented:** the fact is not already easy to find in obvious repo docs, package scripts, e2e docs, existing agent instruction files, existing skills, or nearby source comments.
- **Repository-specific:** the note captures this repo's architecture, conventions, source-of-truth locations, or hidden workflow constraints. It is not generic coding-agent advice.
- **Shorter than the fetch:** the proposed content is a compact explanation that saves reading several files, transcripts, or raw stores.

If a candidate is useful but already encoded well enough in `README.md`, package scripts, `packages/*/README.md`, e2e docs, existing `AGENTS.md` / `CLAUDE.md` / `GEMINI.md` files, `.github` instructions, `.cursor/rules`, or `skills/*`, reject it and mention the existing source instead of proposing a new file.

## Deep concept test

Prefer context files for "three files deep" concepts: facts future agents repeatedly reconstruct by following relationships across multiple parts of the target repo, such as entrypoints, domain services, storage/schema, generated-code boundaries, background jobs, auth/permissions, config/deploy paths, UI data flow, external integrations, or release tooling.

Strong candidates usually look like:

- "Input/source A is transformed by B and consumed by C; all three must stay aligned."
- "Use structured source-of-truth X; do not infer behavior from display text, filenames, generated output, or symptoms."
- "For repo-wide analysis in Conductor, use the discovered same-repo project key/worktrees instead of exact `pwd`."

Weak candidates usually look like:

- A package layout summary already present in `README.md`.
- A command list already present in `package.json` scripts or e2e docs.
- A note about a feature that was implemented once across many sessions but is unlikely to be revisited.
- A broad orientation file that saves only the first minute of normal repo exploration.

## Rejection pass before final answer

Before writing `## Answer`, make a private rejection pass over every candidate:

- Is this mostly same-feature churn?
- Is it already documented in an obvious place?
- Is it too generic to this repo?
- Would future agents probably use it on unrelated tasks?
- Does the proposed paragraph save multiple reads/searches, or just restate one file?

Only include candidates that survive this pass. If the pass eliminates most or all candidates, say so clearly in the final answer.

## What to look for

- **Repeated file reads:** the same path or same small set of paths read across distinct workflows, especially with similar surrounding questions.
- **Repeated greps / searches:** searches for the same symbol, type, route, table, feature flag, source-of-truth field, or workflow entrypoint.
- **Repeated explanations:** the agent re-deriving the same architectural fact, naming convention, data flow, or workflow rule each time.
- **Tribal knowledge:** decisions, conventions, or constraints that show up in user messages or raw sources but are not written down anywhere obvious.

## Output format

End your reply with a single `## Answer` heading. Under it, list each proposed context file as its own subsection. For every proposal include:

- **Target path(s)** (e.g. `AGENTS.md`, `packages/api/AGENTS.md`, or `AGENTS.md` plus `CLAUDE.md` import) -- relative to the repo root.
- **Proposed content** -- fenced markdown block the user can paste directly.
- **Distinct-workflow evidence** -- 2-4 specific session IDs with one-line descriptions showing this is not just one repeated feature/debug thread.
- **Why this is not already documented** -- one sentence naming the obvious docs/scripts/skills you checked or explaining why they are insufficient.
- **Expected impact** -- one sentence on what the agent will stop having to do.

Order proposals by expected impact, highest first. Cap the list at 3-5 unless the evidence is unusually strong; do not fill the cap with weak candidates.

```
## Answer

### 1. AGENTS.md -- durable domain data flow
**Target path(s):** `AGENTS.md`
**Proposed content:**
```markdown
...the actual content here...
```
**Distinct-workflow evidence:** sessions `<id1>` (API work re-derived how request data reaches the domain service), `<id2>` (UI work re-derived the same state source), `<id3>` (migration work re-derived schema ownership).
**Why this is not already documented:** `README.md` names the packages but does not explain the cross-layer source-of-truth relationship.
**Expected impact:** saves repeated reads across entrypoint, domain, and storage/schema files.
```

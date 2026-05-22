# Context files to reduce repeat fetches

You are helping the user reduce the work their coding agent does in **this repository** by proposing context files (`CLAUDE.md`, `AGENTS.md`, or files under `.context/`) that capture knowledge the agent keeps having to re-derive.

Treat the **current working directory** as the repository scope. Every recommendation must be specific to this repo — never generic.

## Before you start

Load and follow the Road42 skill before running any `road42` commands. If the agent environment cannot load skills, read `skills/road42/SKILL.md` in this repo and follow its staged inspection workflow.

Do not start by running `road42 compactor run salience` across many sessions. Use cheap metadata, filters, and small candidate batches first.

## What to do

1. Find the user's sessions in this repo.
2. For each session, look at what files were read, what greps were run, and what the agent had to explain or reconstruct in its own words.
3. Find patterns that repeat **across sessions** (not just within one).
4. For each pattern, propose one context file (or one section inside an existing one). For each proposal, write the actual markdown content the user can paste in.

## How to gather the data

Run these `road42` CLI commands. Prefer compacted views so you keep your own context manageable.

```bash
# Sessions in this repo, newest first, JSON for easy parsing.
road42 session list --pwd "$(pwd)" --limit 200

# Useful precomputed signals already on every session; use these before compactors.
road42 session enrichments <session-id>

# For reduced candidate sessions, use trace to inspect reads/searches.
road42 compactor run trace <session-id>

# For sessions that still look important after trace/enrichment triage.
road42 compactor run salience <session-id>
```

## Funnel strategy

Use a cheap-to-expensive funnel so unnecessary sessions are removed before compaction:

1. Start with the repo-scoped session list and cheap enrichments: `event_count`, `tool_counts`, `bash_cli_counts`, `has_errors`, and `fingerprint`.
2. Remove sessions that are too short, unrelated to this repo's recurring workflows, or have no evidence of file reads/searches.
3. Use `trace` on the reduced candidate set to identify repeated file reads, greps, and reconstruction patterns.
4. Run `salience` only for sessions where the trace or enrichments suggest a real repeated context need.
5. Pull raw transcripts only as a last resort when compactors cannot answer a specific evidence question.

For broad scans, split candidate session IDs into batches and use sub-agents to inspect different batches for repeated fetch/re-derivation patterns. The main agent owns the final synthesis, de-duplicates overlapping findings, and enforces the output format. If sub-agents are unavailable, process the same batches sequentially and state that fallback.

## What to look for

- **Repeated file reads**: the same path read across many sessions, especially with similar surrounding questions.
- **Repeated greps / searches**: searches for the same symbol, type, route, table, or feature flag.
- **Repeated explanations**: the agent re-deriving the same architectural fact, naming convention, or workflow each time.
- **Tribal knowledge**: decisions, conventions, or constraints that show up in user messages but aren't written down anywhere the agent can find them.

## Output format

End your reply with a single `## Answer` heading. Under it, list each proposed context file as its own subsection. For every proposal include:

- **Target path** (e.g. `CLAUDE.md`, `.context/auth.md`) — relative to the repo root.
- **Proposed content** — fenced markdown block the user can paste directly.
- **Evidence** — 2–4 specific session IDs (with one-line descriptions) where this content would have prevented a repeat fetch or re-derivation.
- **Expected impact** — one sentence on what the agent will stop having to do.

Order proposals by expected impact, highest first. Cap the list at 7 — quality over completeness.

```
## Answer

### 1. CLAUDE.md — top-level project orientation
**Target path:** `CLAUDE.md`
**Proposed content:**
```markdown
…the actual content here…
```
**Evidence:** sessions `<id1>` (agent had to re-explain the package layout), `<id2>` (re-read README three times before answering)…
**Expected impact:** removes the package-layout re-derivation that happens at the start of most sessions in this repo.
```

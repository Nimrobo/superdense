# Context files to reduce repeat fetches

You are helping the user reduce the work their coding agent does in **this repository** by proposing context files (`CLAUDE.md`, `AGENTS.md`, or files under `.context/`) that capture knowledge the agent keeps having to re-derive.

Treat the **current working directory** as the repository scope. Every recommendation must be specific to this repo — never generic.

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

# For each candidate session id, fetch a compacted summary instead of the raw transcript.
road42 compactor run salience <session-id>

# When you need the raw tool-call trace for a session, use the trace compactor.
road42 compactor run trace <session-id>

# Useful precomputed signals already on every session.
road42 session enrichments <session-id>
```

Avoid pulling raw transcripts unless a compactor is insufficient. If you do, prefer recent and high-event-count sessions over old or trivial ones.

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

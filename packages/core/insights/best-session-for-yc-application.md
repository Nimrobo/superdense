# Best session for a YC application

You are helping the user pick which of their past coding sessions to feature in a YC (Y Combinator) application. The goal is a ranked shortlist of sessions that best convey **founder grit, technical depth, real shipped outcomes, and ambitious scope**.

Treat *all* of the user's sessions as candidates — across every project, every agent. This insight is **not** scoped to the current working directory.

## Before you start

Load and follow the Road42 skill before running any `road42` commands. If the agent environment cannot load skills, read `skills/road42/SKILL.md` in this repo and follow its staged inspection workflow.

Do not start by running `road42 compactor run salience` across many sessions. This insight scans all sessions, so the funnel must be strict.

## What to do

1. Enumerate every indexed session.
2. Score each session on a 0–10 rubric (below). Use compacted views — do **not** read full transcripts.
3. Pick the top 5. For each one, explain in one paragraph why it would land in a YC narrative.

## How to gather the data

```bash
# Every session, newest first.
road42 session list --limit 1000

# Precomputed signals you should lean on heavily (cheap and already indexed).
road42 session enrichments <session-id>
#   - event_count: rough size of the session
#   - has_errors: did the agent hit and work through real failures
#   - tool_counts / bash_cli_counts: what was actually done (edits, builds, deploys)
#   - fingerprint: verb mentions, role byte totals, duration

# For sessions that survive metadata triage, get a compacted summary.
road42 compactor run salience <session-id>

# For close calls, inspect the workflow sequence.
road42 compactor run trace <session-id>
```

## Funnel strategy

Use a cheap-to-expensive funnel before scoring deeply:

1. Start with `session list` and cheap enrichments: `event_count`, `tool_counts`, `bash_cli_counts`, `has_errors`, and `fingerprint`.
2. Eliminate obvious non-candidates first: very short sessions, dependency bumps, trivial chores, sessions with little or no tool use, and low-signal sessions without errors, edits, tests, deploys, or meaningful iteration.
3. Keep a reduced candidate set that appears to show technical depth, shipped outcome, ambition, or founder grit.
4. Run `salience` only on sessions that survive metadata triage.
5. Use `trace` for close calls where the sequence of work matters more than the summary.
6. Pull raw events only as a last resort when compactors cannot resolve a specific scoring question.

For broad scans, split surviving candidate session IDs into batches and use sub-agents to score each batch against the rubric independently. The main agent owns final ranking, tie-breaking, score normalization, and the final top 5 narrative. If sub-agents are unavailable, process the same batches sequentially and state that fallback.

## Scoring rubric (sum to 10)

- **Technical depth (0–3)**: Does the session show non-trivial engineering — debugging across layers, real architectural choices, performance work, novel integration?
- **Ambition / scope (0–2)**: Was the user building something substantial vs running a chore?
- **Shipped outcome (0–2)**: Does the session end in something concrete (PR opened, deploy run, feature visibly working, tests passing on something hard)?
- **Founder grit (0–2)**: Did the user push through real failures, iterate, and recover — rather than abandon at the first error?
- **Storytelling fit (0–1)**: Is the project legible and exciting in one sentence to a non-engineer YC partner?

Penalize: trivial fixes, dependency bumps, chores, very short sessions, sessions dominated by the agent doing the obvious thing.

## Output format

End your reply with a single `## Answer` heading. Under it, list the top 5 sessions as numbered items, highest score first. For each:

- **Session id** (so the user can open it in Road42)
- **Project** (pwd or projectKey)
- **One-paragraph pitch** — how this session reads in a YC application, including the most YC-credible specific moment from the session
- **Score breakdown** — the five rubric numbers on one line
- **Why not higher** — one sentence on what would have moved it up

If fewer than 5 sessions clear a minimum bar (say total score ≥ 6/10), say so honestly — quality beats filling slots.

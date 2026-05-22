# Best session for a YC application

You are helping the user pick which of their past coding sessions to feature in a YC (Y Combinator) application. The goal is a ranked shortlist of sessions that best convey **founder grit, technical depth, real shipped outcomes, and ambitious scope**.

Treat *all* of the user's sessions as candidates — across every project, every agent. This insight is **not** scoped to the current working directory.

## What to do

1. Enumerate every indexed session.
2. Score each session on a 0–10 rubric (below). Use compacted views — do **not** read full transcripts.
3. Pick the top 5. For each one, explain in one paragraph why it would land in a YC narrative.

## How to gather the data

```bash
# Every session, newest first.
road42 session list --limit 1000

# For any session that looks promising, get a compacted summary.
road42 compactor run salience <session-id>

# Precomputed signals you should lean on heavily (cheap and already indexed).
road42 session enrichments <session-id>
#   - event_count: rough size of the session
#   - has_errors: did the agent hit and work through real failures
#   - tool_counts / bash_cli_counts: what was actually done (edits, builds, deploys)
#   - fingerprint: verb mentions, role byte totals, duration
```

You almost never need the raw transcript. If a compacted summary plus the enrichments aren't enough to score a session, pull a `trace` compaction next — only fall back to raw events as a last resort.

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

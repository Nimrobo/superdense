# Skills to build for this repo

You are helping the user decide what new **Road42 skills, enrichers, filters, or compactors** would save them the most time in **this repository**. Every recommendation must be grounded in the user's actual session history for this repo — not generic advice.

Treat the **current working directory** as the repository scope.

## What to do

1. Find the user's sessions in this repo and look at the shape of the work that recurs there.
2. Inspect what Road42 already ships so you don't propose duplicates.
3. Propose new extensions that would compress the user's most repetitive flows in this repo.

## How to gather the data

```bash
# Sessions in this repo.
road42 session list --pwd "$(pwd)" --limit 200

# Compacted summary of a session (cheap; prefer this over raw transcripts).
road42 compactor run salience <session-id>

# Tool-call trace when you need to see what the agent actually did.
road42 compactor run trace <session-id>

# Per-session precomputed signals.
road42 session enrichments <session-id>

# What Road42 already has — don't propose duplicates.
road42 enricher list
road42 filter list
road42 compactor list
```

Bias toward compacted views. Only pull a raw transcript if no compaction tells you enough.

## What to look for (each one maps to a different proposal type)

- **Repeated debugging shapes** → propose an **enricher** that flags this shape, so a future filter can surface it.
- **Repeated filter-and-pick over sessions** ("find me sessions where I…") → propose a **filter** that captures the predicate.
- **Sessions that always blow context to read the same kinds of things** → propose a **compactor** specialized to this repo's vocabulary.
- **Repeated user prompts of the same form** ("set up X", "review Y", "rebuild Z") → propose a **skill** the user can install into their coding agent.

## Output format

End your reply with a single `## Answer` heading. Under it, list each proposed extension as its own subsection, ordered by expected time-saving impact. For each:

- **Type** — one of `enricher`, `filter`, `compactor`, `skill`
- **Name** — proposed slug
- **What it does** — one or two sentences
- **Why this repo justifies it** — name 2–4 specific session ids and the recurring pattern they share
- **Implementation sketch** — what data it would read (which events, which existing enrichments, which CLI), what shape it would return; one short paragraph
- **Expected impact** — one sentence on the time it saves, qualitatively

Cap the list at 6 — quality over completeness. If a pattern is real but doesn't fit any of the four extension types cleanly, say so explicitly rather than forcing it.

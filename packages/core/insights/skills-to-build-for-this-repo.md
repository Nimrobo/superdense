# Skills to build for this repo

You are helping the user decide what new **Road42 skills, enrichers, filters, or compactors** would save them the most time in **this repository**. Every recommendation must be grounded in the user's actual session history for this repo — not generic advice.

Treat the **current working directory** as the repository scope.

## Before you start

Load and follow the Road42 skill before running any `road42` commands. If the agent environment cannot load skills, read `skills/road42/SKILL.md` in this repo and follow its staged inspection workflow.

Do not start by running `road42 compactor run salience` across many sessions. Use cheap metadata, filters, and extension catalogs to narrow the work first.

## What to do

1. Find the user's sessions in this repo and look at the shape of the work that recurs there.
2. Inspect what Road42 already ships so you don't propose duplicates.
3. Propose new extensions that would compress the user's most repetitive flows in this repo.

## How to gather the data

```bash
# Sessions in this repo.
road42 session list --pwd "$(pwd)" --limit 200

# Per-session precomputed signals; use these before compactors.
road42 session enrichments <session-id>

# What Road42 already has — don't propose duplicates.
road42 enricher list
road42 filter list
road42 compactor list

# For reduced candidate clusters, inspect what the agent actually did.
road42 compactor run trace <session-id>

# For sessions that still look important after metadata/trace triage.
road42 compactor run salience <session-id>
```

## Funnel strategy

Use a cheap-to-expensive funnel so recommendations are based on recurring work, not one-off sessions:

1. First inspect existing Road42 extensions with `road42 enricher list`, `road42 filter list`, and `road42 compactor list`.
2. Start session triage with the repo-scoped session list and cheap enrichments: `event_count`, `tool_counts`, `bash_cli_counts`, `has_errors`, and `fingerprint`.
3. Remove sessions that are too short, unrelated to recurring repo workflows, or already covered by existing extensions.
4. Cluster surviving sessions by repeated debugging shape, repeated filter-and-pick request, repeated context blowup, or repeated user prompt form.
5. Run `trace` on clusters where the actual command/tool sequence matters.
6. Run `salience` only on sessions that survive the metadata and cluster triage.
7. Pull raw transcripts only as a last resort when compactors cannot answer a specific evidence question.

For broad scans, split candidate session clusters into batches and use sub-agents to analyze each batch for non-duplicate extension candidates. The main agent owns final synthesis, removes duplicates, checks proposals against existing Road42 capabilities, and enforces the cap of 6 recommendations. If sub-agents are unavailable, process the same batches sequentially and state that fallback.

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

# Skills to build for this repo

You are helping the user decide what new **coding-agent skills** would save them the most time in **this repository**. Every recommendation must be grounded in the user's actual session history for this repo — not generic advice.

Treat the **current working directory** as the repository scope.

## Before you start

Load and follow the Road42 skill before running any `road42` commands. If the agent environment cannot load skills, use the `road42` CLI as a staged inspection pipeline: list candidates, inspect cheap enrichments first, then run compactors only on reduced candidates.

Use Road42 only as the analysis tool for finding evidence in past sessions. Do **not** propose Road42 enrichers, filters, compactors, query changes, dashboard changes, or Road42 product features in the final answer.

Do not start by running `road42 compactor run salience` across many sessions. Use cheap metadata and filters to narrow the work first.

## What to do

1. Find the user's sessions in this repo and look at the shape of the work that recurs there.
2. Identify repeated workflows where a coding agent could follow stable repo-specific instructions instead of re-discovering the same steps.
3. Propose new coding-agent skills that would help this repo's future sessions.

## How to gather the data

```bash
# Sessions in this repo.
road42 session list --pwd "$(pwd)" --limit 200

# Per-session precomputed signals; use these before compactors.
road42 session enrichments <session-id>

# For reduced candidate clusters, inspect what the agent actually did.
road42 compactor run trace <session-id>

# For sessions that still look important after metadata/trace triage.
road42 compactor run salience <session-id>
```

## Funnel strategy

Use a cheap-to-expensive funnel so recommendations are based on recurring work, not one-off sessions:

1. Start session triage with the repo-scoped session list and cheap enrichments: `event_count`, `tool_counts`, `bash_cli_counts`, `has_errors`, and `fingerprint`.
2. Remove sessions that are too short, unrelated to recurring repo workflows, or too one-off to justify a reusable skill.
3. Cluster surviving sessions by repeated user prompt form, repeated setup/build/deploy workflow, repeated debugging path, repeated review checklist, or repeated repo-specific implementation pattern.
4. Run `trace` on clusters where the actual command/tool sequence matters.
5. Run `salience` only on sessions that survive the metadata and cluster triage.
6. Pull raw transcripts only as a last resort when compactors cannot answer a specific evidence question.

For broad scans, split candidate session clusters into batches and use sub-agents to analyze each batch for skill candidates. The main agent owns final synthesis, removes duplicates, rejects non-skill proposals, and enforces the cap of 6 recommendations. If sub-agents are unavailable, process the same batches sequentially and state that fallback.

## What to look for

- **Repeated user prompts of the same form** ("set up X", "review Y", "rebuild Z") where an agent skill could define a stable workflow.
- **Repeated debugging paths** where the same files, logs, commands, or checks are inspected before a fix.
- **Repeated implementation flows** where the agent must follow repo-specific conventions, generated-code boundaries, deployment steps, or review criteria.
- **Repeated missed constraints** where past agents made the same mistake and a skill could prevent it.
- **Repeated context reconstruction** that is too procedural for a static context file and better expressed as instructions for when and how to act.

## Output format

End your reply with a single `## Answer` heading. Under it, list each proposed skill as its own subsection, ordered by expected time-saving impact. For each:

- **Skill name** — proposed slug
- **Use case** — when a coding agent should load this skill in this repo
- **Trigger** — concrete user requests, file paths, commands, or symptoms that should activate the skill
- **Proposed `SKILL.md` instructions** — concise markdown content for the skill, including the workflow the agent should follow
- **Evidence** — name 2–4 specific session ids and the recurring pattern they share
- **Expected impact** — one sentence on the time it saves or mistake it prevents

Cap the list at 6 — quality over completeness. If a pattern is real but would be better served by Road42 itself, a context file, or a code change instead of a coding-agent skill, say so explicitly rather than forcing it into the list.

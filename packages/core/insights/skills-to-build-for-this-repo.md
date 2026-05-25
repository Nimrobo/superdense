# Skills to build for this repo

You are helping the user decide what new **coding-agent skills** would save them the most time in **this repository**. Every recommendation must be grounded in the user's actual session history for this repo — not generic advice.

Treat the **current repository** as the analysis scope, not just the exact shell directory and not just the current agent.

## Before you start

Load and follow the Superdense skill for session discovery, enrichment triage, and compactor usage. This prompt only adds the insight-specific scope, rejection criteria, and output requirements below.

If the Superdense skill is unavailable, use the Superdense CLI as a staged pipeline: metadata first, compactors only after triage. Do not duplicate CLI help in the final answer.

Use Superdense only as the analysis tool for finding evidence in past sessions. Do **not** propose Superdense enrichers, filters, compactors, query changes, dashboard changes, or Superdense product features in the final answer.

## What to do

1. Find the user's sessions in this repo across all agents and relevant Conductor workspaces/worktrees for the same repo only.
2. Identify repeated procedural workflows where a coding agent could follow stable repo-specific instructions instead of re-discovering the same steps.
3. Reject candidates that are same-feature churn, static repo facts, one-off work, or better handled by docs or code.
4. Propose new coding-agent skills that would help this repo's future sessions.

## Scope and discovery rules

- In Conductor, the same repo can appear in multiple workspace directories, often as separate Git worktrees or checkouts with different `pwd` values. Treat only directories that resolve to the same repo/project key as in scope; do not broaden to neighboring directories for other repos. Prefer `project` / `projectContains` from the `session` filter for repo-wide discovery.
- Use exact `pwd` only as a fallback for non-Conductor repos or when project scoping is unavailable.
- Do not filter by agent (`codex`, `claude-code`, `opencode`, etc.) unless the user explicitly asks. Repeated skill needs are stronger when they appear across agents.
- If your first candidate list is exact-pwd-only or one-agent-only, widen it before drawing conclusions.

## Funnel strategy

Use a cheap-to-expensive funnel so recommendations are based on recurring work, not one-off sessions:

1. Start session triage with repo-scoped, all-agent discovery and cheap metadata/enrichments.
2. Remove sessions that are too short, unrelated to recurring repo workflows, or too one-off to justify a reusable skill.
3. Cluster surviving sessions by repeated user prompt form, repeated setup/build/deploy workflow, repeated debugging path, repeated review checklist, or repeated repo-specific implementation pattern.
4. Do not count multiple sessions on the same feature, branch, release, or bug as independent proof of future reuse.
5. Use compacted structural views on clusters where the actual command/tool sequence matters.
6. Use semantic summaries only on sessions that survive the metadata and cluster triage.
7. Pull raw transcripts only as a last resort when compactors cannot answer a specific evidence question.

For broad scans, split candidate session clusters into batches and use sub-agents to analyze each batch for skill candidates. The main agent owns final synthesis, removes duplicates, rejects non-skill proposals, and enforces the cap of 6 recommendations. If sub-agents are unavailable, process the same batches sequentially and state that fallback.

## Strict skill bar

Only propose a skill when all of these are true:

- **Distinct-workflow evidence:** the workflow appears across separate tasks, not merely several sessions working through the same feature, branch, release, or bug.
- **Procedural value:** the skill would tell an agent when and how to act, not just store static facts.
- **Future reuse:** the workflow is likely to recur on unrelated future tasks in this repo.
- **Not already covered:** the workflow is not already easy to follow from `README.md`, package scripts, e2e docs, existing `AGENTS.md` / `CLAUDE.md` / `GEMINI.md` files, `.github` instructions, `.cursor/rules`, existing skills, or nearby source comments.
- **Not better as code:** repeated mistakes caused by missing validation, brittle commands, confusing APIs, or automation gaps should be called out as better solved by code changes or scripts, not forced into a skill.

## Skill vs context vs code

- Recommend a **skill** for repeated procedural workflows: review checklists, release flows, debugging paths, migration steps, deploy sequences, or repo-specific implementation routines.
- Recommend `AGENTS.md` or a nested `AGENTS.md` for static durable context, architecture facts, naming conventions, source-of-truth notes, or "read this before editing this area" guidance.
- Recommend a code/script/test change instead of a skill when the real fix is automation, validation, safer defaults, or clearer command surfaces.

## What to look for

- **Repeated user prompts of the same form** ("set up X", "review Y", "rebuild Z") where an agent skill could define a stable workflow.
- **Repeated debugging paths** where the same files, logs, commands, or checks are inspected before a fix.
- **Repeated implementation flows** where the agent must follow repo-specific conventions, generated-code boundaries, deployment steps, or review criteria.
- **Repeated missed constraints** where past agents made the same mistake and a skill could prevent it.
- **Repeated context reconstruction** that is too procedural for a static context file and better expressed as instructions for when and how to act.

## Rejection pass before final answer

Before writing `## Answer`, make a private rejection pass over every candidate:

- Is this mostly same-feature churn?
- Is this static knowledge that belongs in `AGENTS.md` instead?
- Is it already documented or automated in an obvious place?
- Is it too generic to this repo?
- Would future agents probably use it on unrelated tasks?
- Would code, scripts, tests, or validation solve the issue better than agent instructions?

Only include candidates that survive this pass. If the pass eliminates most or all candidates, say so clearly in the final answer.

## Output format

End your reply with a single `## Answer` heading. Under it, list each proposed skill as its own subsection, ordered by expected time-saving impact. For each:

- **Skill name** — proposed slug
- **Use case** — when a coding agent should load this skill in this repo
- **Trigger** — concrete user requests, file paths, commands, or symptoms that should activate the skill
- **Proposed `SKILL.md` instructions** — concise markdown content for the skill, including the workflow the agent should follow
- **Distinct-workflow evidence** — name 2–4 specific session ids and the recurring pattern they share, showing this is not one repeated feature/debug thread
- **Why this should be a skill** — one sentence explaining why this is procedural agent behavior rather than static `AGENTS.md` context or a code/script fix
- **Expected impact** — one sentence on the time it saves or mistake it prevents

Cap the list at 6 — quality over completeness. If a pattern is real but would be better served by `AGENTS.md`, existing docs, automation, or a code change instead of a coding-agent skill, say so explicitly rather than forcing it into the list.

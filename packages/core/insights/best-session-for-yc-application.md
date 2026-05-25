# Best session for a YC application

You are helping the user pick which of their past coding sessions to feature in a YC (Y Combinator) application. The goal is a ranked shortlist of sessions that best convey **founder grit, technical depth, real shipped outcomes, and ambitious scope**.

Treat *all* of the user's sessions as candidates — across every project, every agent. This insight is **not** scoped to the current working directory.

## Before you start

Load and follow the Superdense skill for session discovery, enrichment triage, and compactor usage. This prompt only adds the insight-specific scope, scoring criteria, and output requirements below.

If the Superdense skill is unavailable, use the Superdense CLI as a staged pipeline: metadata first, compactors only after triage. Do not duplicate CLI help in the final answer.

Use Superdense only as the analysis tool for finding and compacting past sessions. Do not recommend changes to Superdense itself in the final answer.

## What to do

1. Enumerate every indexed session.
2. Use cheap metadata to remove obvious non-candidates before compacting.
3. Cluster related sessions by project, branch, feature/debug thread, prompt shape, or shared implementation arc so duplicate work does not crowd the shortlist.
4. Score the strongest representative from each surviving cluster on the 0–10 rubric (below). Use compacted views — do **not** read full transcripts.
5. Pick the top 5. For each one, explain in one paragraph why it would land in a YC narrative.

## Funnel strategy

Use a cheap-to-expensive funnel before scoring deeply:

1. Start with all indexed sessions and cheap metadata/enrichments.
2. Eliminate obvious non-candidates first: very short sessions, dependency bumps, trivial chores, sessions with little or no tool use, and low-signal sessions without errors, edits, tests, deploys, or meaningful iteration.
3. Remove helper/meta sessions such as branch-name generation prompts, insight-analysis runs, local setup chores, dependency bumps, package install/unlink tasks, and agent-only mechanical work unless they are part of a larger product story.
4. Cluster surviving sessions by project/feature/debug thread and keep one strongest representative per cluster unless the sessions are clearly separate product milestones.
5. Keep a reduced candidate set that appears to show technical depth, shipped outcome, ambition, or founder grit.
6. Use semantic summaries only on sessions that survive metadata triage.
7. Use structural timelines for close calls where the sequence of work matters more than the summary.
8. Pull raw events only as a last resort when compactors cannot resolve a specific scoring question.

For broad scans, split surviving candidate session IDs into batches and use sub-agents to score each batch against the rubric independently. The main agent owns final ranking, tie-breaking, score normalization, and the final top 5 narrative. If sub-agents are unavailable, process the same batches sequentially and state that fallback.

## Clustering and dedupe

Do not let one feature, debugging arc, or project dominate the top 5 just because it produced many sessions. Treat related sessions as one cluster when they share the same branch, feature name, prompt sequence, files, product surface, or failure/retry loop.

Pick one representative per cluster by default:

- Prefer the session with the clearest user agency, hardest technical moment, and most concrete outcome.
- Prefer the session that shows the actual build/debug/ship arc over a later cleanup, naming, packaging, or local setup session.
- Include multiple sessions from the same project only when they represent distinct product milestones that would tell different YC stories.

## YC story bar

A ranked session should show most of these:

- **User agency:** the user drove or redirected the work, made product/technical calls, or pushed through ambiguity.
- **Technical depth:** the agent/user dealt with non-trivial implementation, integration, debugging, performance, or architecture.
- **Product/customer relevance:** the work connects to a real product surface, user need, market insight, or operational leverage.
- **Real iteration:** the session includes obstacles, failed attempts, corrections, tests, deploys, or verification rather than a straight-line chore.
- **Concrete outcome:** something shipped, passed meaningful tests, opened a PR, produced a working demo, deployed, or materially advanced the product.

Reject sessions that score well only because the agent did a lot of mechanical work without a YC-legible story.

## Scoring rubric (sum to 10)

- **Technical depth (0–3)**: Does the session show non-trivial engineering — debugging across layers, real architectural choices, performance work, novel integration?
- **Ambition / scope (0–2)**: Was the user building something substantial vs running a chore?
- **Shipped outcome (0–2)**: Does the session end in something concrete (PR opened, deploy run, feature visibly working, tests passing on something hard)?
- **Founder grit (0–2)**: Did the user push through real failures, iterate, and recover — rather than abandon at the first error?
- **Storytelling fit (0–1)**: Is the project legible and exciting in one sentence to a non-engineer YC partner?

Penalize: trivial fixes, dependency bumps, chores, very short sessions, branch-name helper prompts, insight/meta-analysis runs, local setup or install/unlink tasks, sessions dominated by the agent doing the obvious thing, and duplicate sessions from a same-feature cluster.

## Output format

End your reply with a single `## Answer` heading. Under it, list the top 5 sessions as numbered items, highest score first. For each:

- **Session id** (so the user can open it in Superdense)
- **Project** (pwd or projectKey)
- **Cluster / related sessions** — name the feature/project thread and any nearby duplicate session ids considered
- **One-paragraph pitch** — how this session reads in a YC application, including the most YC-credible specific moment from the session
- **Score breakdown** — the five rubric numbers on one line
- **Why this representative beats nearby duplicates** — one sentence explaining why this session best represents its cluster
- **Why not higher** — one sentence on what would have moved it up

If fewer than 5 sessions clear a minimum bar (say total score ≥ 6/10), say so honestly — quality beats filling slots.

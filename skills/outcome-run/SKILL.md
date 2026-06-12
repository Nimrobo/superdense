---
name: outcome-run
version: 0.1.0
description: Run one intervention in an outcome-loop folder. Use when the user wants to execute the outcome loop, start with Superdense reward maintenance, choose one intervention, create runs/<run-id>/work.md and learnings.md, or use prior outcomes to improve a real-world metric.
---

# Outcome Run

Run one intervention for one outcome folder. The run folder records work references and learning; Superdense records durable sessions, artifacts, externalization targets, and reward snapshots.

Read `references/outcome-loop.md` before starting.

## Workflow

1. Locate the outcome folder and read `goal.md` and `run.md`. If either is missing, stop and use `outcome-setup`.
2. Start with Superdense reward maintenance:
   - Spawn a bounded subagent when the runtime supports it and the invocation permits subagents.
   - Prefer a lower-cost or lower-reasoning subagent only when it is still capable of correct curation, finalization, reconciliation, and collection.
   - If subagents are unavailable, run the same preflight locally.
3. Give the reward preflight this job:
   - run `superdense reward status`,
   - advance one bounded actionable batch when status selects `profile`, `curate`, `finalize`, `reconcile`, or `collect`,
   - use the stage references under `superdense/reward/`,
   - do not perform irreversible external actions,
   - surface relevant `compare` cohorts or chains for the current outcome,
   - return an evidence packet with actions taken, IDs, prior reward evidence, and blockers.
4. Use `goal.md`, `run.md`, and the evidence packet to choose exactly one intervention unless the user explicitly asks for exploration only.
5. Create `runs/<run-id>/` using a stable date-plus-slug id. Write:
   - `work.md`
   - `learnings.md`
6. Execute the intervention in the correct surface:
   - for content outcomes, the run folder may contain drafts or final copy,
   - for product outcomes, edit the target repo and record branch, PR, deploy, event names, and session IDs in `work.md`.
7. Do not create `metrics.md`. If a metric needs to be captured, record it through Superdense reward commands. If blocked, record the blocker in `work.md`.
8. Do not append outcome interpretation back into old run folders. Current runs learn from prior outcomes and their own execution.

## Reward Preflight Prompt

Use this when spawning a subagent:

```text
You are the reward-maintenance agent for an outcome-loop run.

Read the outcome folder's goal.md and run.md. Run `superdense reward status` and advance only one bounded actionable Superdense reward batch if needed. Use the relevant `superdense/reward/*.md` reference. You may mutate local Superdense reward state, but you must not perform irreversible external actions or publish anything externally. Prefer indexed metadata and Superdense commands over raw session logs.

Then surface comparable cohorts or version chains relevant to this outcome. Return a compact evidence packet: status, actions taken, artifact/session/target IDs, prior reward evidence, blockers, and what the main agent should consider before choosing the next intervention.
```

## Completion

Finish with the run id, work references, changed files or external surfaces, Superdense IDs recorded, validation performed, and the main learning.

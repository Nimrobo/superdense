---
name: outcome-run
version: 0.3.0
description: Run one action in an outcome-loop folder. Use when the user wants to execute the outcome loop, start with Superdense reward maintenance, choose one action on a lever, create runs/<run-id>/work.md and learnings.md, or use prior outcomes to improve a real-world metric.
---

# Outcome Run

Run one action for one outcome folder. An action is one concrete step on a lever, whether a rep of a proven recipe or a fix to something in the path. The run folder records work references and learning; Superdense records durable sessions, artifacts, externalization targets, and reward snapshots.

Read `references/outcome-loop.md` before starting.

## Workflow

1. Locate the outcome folder and read `goal.md`, `run.md`, and `gate.md`. If any are missing, stop and use `outcome-setup` to repair the folder contract.
2. Start with Superdense reward maintenance and search-state refresh:
   - Spawn a bounded subagent when the runtime supports it and the invocation permits subagents.
   - Prefer a lower-cost or lower-reasoning subagent only when it is still capable of correct curation, finalization, reconciliation, and collection.
   - If subagents are unavailable, run the same preflight locally.
3. Give the preflight the Reward Preflight Prompt below, filling in `<outcome-folder>`. The prompt is the full job specification.
4. Refresh the lever portfolio in `run.md` from the evidence packet when the evidence clearly changes pull count, reward summary, uncertainty, last-pulled, status, or Pareto-best dimension. Do not flatten multidimensional reward into one scalar.
5. Render due experiment verdicts with `superdense experiment verdict <id>` when target reps are met and the reward window is mature. Surface refuted hypotheses with `superdense hypothesis list --project <project-id> --status refuted` as "what not to try" before choosing a new action.
6. Use `goal.md`, `run.md`, `gate.md`, open hypotheses/experiments, refuted hypotheses, and the evidence packet to choose exactly one action unless the user explicitly asks for exploration only. First set `Mode: explore` or `Mode: exploit` from the Selection Policy.
7. For `explore`, record a structured falsifiable hypothesis with `superdense hypothesis record` unless an open suitable hypothesis already exists. Open or extend an experiment with `superdense experiment open` and later `superdense experiment add-member`. For `exploit`, cite the supported hypothesis and experiment that justify the proven lever.
8. Create `runs/<run-id>/` using a stable date-plus-slug id. Use the `## Run Record Template` in `run.md` as the source of truth. Write:
   - `work.md`
   - `learnings.md`
9. Execute the action in the correct surface:
   - for content outcomes, the run folder may contain drafts or final copy,
   - for product outcomes, edit the target repo and record branch, PR, deploy, event names, and session IDs in `work.md`.
10. After the shipped artifact exists or the run has a stable artifact id, attach the run/artifact to the experiment with `superdense experiment add-member`. Record `Mode`, `Hypothesis id`, and `Experiment id` in `work.md`.
11. Before completion, apply `gate.md`:

- run each `pre` required or warning check before an irreversible real-world action when phasing is present,
- run each `post` or unlabeled required and warning check that can be evaluated locally,
- run deterministic commands listed in `gate.md` when present,
- if no checks are configured, record `Overall: pass` and `Checks run: none`,
- record all pass, warn, and fail outcomes in `work.md` under `## Gate Status`,
- if a required check fails, try to fix it inside the current run and re-run the relevant check.

12. If a required gate still fails after fix attempts, set the run status to failed or blocked, record the unresolved failure and attempted fixes in `work.md`, and stop without presenting the run as complete.
13. Do not create `metrics.md`, `hypotheses.md`, or `experiments.md`. If a metric needs to be captured, record it through Superdense reward commands. If blocked, record the blocker in `work.md` under `## Blockers`.
14. Do not append outcome interpretation back into old run folders. Current runs learn from prior outcomes and their own execution.

## Reward Preflight Prompt

Use this when spawning a subagent (or follow it directly when running locally):

```text
You are the reward-maintenance agent for an outcome-loop run.

Outcome folder: <outcome-folder>

Read `<outcome-folder>/goal.md`, `<outcome-folder>/run.md`, and `<outcome-folder>/gate.md`. Resolve the outcome's Superdense project id from the target surfaces, the folder project key, or a global `superdense reward status` discovery fallback. Run `superdense reward status --project <project-id>` before project-sensitive maintenance.

Advance each actionable stage for that project in pipeline order: `profile`, `curate`, `finalize`, `reconcile`, then `collect`. Run one bounded batch per actionable stage, re-running scoped status between stages, and stop on blockers. Use the relevant `superdense/reward/*.md` reference under the installed skills root. You may mutate local Superdense reward state, but you must not perform irreversible external actions or publish anything externally. Prefer indexed metadata and Superdense commands over raw session logs.

Then surface comparable cohorts or version chains relevant to this outcome. List open/supported/refuted hypotheses and open experiments for the project with `superdense hypothesis list --project <project-id>` and `superdense experiment list --project <project-id>`. If an experiment is due for evaluation, run `superdense experiment verdict <id>` and include the result. Return a compact evidence packet: status, actions taken, artifact/session/target IDs, prior reward evidence, hypothesis/experiment ids and statuses, blockers, and what the main agent should consider before choosing the next action.
```

## Completion

Finish with the run id, mode, hypothesis id, experiment id, work references, changed files or external surfaces, Superdense IDs recorded, validation performed, gate status, and the main learning. If a required gate remains failing, finish by reporting the failed gate and reason instead of calling the run complete.

---
name: outcome-run
version: 0.4.0
description: Run one action in an outcome-loop folder. Use when the user wants to execute the outcome loop, start with Superdense reward maintenance, choose one action on a lever, create runs/<run-id>/work.md and learnings.md, or use prior outcomes to improve a real-world metric.
---

# Outcome Run

Run one action for one outcome folder. An action is one concrete step on a lever, whether a rep of a proven recipe or a fix to something in the path. The run folder records work references and learning; Superdense records durable sessions, artifacts, externalization targets, and reward snapshots.

Read `references/outcome-loop.md` and `references/preflight.md` before starting.

## Workflow

1. Locate the outcome folder and read `goal.md`, `run.md`, and `gate.md`. If any are missing, stop and use `outcome-setup` to repair the folder contract.
2. Start with the bounded reward preflight. `references/preflight.md` is the full job specification:
   - Spawn a bounded subagent when the runtime supports it and the invocation permits subagents.
   - Prefer a lower-cost or lower-reasoning subagent only when it is still capable of correct, bounded maintenance.
   - If subagents are unavailable, run the same preflight locally.
3. Run the preflight per `references/preflight.md`, filling in `<outcome-folder>`. It plans the maintenance pipeline with one `superdense reward next --project <id> --items 10` call, advances each returned step in one bounded batch up to the budgeted item count, and returns a compact evidence packet. `reward next` retires matured targets itself (linked and non-located) and returns the project name and roots, so no separate retire call is needed. It stays on already-external active targets and the current run; it does not drain the internal backlog.
4. Refresh the lever portfolio in `run.md` from the evidence packet when the evidence clearly changes pull count, reward summary, uncertainty, last-pulled, status, or Pareto-best dimension. Do not flatten multidimensional reward into one scalar.
5. Render due experiment verdicts with `superdense experiment verdict <id>` when target reps are met and the reward window is mature. Surface refuted hypotheses with `superdense hypothesis list --project <project-id> --status refuted` as "what not to try" before choosing a new action.
6. Surface comparable cohorts and version chains yourself — this is the run agent's job, not the preflight's. Start with `superdense cohort list --project <project-id> --by type` and inspect relevant version chains; keep it compact and project-scoped. Use them to inform the next action.
7. Use `goal.md`, `run.md`, `gate.md`, open hypotheses/experiments, refuted hypotheses, cohort/chain comparison, and the evidence packet to choose exactly one action unless the user explicitly asks for exploration only. First set `Mode: explore` or `Mode: exploit` from the Selection Policy.
8. For `explore`, record a structured falsifiable hypothesis with `superdense hypothesis record` unless an open suitable hypothesis already exists. Open or extend an experiment with `superdense experiment open` and later `superdense experiment add-member`. For `exploit`, cite the supported hypothesis and experiment that justify the proven lever.
9. Create `runs/<run-id>/` using a stable date-plus-slug id. Use the `## Run Record Template` in `run.md` as the source of truth. Write:
   - `work.md`
   - `learnings.md`
10. Execute the action in the correct surface:
    - for content outcomes, the run folder may contain drafts or final copy,
    - for product outcomes, edit the target repo and record branch, PR, deploy, event names, and session IDs in `work.md`.
11. After the shipped artifact exists or the run has a stable artifact id, attach the run/artifact to the experiment with `superdense experiment add-member`. Record `Mode`, `Hypothesis id`, and `Experiment id` in `work.md`.
12. Before completion, apply `gate.md`:

- run each `pre` required or warning check before an irreversible real-world action when phasing is present,
- run each `post` or unlabeled required and warning check that can be evaluated locally,
- run deterministic commands listed in `gate.md` when present,
- if no checks are configured, record `Overall: pass` and `Checks run: none`,
- record all pass, warn, and fail outcomes in `work.md` under `## Gate Status`,
- if a required check fails, try to fix it inside the current run and re-run the relevant check.

12. If a required gate still fails after fix attempts, set the run status to failed or blocked, record the unresolved failure and attempted fixes in `work.md`, and stop without presenting the run as complete.
13. Do not create `metrics.md`, `hypotheses.md`, or `experiments.md`. If a metric needs to be captured, record it through Superdense reward commands. If blocked, record the blocker in `work.md` under `## Blockers`.
14. Do not append outcome interpretation back into old run folders. Current runs learn from prior outcomes and their own execution.

## Reward Preflight

The preflight is specified in full in `references/preflight.md`. Spawn it as a
bounded subagent (or follow it directly when subagents are unavailable), filling
in `<outcome-folder>`. In one `superdense reward next --project <id> --items 10`
call it plans the maintenance pipeline (`profile -> curate -> finalize ->
reconcile -> collect`, never `compare`), advances each step in one bounded batch
up to the budgeted item count, and returns a compact evidence packet. `reward
next` retires matured targets itself (linked and non-located), so no separate
retire call is needed. It stays
on already-external active targets and the current run, and never drains the
internal backlog. Comparison stays with the main run agent (step 6).

## Completion

Finish with the run id, mode, hypothesis id, experiment id, work references, changed files or external surfaces, Superdense IDs recorded, validation performed, gate status, and the main learning. If a required gate remains failing, finish by reporting the failed gate and reason instead of calling the run complete.

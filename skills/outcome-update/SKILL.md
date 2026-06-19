---
name: outcome-update
version: 0.3.0
description: Improve an existing outcome loop playbook from prior runs and Superdense reward evidence. Use when the user wants observer-mode analysis, macro workflow improvements, run.md updates, lever-map refinement, diagnostics improvements, or efficiency fixes for future outcome runs.
---

# Outcome Update

Update only the reusable playbook and completion gate for an outcome loop. This is observer mode: inspect prior runs and Superdense reward evidence, then improve `run.md` and, when repeated misses show a reusable completion gap, `gate.md` for future runs.

Read `references/outcome-loop.md` before editing.

## Workflow

1. Locate the outcome folder and read `goal.md`, `run.md`, `gate.md`, and `runs/`.
2. Identify runs since `## Update Marker` in `run.md`. If no marker exists, review all completed run folders and add `## Update Marker` after updating.
3. Inspect Superdense evidence related to those runs:
   - session IDs listed in `work.md`,
   - artifact IDs,
   - externalization target IDs,
   - relevant cohorts or version chains,
   - reward snapshots already stored in Superdense.
   - hypotheses and experiments referenced in `work.md`,
   - open/refuted/supported hypotheses from `superdense hypothesis list --project <project-id>`,
   - open or due experiments from `superdense experiment list --project <project-id>`.
4. Look for macro improvements:
   - levers that seem weak, strong, or under-instrumented,
   - lever statuses to promote, exhaust, retire, or keep because they are Pareto-best on a non-headline reward dimension or guardrail,
   - realized explore/exploit mix versus the target ratio,
   - hypotheses that should be pruned from future selection because they were refuted,
   - experiments that need more reps, are due for verdict, or are inconclusive because instrumentation is missing,
   - novelty gaps in untested lever regions,
   - actions that repeatedly create friction,
   - missing preflight checks,
   - repeated required-gate failures or warning misses,
   - diagnostic measurements that explain the north star poorly,
   - target repo/account workflow gaps,
   - Superdense reward-layer bottlenecks.
5. Render due verdicts with `superdense experiment verdict <id>` when an experiment has enough reps and a mature reward window. Use verdicts to update lever status and the Selection Policy, but do not duplicate reward snapshots into markdown.
6. Retune the target explore ratio in `run.md` as evidence accumulates: higher when uncertainty and novelty gaps dominate, lower when a proven lever has headroom and supported hypotheses.
7. Edit `run.md` for playbook improvements and `gate.md` for reusable completion checks or failure-policy refinements. Do not edit `goal.md`, old run folders, or target repos. Do not create a new run.
8. Keep `goal.md` protected. If evidence suggests the north star or guardrails are wrong, add a clearly marked "Recommended goal review" section to `run.md` instead of changing `goal.md`.
9. Preserve useful existing playbook content. Make focused improvements that the next `outcome-run` can execute without guessing.
10. Update `## Update Marker` in `run.md` to the latest reviewed run id or timestamp.
11. Commit the playbook and gate changes, for example `git add run.md gate.md && git commit -m "outcome: update playbook (runs through <marker>)"`. If any reviewed `runs/<run-id>/` files are still uncommitted, include them in the same commit.

## Rules

- Do not create `metrics.md`.
- Do not create `hypotheses.md` or `experiments.md`; use Superdense commands for durable prediction and verdict state.
- Do not duplicate Superdense reward snapshots into markdown.
- Do not run a new action.
- Do not perform external publishing or irreversible external actions.
- Do not treat `gate.md` as a per-run checklist; update it only when future runs need a better reusable completion contract.
- Prefer Superdense metadata and compactors before raw session logs.
- Do not amend or rewrite prior commits. Each update is an append-only commit, matching the append-only lineage principle.

## Completion

Report what changed in `run.md` and `gate.md`, which runs and Superdense evidence informed the update, any verdicts rendered, lever promotions/retirements, explore-ratio changes, the new update marker, and any recommended human review of `goal.md`.

---
name: outcome-update
version: 0.1.0
description: Improve an existing outcome loop playbook from prior runs and Superdense reward evidence. Use when the user wants observer-mode analysis, macro workflow improvements, run.md updates, lever-map refinement, diagnostics improvements, or efficiency fixes for future outcome runs.
---

# Outcome Update

Update only the reusable playbook for an outcome loop. This is observer mode: inspect prior runs and Superdense reward evidence, then improve `run.md` for future runs.

Read `references/outcome-loop.md` before editing.

## Workflow

1. Locate the outcome folder and read `goal.md`, `run.md`, and `runs/`.
2. Identify runs since `## Update Marker` in `run.md`. If no marker exists, review all completed run folders and add `## Update Marker` after updating.
3. Inspect Superdense evidence related to those runs:
   - session IDs listed in `work.md`,
   - artifact IDs,
   - externalization target IDs,
   - relevant cohorts or version chains,
   - reward snapshots already stored in Superdense.
4. Look for macro improvements:
   - levers that seem weak, strong, or under-instrumented,
   - actions that repeatedly create friction,
   - missing preflight checks,
   - diagnostic measurements that explain the north star poorly,
   - target repo/account workflow gaps,
   - Superdense reward-layer bottlenecks.
5. Edit `run.md` only. Do not edit `goal.md`, old run folders, or target repos. Do not create a new run.
6. Keep `goal.md` protected. If evidence suggests the north star or guardrails are wrong, add a clearly marked "Recommended goal review" section to `run.md` instead of changing `goal.md`.
7. Preserve useful existing playbook content. Make focused improvements that the next `outcome-run` can execute without guessing.
8. Update `## Update Marker` in `run.md` to the latest reviewed run id or timestamp.
9. Commit the playbook change, for example `git add run.md && git commit -m "outcome: update playbook (runs through <marker>)"`. If any reviewed `runs/<run-id>/` files are still uncommitted, include them in the same commit.

## Rules

- Do not create `metrics.md`.
- Do not duplicate Superdense reward snapshots into markdown.
- Do not run a new action.
- Do not perform external publishing or irreversible external actions.
- Prefer Superdense metadata and compactors before raw session logs.
- Do not amend or rewrite prior commits. Each update is an append-only commit, matching the append-only lineage principle.

## Completion

Report what changed in `run.md`, which runs and Superdense evidence informed the update, the new update marker, and any recommended human review of `goal.md`.

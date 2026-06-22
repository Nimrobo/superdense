# Reward Preflight

Run this reward-maintenance step at the start of each `outcome-run`. The job is
to leave the current run with fresh, trustworthy reward evidence — not to drain
Superdense's entire history. This file is the single source of truth for the
preflight; `outcome-run` and `outcome-loop.md` point here.

Run as a bounded subagent when the runtime supports subagents, otherwise follow
these steps directly. You may mutate local Superdense reward state in bounded
batches, but never perform irreversible external actions or publish anything
externally.

## Steps

1. Read `<outcome-folder>/goal.md`, `<outcome-folder>/run.md`, and
   `<outcome-folder>/gate.md`.
2. Resolve the outcome's Superdense project id from the `goal.md` target
   surfaces, the folder project key, or a global `superdense reward status`
   discovery fallback.
3. Plan the maintenance pipeline in **one** call (`--project` is required):

   ```bash
   superdense reward next --project <project-id> --items 10
   ```

   `reward next` returns the actionable maintenance steps already sequenced
   (`profile -> curate -> finalize -> reconcile -> collect`), each with its start
   command, total `actionable` count, and the `take` (how many items to process
   now). `--items` budgets actionable items across the whole pipeline (default
   10), walked stage by stage. The result also carries `projectName` and
   `projectRoots` (the project's filesystem location — use these instead of
   resolving the location separately) and `lastRunAt` (when the preflight last
   ran). `reward next` also **retires matured targets first** — linked collect
   targets past their window and non-located reconcile targets older than 7 days
   — so the counts reflect the live set; do **not** invoke retire separately. Do
   **not** re-run `superdense reward status` between every stage — `reward next`
   has already ordered them. It also excludes `compare` on purpose: comparison is
   the main run agent's job, not the preflight's.

4. Execute **one bounded batch per returned step**, in order, using the matching
   `superdense/reward/*.md` reference and the step's `take` as the limit. Re-plan
   with `reward next` only if a step meaningfully changes what is actionable.
   Stop on blockers.

5. During the `collect` step, `reward next` has already retired matured targets,
   so collect only the still-active linked targets returned by
   `superdense externalization list --project <project-id> --status linked`
   (active-only by default; see `superdense/reward/collect.md`).

6. Surface hypotheses and experiments for the project:

   ```bash
   superdense hypothesis list --project <project-id>
   superdense experiment list --project <project-id>
   ```

   If an experiment is due for evaluation, run `superdense experiment verdict <id>`
   and include the result.

## External vs internal: do not go back in time

Stay on the current run's critical path. The distinction that keeps the preflight
bounded:

- **External** = an artifact with a `linked`, `active` externalization target. It
  can receive reward snapshots and is collectable. Collecting reward for these is
  the preflight's real job.
- **Internal** = an artifact with no linked target (`unprocessed` or
  `not_external`), or whose targets are `retired`. Re-curating, finalizing, or
  reconciling historical internal artifacts is **backlog maintenance**, off the
  per-run critical path.

Rules:

- Work only on the **current run's** artifacts and **already-external, active**
  targets. Do not walk the internal backlog "back in time."
- `reward next --items` bounds how far the plan reaches, and its built-in
  retirement bounds the collectable and reconcile sets. Trust it — do not drain
  page after page.
- If the maintenance backlog is large (many actionable curate/finalize/reconcile
  items unrelated to this run), surface it as a blocker in the evidence packet
  rather than draining it here. Dedicated reward upkeep belongs in
  `outcome-update` or a deliberate maintenance pass, not in a time-sensitive run.

## What to return

A compact evidence packet for the main run agent:

- reward status summary and `reward next` plan (what was actionable)
- completed maintenance actions and the IDs they touched
  (artifact / session / externalization target ids)
- prior reward evidence relevant to this outcome
- open, supported, refuted, and inconclusive hypotheses for the project
- due or nearly due experiments and any verdict results
- blockers and unresolved external access (including any large backlog
  deliberately not drained)

Comparable cohorts and version chains are **not** part of the preflight packet —
the main run agent surfaces those itself when choosing the next action.

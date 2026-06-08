# Compare

Layer 5 closes the loop. Before producing a new deliverable, look at what you have shipped before of the same kind, what the contributor runs cost, and how the work actually performed in the real world. Superdense only surfaces the comparable bundle: the artifact payload, its lineage, contributor cost, linked external identities, and reward time series. It never ranks or picks a best. You compare and judge.

## Workflow

1. See what is comparable:

   ```bash
   superdense cohort list                 # peer cohorts grouped by artifact type
   superdense cohort list --by connector  # within-platform cohorts, e.g. launches on "x"
   ```

   Each summary gives `{ type, connector, artifactCount, externalizedCount, withRewardsCount }`.

2. Surface the cohort relevant to the current task:

   ```bash
   superdense cohort show <type>               # all peers of this type
   superdense cohort show <type> --connector x # only those linked on a platform
   ```

   Each member carries the full bundle: `artifact` with frozen `payload`, effective lineage `sessions`, append-only `lineageEvents`, and `headSessionId`; `cost` with per-contributor session costs and the total including sub-agent work; `externalization` connector targets; and `rewards` per linked target with `locator`, latest snapshot, and full `snapshots` series.

3. To ask "did my change actually help?", surface a deliverable next to its own earlier versions:

   ```bash
   superdense cohort chains
   superdense cohort chain <artifact-id>
   ```

   The chain is ordered oldest first and includes each version's cost and rewards.

4. Compare the surfaced members yourself. Read the payloads and reward series side by side, decide which prior approach performed and why. Pull that work into the current run as context: open its `headSessionId` or read its `payload`, and let it inform what you produce now.

## Rules

- Superdense surfaces, never ranks. There is no score and no winner; comparison is your job.
- Cohorts are cross-project by default; add `--project <id>` only to narrow to one project.
- Grouping is by the `artifact_type` string the finalizer chose; only matching strings co-locate.
- Cost comes from stored `session_cost` enrichments over contributor sessions and includes their sub-agent trees. Treat missing `cost.totalCostingWithSubagents` as not yet priced or indexed, not as zero.
- Reward numbers come from Layer 4 snapshots. Treat a member with no `rewards` as shipped but not yet measured, not as failed.
- This is a read-only stage. It does not create, finalize, externalize, or record anything.

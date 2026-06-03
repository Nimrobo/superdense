---
name: superdense-cohort-compare
version: 0.1.0
description: Surface comparable prior Superdense artifacts with their real-world outcomes so the agent can pull what actually worked into the current run.
allowed-tools: Bash(superdense *)
---

# Superdense Cohort Compare

Layer 5 closes the loop. Before producing a new deliverable, look at what you've shipped before of
the same kind and **how it actually performed in the real world**, then carry the approach that worked
into the current run. Superdense only *surfaces* the comparable bundle — the artifact payload, its
lineage, its linked external identities, and its reward time series. **It never ranks or picks a
"best." You compare and judge.**

## Workflow

1. See what is comparable:

   ```bash
   superdense cohort list                 # peer cohorts grouped by artifact type
   superdense cohort list --by connector  # within-platform cohorts (e.g. launches on "x")
   ```

   Each summary gives `{ type, connector, artifactCount, externalizedCount, withRewardsCount }`.

2. Surface the cohort relevant to the current task:

   ```bash
   superdense cohort show <type>                  # all peers of this type
   superdense cohort show <type> --connector x     # only those linked on a platform
   ```

   Each member carries the full bundle: `artifact` (frozen `payload` + effective lineage `sessions` +
   append-only `lineageEvents` + `headSessionId`), `externalization` (connector targets), and
   `rewards` (per linked target: `locator`, `latest` snapshot, full `snapshots` series).

3. To ask "did my change actually help?", surface a deliverable next to its own earlier versions:

   ```bash
   superdense cohort chains            # deliverables that evolved across >= 2 versions
   superdense cohort chain <artifact-id>   # v1 -> v2 -> v3, oldest first, with each version's rewards
   ```

4. Compare the surfaced members yourself — read the payloads and the reward series side by side, decide
   which prior approach performed and why. Pull that work into the current run as context: open its
   `headSessionId` or read its `payload`, and let it inform what you produce now.

## Rules

- Superdense **surfaces, never ranks.** There is no score, no "winner" — comparison is your job.
- Cohorts are cross-project by default; add `--project <id>` only to narrow to one project.
- Grouping is by the `artifact_type` string the finalizer chose; only matching strings co-locate.
- Reward numbers come from Layer 4 snapshots; treat a member with no `rewards` as "shipped but not yet
  measured," not as "failed."
- This is a read-only skill. It does not create, finalize, externalize, or record anything.

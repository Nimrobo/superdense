---
name: superdense-cohort-compare
version: 0.1.0
description: Surface comparable prior Superdense artifacts with their real-world outcomes so the agent can pull what actually worked into the current run.
---

# Superdense Cohort Compare

Use this skill before producing a new deliverable to see how your past work of the same kind actually
performed, then carry the approach that worked into the current run. Superdense only *surfaces* the
comparable bundle; it never ranks or picks a "best" — you compare and judge.

1. See what is comparable: `superdense cohort list` (peers by `artifact_type`) or
   `superdense cohort list --by connector` (within-platform). Each summary gives
   `{ type, connector, artifactCount, externalizedCount, withRewardsCount }`.
2. Surface the relevant cohort: `superdense cohort show <type>` (add `--connector <c>` to restrict to
   one platform). Each member carries `artifact` (frozen `payload` + lineage `sessions` +
   `lineageEvents` + `headSessionId`), `externalization` (targets), and `rewards` (per linked target:
   `locator`, `latest`, full `snapshots` series).
3. To ask "did my change help?", surface a deliverable next to its own versions:
   `superdense cohort chains` then `superdense cohort chain <artifact-id>` (v1→v2→v3, oldest first).
4. Compare the members yourself — read payloads and reward series side by side, decide what performed,
   then pull that work into the current run (open its `headSessionId` / read its `payload`).

Rules: surfaces, never ranks (no score). Cross-project by default; add `--project <id>` to narrow.
Grouping is by the exact `artifact_type` string. A member with no `rewards` is "shipped but not yet
measured," not "failed." Read-only: it creates, finalizes, externalizes, and records nothing.

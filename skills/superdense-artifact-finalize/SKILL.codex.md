---
name: superdense-artifact-finalize
version: 0.2.0
description: Process the Superdense ready queue and create stable local artifact records without requiring manual thread selection.
---

# Superdense Artifact Finalize

Use this skill when the user invokes `/superdense-artifact-finalize`.

This is Layer 3B: process one bounded ready queue and create stable local artifact records. It does
not bind external systems (no connectors, published identity, or rewards; that is Layer 4).

1. Run `superdense artifact inbox --limit 10`.
2. For each ready thread, run `superdense thread show <thread-id>` and inspect relevant sessions
   with `superdense curation context <root-session-id>`.
3. If indexed context is insufficient, escalate narrowly with `superdense session show`,
   `superdense session enrichments`, `superdense compactor run salience`, then
   `superdense compactor run trace`. Use `superdense session path` only as a last resort.
4. If the thread clearly represents one produced output, create its record with
   `superdense artifact finalize --input '<json>'`, choosing an open-vocabulary `type`, a `title`,
   and a stable `payload`:
   - file-backed: `{"threadId":"<id>","type":"feature","title":"…","payload":{"files":["src/x.ts"]}}`
   - session-only: `{"threadId":"<id>","type":"tweet","title":"…","payload":{"text":"…"}}`
5. If the output remains ambiguous, reopen the thread:
   `superdense curation apply --input '{"actions":[{"type":"thread.reopen","threadId":"<id>","rationale":"<why more curation is needed>"}]}'`.
6. Confirm created records with `superdense artifact show <thread-id>`. Stop after the bounded
   queue and report the remaining count.

Rules: payload and artifact identity stay stable after creation; lineage is append-only and may
gain audited `lineage.attach` or `lineage.retract` events later. If the produced output changes,
create a successor thread and pass `predecessorArtifactId` during artifact creation. Never inherit
externalization targets automatically. Never claim deterministic artifact discovery.

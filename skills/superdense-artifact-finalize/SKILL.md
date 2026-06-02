---
name: superdense-artifact-finalize
version: 0.1.0
description: Freeze a finalized Superdense work thread into one immutable Layer 3B artifact, extracting its type and durable payload.
argument-hint: thread-id
allowed-tools: Bash(superdense *)
---

# Superdense Artifact Finalize

Turn one curated work thread into a single immutable artifact. This is Layer 3B: you read what
the thread produced and **extract** the artifact. It does **not** bind external systems — no
connectors, no published identity, no rewards (that is Layer 4).

Arguments: `$ARGUMENTS` (a work-thread id)

## Two steps

1. **Work-thread finalize** locks the thread (curation is complete).
2. **Artifact finalize** extracts the durable artifact from the locked thread.

Once finalized the thread and its lineage are frozen and can no longer be curated.

## Workflow

1. Read the thread and its session memberships:

   ```bash
   superdense thread show <thread-id>
   ```

2. Understand **what was actually produced**. Load per-session evidence — files touched, plan
   refs, and intent — for the thread's root sessions:

   ```bash
   superdense curation context <root-session-id>
   ```

   Decide which work is the deliverable and which is incidental. The deliverable may not be a
   file: a tweet, message, or note can live only in the session transcript.

3. If the thread is still `open`, finalize it (step 1):

   ```bash
   superdense curation apply --input '{"actions":[{"type":"thread.finalize","threadId":"<thread-id>"}]}'
   ```

4. Extract the artifact (step 2). Choose an open-vocabulary `type`, a `title`, and a `payload`
   that durably represents the deliverable:

   ```bash
   # file-backed deliverable
   superdense artifact finalize --input '{"threadId":"<id>","type":"feature","title":"…","payload":{"files":["src/x.ts"]}}'

   # deliverable that lives only in the session (e.g. a tweet)
   superdense artifact finalize --input '{"threadId":"<id>","type":"tweet","title":"…","payload":{"text":"…"}}'
   ```

5. Confirm and report:

   ```bash
   superdense artifact show <thread-id>
   ```

## Rules

- One artifact per thread. If the thread really produced more than one distinct artifact, the
  Layer 3A grouping was wrong — fix the thread before it is finalized.
- The artifact freezes a copy of the thread's lineage (its sessions). The head session is derived
  as the latest contributor.
- `payload` is open JSON: use `{ "files": [...] }`, `{ "text": "..." }`, or a mix. Lineage and
  per-session evidence already live in the database; do not duplicate them into the payload.
- Never claim deterministic artifact discovery. You are extracting the artifact, not detecting it.

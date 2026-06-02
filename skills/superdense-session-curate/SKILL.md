---
name: superdense-session-curate
version: 0.2.0
description: Review a bounded Superdense session-curation inbox, group related work, and queue clear work threads for artifact creation.
argument-hint: project-id
allowed-tools: Bash(superdense *)
---

# Superdense Session Curate

Review one bounded batch of indexed root sessions. This is mutable Layer 3A curation, not
immutable artifact discovery. Never claim deterministic artifact discovery.

Arguments: `$ARGUMENTS`

## Workflow

1. Run incremental indexing:

   ```bash
   superdense index
   ```

2. Fetch the next universal inbox batch, defaulting to 10:

   ```bash
   superdense curation inbox --project <project-id> --limit 10
   ```

   Explicitly marked roots come first, then deliverable roots and the remaining new, changed,
   deferred, and historical backlog.

3. Review likely neighbors together. Use this exact wording:

   > These sessions may be related. Review them together.

4. Load context only when needed:

   ```bash
   superdense curation context <root-session-id>
   superdense thread list --project <project-id>
   superdense thread show <thread-id>
   ```

   If indexed context is insufficient, escalate narrowly for only the relevant sessions:

   ```bash
   superdense session show <session-id>
   superdense session enrichments <session-id>
   superdense compactor run salience <session-id>
   superdense compactor run trace <session-id>
   superdense session path <session-id> # raw source, last resort
   ```

   Prefer metadata first. Use `salience` for the gist, `trace` when ordering matters, and raw
   source only when the compact views cannot answer the question accurately. Read the minimum raw
   source needed.

5. Use profile shapes, plan slugs, branches, intent, time, and distinctive files as retrieval
   hints. For each session, decide whether to attach it to an existing thread, create a new
   thread, skip it, or defer it. Consume useful attached sessions in the same batch. Apply the
   decisions in one atomic batch:

   ```bash
   superdense curation apply --input '<json|@file>'
   ```

6. When one thread represents one identifiable output, queue it:

   ```bash
   superdense curation apply --input '{"actions":[{"type":"thread.mark-ready","threadId":"<id>","rationale":"<why the output is identifiable>"}]}'
   ```

7. Stop after the bounded batch. Report actions, remaining inbox counts, and newly ready threads.
   Tell the user to run `/superdense-artifact-finalize` when the ready queue is non-empty.

## Actions

`curation apply` accepts `{"actions":[...]}` with:

- `thread.create`
- `thread.update`
- `thread.attach`
- `thread.detach`
- `thread.merge`
- `thread.split`
- `thread.mark-ready`
- `thread.reopen`
- `lineage.attach`
- `lineage.retract`
- `session.consume`
- `session.skip`
- `session.defer`

`thread.create` takes `projectProfileId` (required, the canonical project id), `provisionalTitle`
(required), and optional `id` and `summary`. It does not accept `status`.

`session.consume` only changes a session's curation state — it does **not** attach the session to a
thread. To consume a session into a thread, include a separate `thread.attach` (with a `role`) for
it in the **same** batch. A consumed session must be attached to at least one thread or the whole
batch is rejected. Use `contributor` for sessions that changed the work and `evidence` for
supporting investigation or context.

A grouping batch therefore looks like:

```bash
superdense curation apply --input '{"actions":[
  {"type":"thread.create","projectProfileId":"<project-id>","provisionalTitle":"<title>","summary":"<optional>"},
  {"type":"thread.attach","threadId":"<thread-id>","sessionId":"<session-id>","role":"contributor","rationale":"<why>"},
  {"type":"session.consume","sessionId":"<session-id>"}
]}'
```

Artifact payloads are stable after creation, but lineage remains append-only. Use `lineage.attach`
for late evidence and `lineage.retract` to neutralize an incorrect link while preserving audit
history.

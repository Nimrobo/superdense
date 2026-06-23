# Curate

Review one bounded batch of indexed root sessions. This is mutable Layer 3A curation, not immutable artifact discovery. Never claim deterministic artifact discovery.

## Workflow

1. Run incremental indexing:

   ```bash
   superdense index
   ```

2. Fetch the next universal inbox batch, defaulting to 10:

   ```bash
   superdense curation inbox --project <project-id> --limit 10
   ```

   Use the project id reported by `superdense reward status`. Explicitly marked roots come first, then deliverable roots and the remaining new, changed, deferred, and historical backlog.

   Inbox items carry a `kind`. `kind: "session"` items are loose roots to triage as usual. `kind: "thread"` items are **settled open threads** — folders whose sessions are all handled but which were never marked ready, so nothing else would surface them. For each, attach any newly relevant session, then resolve it: `thread.mark-ready` when it represents one identifiable output, `thread.merge` into a sibling, or `thread.discard` when it is an empty folder created by mistake (no attached sessions). Leaving it open is not a resolution — it will keep returning.

   Session items also carry `curationDiagnostic` and `curationProblems`. Treat
   these as explanations for why the root is still in Curate; `curationStatus`
   remains the source of truth. A `partial` diagnostic means prior curation work
   exists but the root was never durably resolved. A `stale` diagnostic means a
   prior decision is obsolete because the indexed session revision changed.

3. Review likely neighbors together. Use this exact wording:

   > These sessions may be related. Review them together.

4. Load context only when needed:

   ```bash
   superdense curation context <root-session-id>
   superdense thread list --project <project-id>
   superdense thread show <thread-id> --full
   ```

   If indexed context is insufficient, follow the shared escalation policy in `reward/README.md`.

5. Use profile shapes, plan slugs, branches, intent, time, and distinctive files as retrieval hints. For each handled root session, end with exactly one durable decision:
   `session.consume` when represented by attached thread/artifact work,
   `session.skip` when it has no reward-relevant output, or `session.defer`
   when it genuinely cannot be resolved yet. Do not treat `curatedAt`,
   existing attached threads, or existing artifacts as completion while the
   root session is still `pending`.

   Apply curation decisions in one atomic batch whenever possible: create or
   update the thread, attach contributor/evidence sessions, mark ready when the
   output is identifiable, and consume/skip/defer the handled root. A partial
   batch that creates threads or artifacts but leaves the source root pending
   will keep returning in Curate.

   ```bash
   superdense curation apply --input '<json|@file>'
   ```

6. When one thread represents one identifiable output, queue it:

   ```bash
   superdense curation apply --input '{"actions":[{"type":"thread.mark-ready","threadId":"<id>","rationale":"<why the output is identifiable>"}]}'
   ```

7. Stop after the bounded batch. Report actions, remaining inbox counts, and newly ready threads. Tell the user to rerun `superdense reward status` when the ready queue is non-empty.

## Human-only outputs

When a real output was created directly by a human and has no contributing agent
session, create a sessionless thread with `humanOnly: true`, describe the evidence
in its summary, and mark it ready in the same atomic curation batch:

```bash
superdense curation apply --input '{
  "actions": [
    {
      "type": "thread.create",
      "id": "human-post-1",
      "projectProfileId": "<project-id>",
      "provisionalTitle": "Manual post",
      "summary": "Written and published directly by the human",
      "humanOnly": true
    },
    {
      "type": "thread.mark-ready",
      "threadId": "human-post-1",
      "rationale": "Final human-authored output and external identity are known"
    }
  ]
}'
```

For hybrid work, attach the real drafting session as a contributor and describe
the human editing in the summary or readiness rationale. Do not set
`humanOnly: true` and do not create synthetic sessions.

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
- `thread.discard`
- `lineage.attach`
- `lineage.retract`
- `session.consume`
- `session.skip`
- `session.defer`

`thread.create` takes `projectProfileId` (required, the canonical project id), `provisionalTitle` (required), and optional `id` and `summary`. It does not accept `status`.

`session.consume` only changes a session's curation state; it does not attach the session to a thread. To consume a session into a thread, include a separate `thread.attach` (with a `role`) for it in the same batch. A consumed session must be attached to at least one thread or the whole batch is rejected. Use `contributor` for sessions that changed the work and `evidence` for supporting investigation or context.

A grouping batch therefore looks like:

```bash
superdense curation apply --input '{"actions":[
  {"type":"thread.create","projectProfileId":"<project-id>","provisionalTitle":"<title>","summary":"<optional>"},
  {"type":"thread.attach","threadId":"<thread-id>","sessionId":"<session-id>","role":"contributor","rationale":"<why>"},
  {"type":"session.consume","sessionId":"<session-id>"}
]}'
```

Artifact payloads are stable after creation, but lineage remains append-only. Use `lineage.attach` for late evidence and `lineage.retract` to neutralize an incorrect link while preserving audit history.

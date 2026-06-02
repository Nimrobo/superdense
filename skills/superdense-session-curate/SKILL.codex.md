---
name: superdense-session-curate
version: 0.2.0
description: Review a bounded Superdense session-curation inbox, group related work, and queue clear work threads for artifact creation.
---

# Superdense Session Curate

Use this skill when the user invokes `/superdense-session-curate <project-id>`.

1. Run `superdense index`.
2. Run `superdense curation inbox --project <project-id> --limit 10`. The inbox is universal:
   every unhandled root is eventually reviewed. Marked sessions come first, followed by
   deliverable sessions and the remaining backlog.
3. Say exactly:

   > These sessions may be related. Review them together.

4. Load only needed details with `superdense curation context <root-session-id>`,
   `superdense thread list --project <project-id>`, and `superdense thread show <thread-id>`.
5. If indexed context is insufficient, escalate narrowly for only the relevant sessions:
   `superdense session show <session-id>`, `superdense session enrichments <session-id>`,
   `superdense compactor run salience <session-id>`, then
   `superdense compactor run trace <session-id>`. Use `superdense session path <session-id>` for
   raw-source access only as a last resort, and read the minimum raw source needed. Prefer
   metadata first; use `salience` for the gist and `trace` when ordering matters.
6. Use profile shapes, plan slugs, branches, intent, time, and distinctive files as retrieval
   hints. Never claim deterministic artifact discovery. For each session, attach it to an
   existing thread, create a new thread, skip it, or defer it. Consume useful attached sessions
   in the same batch.
7. Apply work-thread edits with `superdense curation apply --input '<json|@file>'`. When a thread
   has one identifiable output, queue it with `thread.mark-ready` and a concise rationale.
8. Stop after the bounded batch. Report applied actions, remaining inbox counts, and any newly
   ready threads. Tell the user to run `/superdense-artifact-finalize` when ready threads exist.

Supported actions are `thread.create`, `thread.update`, `thread.attach`, `thread.detach`,
`thread.merge`, `thread.split`, `thread.mark-ready`, `thread.reopen`,
`lineage.attach`, `lineage.retract`, `session.consume`, `session.skip`, and `session.defer`.
A consumed session must belong to at least one thread. Roles are `contributor` and `evidence`.
Artifact payloads are stable after creation, but lineage remains append-only and may receive
audited attach or retract events later.

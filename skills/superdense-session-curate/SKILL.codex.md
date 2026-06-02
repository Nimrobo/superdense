---
name: superdense-session-curate
version: 0.1.0
description: Review a bounded Superdense session-curation inbox and maintain mutable work threads before artifact finalization.
---

# Superdense Session Curate

Use this skill when the user invokes `/superdense-session-curate <project-id>`.

1. Run `superdense index`.
2. Run `superdense curation inbox --project <project-id> --limit 10`.
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
   hints. Never claim deterministic artifact discovery.
7. Apply mutable work-thread edits with `superdense curation apply --input '<json|@file>'`.
8. Stop after the bounded batch and report applied actions plus remaining inbox counts.

Supported actions are `thread.create`, `thread.update`, `thread.attach`, `thread.detach`,
`thread.merge`, `thread.split`, `session.consume`, `session.skip`, and `session.defer`.
A consumed session must belong to at least one thread. Roles are `contributor` and `evidence`.

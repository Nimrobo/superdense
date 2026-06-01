---
name: superdense-session-curate
version: 0.1.0
description: Review a bounded Superdense session-curation inbox and maintain mutable work threads before artifact finalization.
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

2. Fetch the next inbox batch, defaulting to 10:

   ```bash
   superdense curation inbox --project <project-id> --limit 10
   ```

3. Review likely neighbors together. Use this exact wording:

   > These sessions may be related. Review them together.

4. Load context only when needed:

   ```bash
   superdense curation context <root-session-id>
   superdense thread list --project <project-id>
   superdense thread show <thread-id>
   ```

5. Use profile shapes, plan slugs, branches, intent, time, and distinctive files as retrieval
   hints. Create or revise mutable work threads with one atomic batch:

   ```bash
   superdense curation apply --input '<json|@file>'
   ```

6. Stop after the bounded batch. Report the actions applied and the remaining inbox counts.

## Actions

`curation apply` accepts `{"actions":[...]}` with:

- `thread.create`
- `thread.update`
- `thread.attach`
- `thread.detach`
- `thread.merge`
- `thread.split`
- `session.consume`
- `session.skip`
- `session.defer`

A consumed session must be attached to at least one thread. Use `contributor` for sessions
that changed the work and `evidence` for supporting investigation or context.

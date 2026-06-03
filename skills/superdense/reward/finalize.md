# Finalize

Process one bounded Layer 3B ready queue. Curation has already grouped sessions into clear outputs. This stage creates stable local artifact records. It does not bind external systems, publish anything, or collect rewards.

## Workflow

1. Load up to ten ready threads:

   ```bash
   superdense artifact inbox --limit 10
   ```

2. For each item, inspect the thread and only the session evidence needed to understand what it produced:

   ```bash
   superdense thread show <thread-id>
   superdense curation context <root-session-id>
   ```

   If indexed context is insufficient, follow the shared escalation policy in `reward/README.md`.

3. When the thread clearly represents one output, choose an open-vocabulary `type`, a `title`, and a stable `payload`, then create the artifact:

   ```bash
   superdense artifact finalize --input '{"threadId":"<id>","type":"feature","title":"...","payload":{"files":["src/x.ts"]}}'
   superdense artifact finalize --input '{"threadId":"<id>","type":"tweet","title":"...","payload":{"text":"..."}}'
   ```

4. If the output remains ambiguous, reopen the thread for more curation:

   ```bash
   superdense curation apply --input '{"actions":[{"type":"thread.reopen","threadId":"<id>","rationale":"<why more curation is needed>"}]}'
   ```

5. Confirm created records and stop after the bounded queue:

   ```bash
   superdense artifact show <thread-id>
   superdense artifact inbox --limit 10
   ```

## Rules

- Do not ask the user to select a thread ID. Process the ready queue.
- Artifact identity and payload stay stable after creation. Lineage remains append-only and may gain audited `lineage.attach` or `lineage.retract` events later.
- If the produced output changes, create a successor thread and pass `predecessorArtifactId` while creating its artifact. Do not inherit externalization targets automatically.
- Never claim deterministic artifact discovery. The ready queue is agent-confirmed.

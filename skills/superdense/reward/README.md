# Superdense Reward Layer

The reward layer is one agent-driven pipeline:

```text
profile -> curate -> finalize -> reconcile -> collect -> compare
```

Start with:

```bash
superdense reward status
```

Use `superdense reward status --project <id>` to focus the project-sensitive stages. The status output names the next actionable stage; then read that stage reference in this directory and execute only that workflow.

## Shared Inspection Policy

Prefer indexed metadata and structured Superdense commands before raw source. Escalate narrowly, only for sessions or threads whose compact context is insufficient:

```bash
superdense session show <session-id>
superdense session enrichments <session-id>
superdense compactor run salience <session-id>
superdense compactor run trace <session-id>
superdense session path <session-id> # raw source, last resort
```

Use `salience` for the gist and `trace` when ordering matters. Raw session source is last resort only; read the minimum needed to answer the stage question accurately.

## Stage References

| Stage       | Reference             |
| ----------- | --------------------- |
| `profile`   | `reward/profile.md`   |
| `curate`    | `reward/curate.md`    |
| `finalize`  | `reward/finalize.md`  |
| `reconcile` | `reward/reconcile.md` |
| `collect`   | `reward/collect.md`   |
| `compare`   | `reward/compare.md`   |

## Helper References

| Helper                              | Command                                                                       | Use when                                       |
| ----------------------------------- | ----------------------------------------------------------------------------- | ---------------------------------------------- |
| Artifact types                      | `superdense reward docs artifacts`                                            | Choosing `artifactShapes[].type` or `type`.    |
| Artifact connectors                 | `superdense reward docs connectors --artifact <type>`                         | Choosing connector candidates for an artifact. |
| Connector usage                     | `superdense reward docs connectors --connector <name>`                        | Collecting snapshots for a linked target.      |
| External platform install/auth help | `superdense reward docs connectors --connector <name> --section install`      | Resolving `needs_connector` targets.           |
| Connector troubleshooting           | `superdense reward docs connectors --connector <name> --section troubleshoot` | Recovering from collection failures.           |

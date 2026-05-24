---
name: superdense
version: 0.1.0
description: Find & read context prior AI-agent sessions. Use when the user asks about previous or other agent runs, needs context from earlier work, wants to understand what happened, compare attempts, audit decisions/tools/errors, or access the original session record.
---

# Superdense Stored Sessions

## Concepts

- **Session** — one stored agent run, identified by `<adapter>:<sessionId>` (e.g. `codex:abc-123`).
- **Index** — local SQLite catalog of discovered sessions and their enrichments. `superdense index` rescans adapter directories, runs enrichers on new/changed sessions (version-checked, idempotent), and re-evaluates saved queries.
- **Enrichment** — precomputed metadata attached to a session and stored in the index. Produced during `superdense index`; cheap to read.
- **Compactor** — on-demand view that re-reads the session log and prints to stdout. Only `salience` (gist) and `trace` (timeline).

## Workflow

Use the CLI as a staged inspection pipeline: candidate discovery → triage with metadata/enrichments → compact only what's relevant.

**Precondition.** Refresh the index only when the user asks about recent/latest work, new sessions may have appeared, or results look stale:

```bash
superdense index
```

1. Find candidate sessions. Pick the discovery path that matches the search:

   - `superdense session list --q "text"` — substring search across **first prompt, summary, and working directory** only (case-insensitive `LIKE`). Use for quick keyword/topic/pwd hits.

     ```bash
     superdense session list --q "search text" --limit 20
     ```

   - `superdense query` — use whenever the search needs a field `--q` doesn't cover: agent, project, time bounds, `hasErrors`, `toolUsed`, `cliUsed`, `eventCount`, transcript filters, or any `and`/`or`/`not` combinator. Ad hoc, not saved:

     ```bash
     superdense query --query '<query-json>' --limit 20
     superdense query --query @query.json --limit 20
     ```

   - `superdense saved-query` — use only when the user names an existing reusable cohort or asks to persist one:

     ```bash
     superdense saved-query list
     superdense saved-query run <query-id> --limit 20
     superdense saved-query save --name "name" --query '<query-json>'
     superdense saved-query save --name "name" --query @query.json
     ```

2. Triage candidates before compacting. Prefer session metadata and existing enrichments to raw logs:

   ```bash
   superdense session show <session-id>
   superdense session enrichments <session-id>
   ```

3. Compact only the sessions that look relevant:

   ```bash
   superdense compactor list
   superdense compactor run salience <session-id>
   superdense compactor run trace <session-id>
   ```

4. Answer with session ids, why each session matters, and the compact evidence needed for the user's question. State uncertainty when matches are weak or incomplete.

## Metadata Guidance

Use metadata to decide whether a session is worth compacting. Useful signals include the user's prompt, working directory, tools or commands used, errors, touched paths, and any existing enrichments that identify the session's shape.

## Query Guidance

Queries are filter JSON plus optional post-filter enrichers. `--query` accepts inline JSON or `@path/to/query.json`.

Before guessing params, inspect the live filter schema:

```bash
superdense filter show session
```

Minimal example:

```json
{
  "filters": {
    "filter": {
      "name": "session",
      "params": { "agent": "codex", "pwdContains": "superdense", "hasErrors": true }
    }
  }
}
```

See [`QUERY_REFERENCE.md`](./QUERY_REFERENCE.md) for full filter schemas, combinator examples, timestamp formats, and the compactor registry.

## Compactor Choice

Run a compactor only after triage narrows the candidate set; compactors re-read the full session each time.

Use `salience` when the user needs the gist of a session: what the user wanted, what happened, what changed, important decisions, outcomes, and failures.

Use `trace` when order matters: timelines, workflow analysis, tool or command sequences, comparing attempts, debugging how a run unfolded, or explaining why one path was chosen over another.

## Raw Source Policy

Treat `superdense session path <session-id>` and any command using `--include-path` as raw-source access:

```bash
superdense session path <session-id>
```

Reveal paths or read raw session files only when the user asks for source access. If metadata, enrichments, and compactors are insufficient to answer accurately,then read the raw source.

Raw session files are large and can bloat context. Prefer metadata, enrichments, and compactors first. When subagent use is available and permitted, prefer a narrow raw-source inspection by another agent before self-reading. Self-read only the minimum raw source needed.

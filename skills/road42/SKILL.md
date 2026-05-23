---
name: road42
version: 0.1.0
description: Find & read context prior AI-agent sessions. Use when the user asks about previous or other agent runs, needs context from earlier work, wants to understand what happened, compare attempts, audit decisions/tools/errors, or access the original session record.
---

# Road42 Stored Sessions

## Workflow

Use the CLI as a staged inspection pipeline. Start with candidate discovery, then use metadata and compactors before considering any raw session source.

1. Refresh the index only when the user asks about recent/latest work, new sessions may have appeared, or results look stale:

```bash
road42 index
```

2. Find candidate sessions. Use text search for simple topics, tasks, errors, file names, or quoted user phrasing:

```bash
road42 session list --q "search text" --limit 20
```

Use ad hoc queries for structured one-off searches. This does not save the query:

```bash
road42 query --query '<query-json>' --limit 20
road42 query --query @query.json --limit 20
```

Use saved queries only when the user refers to an existing reusable cohort or asks to persist one:

```bash
road42 saved-query list
road42 saved-query run <query-id> --limit 20
road42 saved-query save --name "name" --query '<query-json>'
road42 saved-query save --name "name" --query @query.json
```

3. Triage candidates before compacting. Prefer session metadata and generated enrichments to raw logs:

```bash
road42 session show <session-id>
road42 session enrichments <session-id>
```

4. Compact only the sessions that look relevant:

```bash
road42 compactor list
road42 compactor run salience <session-id>
road42 compactor run trace <session-id>
```

5. Answer with session ids, why each session matters, and the compact evidence needed for the user's question. State uncertainty when matches are weak or incomplete.

## Metadata Guidance

Use metadata to decide whether a session is worth compacting. Useful signals include the user's prompt, working directory, tools or commands used, errors, touched paths, and any existing enrichments that identify the session's shape.

## Query Guidance

Queries are filter JSON plus optional post-filter enrichers:

`--query` accepts inline JSON or `@path/to/query.json`.

```json
{
  "filters": {
    "filter": {
      "name": "session",
      "params": { "agent": "codex", "pwdContains": "road42", "hasErrors": true }
    }
  }
}
```

Before guessing params, inspect the live filter schema:

```bash
road42 filter show session
```

Session filter fields:

- `agent`: exact agent adapter name.
- `pwd`: exact working directory.
- `pwdContains`: substring in working directory.
- `project`: exact project key.
- `projectContains`: substring in project key.
- `firstPromptContains`: substring in first prompt.
- `summaryContains`: substring in session summary.
- `createdAfter`: created at or after timestamp/date.
- `createdBefore`: created at or before timestamp/date.
- `modifiedAfter`: modified at or after timestamp/date.
- `modifiedBefore`: modified at or before timestamp/date.
- `hasErrors`: boolean error signal.
- `toolUsed`: tool name plus optional minimum count.
- `cliUsed`: CLI name plus optional minimum count.
- `eventCount`: numeric event-count comparison.

Use transcript filters when metadata is not enough:

```json
{
  "filters": {
    "filter": {
      "name": "user_prompt_contains",
      "params": { "keyword": "billing" }
    }
  }
}
```

Combine filters with `and`, `or`, and `not`.

## Compactor Choice

Use `salience` when the user needs the gist of a session: what the user wanted, what happened, what changed, important decisions, outcomes, and failures.

Use `trace` when order matters: timelines, workflow analysis, tool or command sequences, comparing attempts, debugging how a run unfolded, or explaining why one path was chosen over another.

Run compactors only after narrowing to a small candidate set.

## Raw Source Policy

Treat `road42 session path <session-id>` and any command using `--include-path` as raw-source access:

```bash
road42 session path <session-id>
```

Reveal paths or read raw session files only when the user asks for source access or when metadata and compactors are not enough to answer accurately.

Raw session files are large and can bloat context. Prefer metadata, enrichments, and compactors first. When subagent use is available and permitted, prefer a narrow raw-source inspection by another agent before self-reading. Self-read only the minimum raw source needed.

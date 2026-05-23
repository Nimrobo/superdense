---
name: road42
description: Inspect and summarize Road42 stored AI-agent sessions through the road42 CLI. Use when Codex needs to find saved Road42 queries, list sessions matching a query, inspect session metadata/enrichments, run compactors such as salience or trace, or locate a raw session path only after the user explicitly asks for the stored source.
---

# Road42 Stored Sessions

## Workflow

Use the CLI as a staged inspection pipeline. Prefer compact metadata before reading any raw session source.

1. Refresh the index when freshness matters:

```bash
road42 index
```

2. Find candidate sessions:

```bash
road42 query list
road42 query run <query-id> --limit 20
road42 session list --q "search text" --limit 20
```

3. Discover filters and inspect cheap per-session metadata:

```bash
road42 filter list
road42 filter show session
road42 session show <session-id>
road42 session enrichments <session-id>
road42 session fields
road42 enricher list
```

4. Compact only the sessions that look relevant:

```bash
road42 compactor list
road42 compactor run salience <session-id>
road42 compactor run trace <session-id>
```

5. Reveal the raw stored source path only when the user explicitly asks for it:

```bash
road42 session path <session-id>
```

## Command Contracts

All agent-facing commands emit JSON. Treat `id` as the stable Road42 session id, usually `<agent>:<native-session-id>`.

- Queries are filters first, then optional post-filter enrichers. Use `road42 filter list` and `road42 filter show <name>` before writing query JSON.
- Query JSON uses `{ filters, enrichers? }`. `filters` is a boolean tree of `{ filter: { name, params } }` leaves. `enrichers` names extra data producers to run only after sessions match.
- `query list` returns saved queries with `id`, `name`, `filters`, `enrichers`, timestamps, and `memberCount`.
- `query run <query-id>` evaluates a saved query and returns `query`, `matched`, `total`, `limit`, `offset`, and `items`.
- Query result `items[]` contains `{ session, addedAt, evidence, enrichments }`.
- `filter list` returns available filters with names, schemas, examples, and flags such as `readsLog` or `usesSystemData`.
- `filter show <name>` returns one filter catalog item. Use this instead of guessing params.
- `session enrichments <session-id>` returns `{ session, items }`, where each item has `name`, `version`, `computedAt`, and parsed JSON `value`.
- `compactor list` returns compactors with `name`, `kind`, `targetBytes`, and `description`.
- `compactor run <name> <session-id>` returns `{ session, compactor, result }`.
- `session path <session-id>` returns `{ id, agent, sessionId, logPath }`.

Session objects omit `logPath` by default. Use `--include-path` only when a command explicitly needs to include source paths in its JSON.

## Query Guidance

Use the built-in `session` filter for session metadata and always-on system data:

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

`session` params include `agent`, `pwd`, `pwdContains`, `firstPromptContains`, `summaryContains`, created/modified date bounds, `hasErrors`, `toolUsed`, `cliUsed`, and `eventCount`.

Use code filters for transcript/log matching. Built-in example:

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

Combine filters with `and`, `or`, and `not`:

```json
{
  "filters": {
    "and": [
      { "filter": { "name": "session", "params": { "toolUsed": { "name": "Bash", "min": 1 } } } },
      { "filter": { "name": "user_prompt_contains", "params": { "keyword": "tests" } } }
    ]
  }
}
```

Use query enrichers only to add data to matched results:

```json
{
  "filters": { "filter": { "name": "session", "params": { "agent": "codex" } } },
  "enrichers": ["fingerprint"]
}
```

## Metadata Guidance

Use `session enrichments` to triage sessions before compacting:

- `tool_counts`: map of tool name to invocation count.
- `bash_cli_counts`: map of CLI program to invocation count across Bash-like tool calls.
- `has_errors`: boolean signal for common error/exception text.
- `event_count`: transcript event count.
- `fingerprint`: fixed-shape JSON with event counts, tool/error counts, role byte totals, unique paths, verbs, duration, and turns.

Use `session fields` or `filter list/show` to discover filters and post-filter enrichers.

## Compactor Guidance

Use `salience` when the task is "what was the user trying to do and what happened?" It extracts first/last asks, user turns, decision-marker assistant lines, mutations, and errors.

Use `trace` when the task is workflow or sequence analysis. It preserves ordered user prompts, assistant headers, and tool-call sequence with short arguments and success/failure signals.

Compactors do not cache output. Run them after filtering to a small set of candidate sessions.

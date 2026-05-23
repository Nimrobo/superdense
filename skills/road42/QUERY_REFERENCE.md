# Road42 Query Reference

A query is filter JSON, optionally with post-filter enrichers. `--query` accepts inline JSON or `@path/to/query.json`. Always run `road42 filter show <name>` to confirm the live param schema before guessing.

## Combinators

`and`, `or`, and `not` wrap other filter nodes. A leaf is `{ "filter": { "name": "...", "params": {...} } }`.

```json
{
  "filters": {
    "and": [
      { "filter": { "name": "session", "params": { "agent": "codex", "hasErrors": true } } },
      { "filter": { "name": "user_prompt_contains", "params": { "keyword": "billing" } } }
    ]
  },
  "enrichers": ["salience"]
}
```

`not` takes a single node:

```json
{ "not": { "filter": { "name": "session", "params": { "agent": "codex" } } } }
```

## Session Filter Fields

`road42 filter show session` is authoritative. Fields:

- `agent` — exact agent adapter name.
- `pwd` — exact working directory.
- `pwdContains` — substring in working directory.
- `project` — exact project key.
- `projectContains` — substring in project key.
- `firstPromptContains` — substring in first prompt.
- `summaryContains` — substring in session summary.
- `createdAfter`, `createdBefore`, `modifiedAfter`, `modifiedBefore` — timestamp bounds (see below).
- `hasErrors` — boolean.
- `toolUsed` — tool name plus optional minimum count.
- `cliUsed` — CLI name plus optional minimum count.
- `eventCount` — numeric comparison.

### Non-obvious shapes

`toolUsed` / `cliUsed`:

```json
{ "toolUsed": { "name": "Bash", "min": 1 } }
{ "cliUsed":  { "name": "git",  "min": 2 } }
```

`min` is optional and defaults to `1`.

`eventCount`:

```json
{ "eventCount": { "op": ">", "value": 50 } }
```

`op` ∈ `=`, `!=`, `<`, `<=`, `>`, `>=` (default `=`). `value` is required.

### Timestamp formats

`createdAfter`, `createdBefore`, `modifiedAfter`, `modifiedBefore` accept either:

- milliseconds since epoch (number), or
- any `Date.parse()`-compatible string — e.g. `"2026-05-21"`, `"2026-05-21T10:30:00Z"`.

## Transcript Filters

Built-ins:

- `session` — metadata-based (the fields above).
- `user_prompt_contains` — `{ "keyword": "..." }` substring match in user messages.
- `is_insight_run` — no params.

Plus any user-loaded filters from `~/.road42/filters/` and `~/.road42/plugins/`. Run `road42 filter show <name>` for the live param schema of any filter.

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

## Compactor Registry

- `salience` — gist of a session.
- `trace` — timeline / ordered tool & command sequence.

No user-loadable compactors at present. `road42 compactor list` is the live source of truth.

## Session ID Format

`<adapter>:<sessionId>` — e.g. `codex:abc-123-def`. The adapter prefix scopes the id; the suffix is adapter-specific.

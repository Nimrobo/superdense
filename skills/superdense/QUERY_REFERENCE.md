# Superdense Query Reference

A query is filter JSON. `--query` accepts inline JSON or `@path/to/query.json`. Always run `superdense filter show <name>` to confirm the live param schema before guessing.

## Combinators

`and`, `or`, and `not` wrap other filter nodes. A leaf is `{ "filter": { "name": "...", "params": {...} } }`.

```json
{
  "filters": {
    "and": [
      { "filter": { "name": "session", "params": { "agent": "codex", "hasErrors": true } } },
      { "filter": { "name": "user_prompt_contains", "params": { "keyword": "billing" } } }
    ]
  }
}
```

`not` takes a single node:

```json
{ "not": { "filter": { "name": "session", "params": { "agent": "codex" } } } }
```

## Session Filter Fields

`superdense filter show session` is authoritative. Fields:

- `agent` — exact agent adapter name.
- `pwd` — exact recorded working directory; use for a specific workspace or subdirectory.
- `pwdContains` — substring in recorded working directory.
- `project` — exact normalized project key; use for grouping Conductor sibling workspaces.
- `projectContains` — substring in normalized project key.
- `firstPromptContains` — substring in first prompt.
- `summaryContains` — substring in session summary.
- `createdAfter`, `createdBefore`, `modifiedAfter`, `modifiedBefore` — timestamp bounds (see below).
- `hasErrors` — boolean.
- `toolUsed` — tool name plus optional minimum count.
- `cliUsed` — CLI name plus optional minimum count.
- `eventCount` — numeric comparison.
- `enteredPlanMode` — boolean.
- `planEnterCount` — numeric comparison.
- `planDurationMs` — numeric comparison over total time in plan mode.
- `planUnclosed` — boolean; entered plan mode without an observed exit.
- `planFinalized` — boolean; proposed plan finalized by `ExitPlanMode` or `<proposed_plan>`.
- `toolUsedInPlan` — tool name plus optional minimum count while in plan mode.
- `toolUsedOnlyOutOfPlan` — tool name used outside plan mode and never inside it.
- `userPromptsInPlan` — numeric comparison over user messages while in plan mode.

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

Plan-mode fields use the same count shapes:

```json
{ "enteredPlanMode": true }
{ "planUnclosed": true }
{ "planFinalized": true }
{ "planEnterCount": { "op": ">=", "value": 2 } }
{ "planDurationMs": { "op": ">", "value": 300000 } }
{ "toolUsedInPlan": { "name": "Edit", "min": 1 } }
{ "toolUsedOnlyOutOfPlan": { "name": "Bash" } }
{ "userPromptsInPlan": { "op": ">", "value": 3 } }
```

Project filter examples. In Conductor, `/Users/x/conductor/workspaces/superdense/casablanca/packages/core` has project key `/Users/x/conductor/workspaces/superdense`; outside Conductor, project key equals `pwd`.

```json
{ "projectContains": "superdense" }
{ "project": "/Users/x/conductor/workspaces/superdense" }
{ "pwdContains": "casablanca" }
{ "pwd": "/Users/x/conductor/workspaces/superdense/casablanca/packages/core" }
```

### Timestamp formats

`createdAfter`, `createdBefore`, `modifiedAfter`, `modifiedBefore` accept either:

- milliseconds since epoch (number), or
- any `Date.parse()`-compatible string — e.g. `"2026-05-21"`, `"2026-05-21T10:30:00Z"`.

## Transcript Filters

Built-ins:

- `session` — metadata-based (the fields above).
- `user_prompt_contains` — `{ "keyword": "..." }` substring match in user messages.
- `is_insight_run` — no params.

Plus any user-loaded filters from `~/.superdense/filters/` and `~/.superdense/plugins/`. Run `superdense filter show <name>` for the live param schema of any filter.

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

No user-loadable compactors at present. `superdense compactor list` is the live source of truth.

## Session ID Format

`<adapter>:<sessionId>` — e.g. `codex:abc-123-def`. The adapter prefix scopes the id; the suffix is adapter-specific.

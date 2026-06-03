---
name: superdense
version: 0.2.0
description: Find & read context prior AI-agent sessions. Use when the user asks about previous or other agent runs, needs context from earlier work, wants to understand what happened, compare attempts, audit decisions/tools/errors, plan-mode behavior, or access the original session record.
---

# Superdense Stored Sessions

## Concepts

- **Session** — one stored agent run, identified by `<adapter>:<sessionId>` (e.g. `codex:abc-123`).
- **Project key** — normalized project identity used to group related workspaces. For Conductor paths, `/Users/x/conductor/workspaces/superdense/casablanca/packages/core` has project key `/Users/x/conductor/workspaces/superdense`; outside Conductor, project key equals `pwd`.
- **Session filter** — query filter named `session`; use it for agent, project, `pwd`, time, errors, tools, commands, event count, plan-mode fields, and sub-agent relationships.
- **Compactor** — on-demand view that re-reads the session log and prints to stdout. Only `salience` (gist) and `trace` (timeline).

## Sub-Agent Sessions

Modern coding agents (Claude Code, Codex, OpenCode) spawn sub-agent sessions to delegate work. Superdense indexes these as first-class sessions linked to their parent.

**Default behavior**: `session list`, `--q`, saved queries, and ad-hoc queries return **root sessions only**. Sub-agents are hidden by default.

**How to discover children of a session:**

```bash
# session show returns direct-child sub-agent metadata
superdense session show <session-id>

# list direct children (id + relation by default; --full for metadata)
superdense session children <session-id>
superdense session children <session-id> --full

# recursive tree (default depth=1; use --depth N for deeper)
superdense session tree <session-id>
superdense session tree <session-id> --depth 3
```

**How to include sub-agents in search:**

```bash
# session list with --include-subagents
superdense session list --include-subagents

# query DSL: isSubagent param (default false = root-only)
superdense query --query '{"filters":{"filter":{"name":"session","params":{"isSubagent":true}}}}'

# find children of a specific parent via parent: param
superdense query --query '{"filters":{"filter":{"name":"session","params":{"isSubagent":true,"parent":"claude-code:<parent-id>"}}}}'

# find level-1 sub-agents that spawned their own sub-agents
superdense query --query '{"filters":{"filter":{"name":"session","params":{"isSubagent":true,"hasSubagents":true,"subagentDepth":{"op":"=","value":1}}}}}'

# find every indexed session in one root/sub-agent tree
superdense query --query '{"filters":{"filter":{"name":"session","params":{"rootSession":"codex:<root-id>"}}}}'
```

**Direct access works unchanged** — `session show <child-id>`, `session path <child-id>`, and `compactor run <name> <child-id>` all work on sub-agent sessions directly.

**System enrichment:** every indexed session, including sub-agent sessions, gets an always-on `subagent_summary` enrichment. It contains direct-child fields (`hasSubagents`, `subagentCount`, `subagentIds`) plus recursive/tree fields (`descendantSubagentCount`, `subagentDepth`, `rootSessionId`, `ancestorSessionIds`). Inspect it with:

```bash
superdense session enrichments <session-id> --name subagent_summary
```

## Workflow

Use the CLI as a staged inspection pipeline: candidate discovery → metadata triage → compact only what's relevant.

**Reward layer.** To see the reward-layer punch list and the next skill to run, start with:

```bash
superdense reward status
```

Use `superdense reward status --project <id>` to focus the project-sensitive stages.

**Precondition.** Refresh the index only when the user asks about recent/latest work, new sessions may have appeared, or results look stale:

```bash
superdense index
```

1. Find candidate sessions. Root sessions are searched by default; use `session children`/`session tree` or `isSubagent: true` to follow up on delegated work after picking a root candidate. Pick the discovery path that matches the search:
   - `superdense session list --q "text"` — substring search across **first prompt, summary, and working directory** only (case-insensitive `LIKE`). Use for quick keyword/topic/pwd hits.

     ```bash
     superdense session list --q "search text" --limit 20
     ```

   - `superdense query` — use whenever the search needs a field `--q` doesn't cover: agent, project, time bounds, `hasErrors`, `toolUsed`, `cliUsed`, `eventCount`, plan-mode filters, transcript filters, or any `and`/`or`/`not` combinator. Ad hoc, not saved. Inspect the live schema first for plan-mode or project-scoped searches:

     ```bash
     superdense filter show session
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

2. Triage candidates before compacting. Prefer session metadata to raw logs; inspect session details only when metadata is not enough:

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

Use metadata to decide whether a session is worth compacting. Useful signals include the user's prompt, working directory, project key, tools or commands used, errors, touched paths, plan-mode fields, and `subagent_summary` fields.

## Query Guidance

Queries are filter JSON. `--query` accepts inline JSON or `@path/to/query.json`.

Before guessing params, inspect the live filter schema:

```bash
superdense filter show session
```

Project-wide example across Conductor sibling workspaces:

```json
{
  "filters": {
    "filter": {
      "name": "session",
      "params": { "agent": "codex", "projectContains": "superdense" }
    }
  }
}
```

Specific workspace/path example:

```json
{
  "filters": {
    "filter": {
      "name": "session",
      "params": { "pwdContains": "casablanca", "hasErrors": true }
    }
  }
}
```

Sub-agent fields:

```json
{
  "filters": {
    "filter": {
      "name": "session",
      "params": { "isSubagent": true, "parent": "claude-code:<parent-id>" }
    }
  }
}
```

Nested sub-agent fields:

```json
{
  "filters": {
    "filter": {
      "name": "session",
      "params": {
        "isSubagent": true,
        "hasSubagents": true,
        "subagentDepth": { "op": "=", "value": 1 }
      }
    }
  }
}
```

Plan-mode fields are exposed through the `session` filter:

```json
{
  "filters": {
    "filter": {
      "name": "session",
      "params": {
        "enteredPlanMode": true,
        "planUnclosed": false,
        "planFinalized": true,
        "planDurationMs": { "op": ">", "value": 300000 },
        "toolUsedInPlan": { "name": "Edit", "min": 1 },
        "userPromptsInPlan": { "op": ">", "value": 3 }
      }
    }
  }
}
```

Use `pwd` / `pwdContains` for the recorded working directory. Use `project` / `projectContains` for the normalized project key; in Conductor this finds sibling workspaces under the same project, while outside Conductor it is the same value as `pwd`.

See [`QUERY_REFERENCE.md`](./QUERY_REFERENCE.md) for full filter schemas, combinator examples, timestamp formats, and the compactor registry.

## Compactor Choice

Run a compactor only after triage narrows the candidate set; compactors re-read the full session each time.

Use `salience` when the user needs the gist of a session: what the user wanted, what happened, what changed, important decisions, outcomes, failures, plan-mode boundaries, and proposed plans.

Use `trace` when order matters: timelines, mode transitions, workflow analysis, tool or command sequences, comparing attempts, debugging how a run unfolded, or explaining why one path was chosen over another. Prefer it for plan-mode chronology.

## Parallel Comparison

Use subagents for comparison when there are many sessions, attempts, or compacted outputs and pattern-finding would bloat the main context. This is for comparing compact evidence and extracting insights, not for dumping raw source.

Create or select a bounded session list for each cohort, hypothesis, or attempted approach. Give each subagent one list and ask it to compact or summarize only that slice. Bring back the compact findings, then compare them in the main thread for recurring patterns, contradictions, and useful insights.

## Raw Source Policy

Treat `superdense session path <session-id>` and any command using `--include-path` as raw-source access:

```bash
superdense session path <session-id>
```

Reveal paths or read raw session files only when the user asks for source access. If metadata, session details, and compactors are insufficient to answer accurately, then read the raw source.

Raw session files are large and can bloat context. Prefer metadata, session details, and compactors first. When subagent use is available and permitted, prefer a narrow raw-source inspection by another agent before self-reading. Self-read only the minimum raw source needed.

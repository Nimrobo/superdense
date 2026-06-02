---
name: superdense-externalization-reconcile
version: 0.1.0
description: Reconcile finalized Superdense artifacts with their real-world external identities through user-installed connector CLIs.
---

# Superdense Externalization Reconcile

Use this skill when the user asks to process the Layer 4 externalization inbox.

1. Load one bounded actionable page. Start with `superdense externalization inbox --limit 10`.
   When explicitly continuing a prior run, pass through its cursor unchanged:
   `superdense externalization inbox --limit 10 --cursor <opaque>`.
2. For each item, inspect `superdense artifact show <artifact-id>` and the relevant
   `superdense curation context <root-session-id>` results.
3. Decide whether the artifact stayed internal or infer each connector it needs. The `connector`
   value is a free-text platform label you choose (e.g. `x`, `youtube`); it is not tied to any
   installed CLI. Do not mutate external services or attach matches from general web search.
4. Persist a complete replacement assessment with
   `superdense externalization assess --input '<json>'`.
5. Confirm with `superdense externalization show <artifact-id>`.
6. Stop after the current page. Report `nextCursor`; when it is non-null, print the exact
   `superdense externalization inbox --limit 10 --cursor <opaque>` continuation command.

Use thread status `not_external` with no targets for intentionally internal artifacts. Use status
`external` with one or more targets. Target statuses are `linked`, `needs_connector`, `not_found`,
and `ambiguous`. A linked target requires an opaque `locator`; blocked targets may retain a known
locator. Attach only clear connector-authoritative matches. Preserve existing linked targets during
a blocked retry unless evidence shows they are wrong. Process each inbox item at most once per run.
Treat `nextCursor` as opaque: never decode, edit, or invent one, and continue only when explicitly
asked.

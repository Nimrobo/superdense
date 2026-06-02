---
name: superdense-externalization-reconcile
version: 0.1.0
description: Reconcile finalized Superdense artifacts with their real-world external identities through user-installed connector CLIs.
allowed-tools: Bash(superdense *), Bash(superdense-externalize-*)
---

# Superdense Externalization Reconcile

Process the Layer 4 inbox: decide whether finalized artifacts stayed internal or were externalized,
then attach connector-specific locators. This skill does not fetch reward metrics.

## Workflow

1. Load one bounded actionable page. Start without a cursor; when explicitly continuing a prior
   run, pass through its opaque cursor unchanged:

   ```bash
   superdense externalization inbox --limit 10
   superdense externalization inbox --limit 10 --cursor <opaque>
   ```

2. For each artifact, inspect its frozen payload and lineage:

   ```bash
   superdense artifact show <artifact-id>
   superdense curation context <root-session-id>
   ```

   Decide whether the artifact remained internal or infer each external connector it needs.

3. Check the curated connector catalog:

   ```bash
   superdense externalization connector list
   ```

   Connector CLIs are installed and configured by the user. Their repositories define their own
   read-only search commands and locator formats. Do not install, configure, or mutate an external
   service. Do not attach matches found only through general web browsing.

4. Replace the current assessment:

   ```bash
   # Intentionally internal
   superdense externalization assess --input '{"artifactId":"<id>","status":"not_external","evidence":"<why>","targets":[]}'

   # Clearly linked external identity
   superdense externalization assess --input '{"artifactId":"<id>","status":"external","evidence":"<why>","targets":[{"connector":"x","status":"linked","locator":"<opaque connector locator>","evidence":"<why this match is clear>"}]}'

   # External identity cannot yet be resolved
   superdense externalization assess --input '{"artifactId":"<id>","status":"external","evidence":"<why>","targets":[{"connector":"x","status":"needs_connector","locator":null,"evidence":"<missing CLI or catalog entry>"}]}'
   ```

   Valid target statuses are `linked`, `needs_connector`, `not_found`, and `ambiguous`. Preserve a
   known locator on a blocked target when it will help a later retry.

5. Confirm the saved result:

   ```bash
   superdense externalization show <artifact-id>
   ```

6. Stop after the current page. Report the returned `nextCursor`. When it is non-null, print the
   exact continuation command:

   ```bash
   superdense externalization inbox --limit 10 --cursor <opaque>
   ```

## Rules

- Process each inbox item at most once per run. Blocked artifacts intentionally remain visible for
  a future explicit run.
- Treat `nextCursor` as opaque. Never decode, edit, or invent a cursor. Process one page per
  invocation and continue only when explicitly asked.
- Attach only a clear connector-authoritative match. Keep uncertain candidates in evidence and use
  `ambiguous`.
- Preserve existing linked targets when reassessing a partially blocked artifact unless evidence
  shows that the old match was wrong.
- `locator` is opaque text. Store the connector's exact identifier, URL, coordinate, or serialized
  query without translating it into a Superdense schema.
- Record concise evidence for every assessment and unresolved target.

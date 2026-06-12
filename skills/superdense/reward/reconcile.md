# Reconcile

Process the Layer 4 inbox: decide whether finalized artifacts stayed internal or were externalized, then attach connector-specific locators. This stage does not fetch reward metrics.

## Workflow

1. Load one bounded actionable page. Start without a cursor; when explicitly continuing a prior run, pass through its opaque cursor unchanged:

   ```bash
   superdense externalization inbox --limit 10
   superdense externalization inbox --limit 10 --cursor <opaque>
   ```

2. For each artifact, inspect its frozen payload and lineage:

   ```bash
   superdense artifact show <artifact-id> --full
   superdense curation context <root-session-id>
   ```

   Decide whether the artifact remained internal or infer each external connector it needs. Run `superdense reward docs connectors --artifact <type>` for connector candidates, locator formats, and evidence standards for that artifact type. When a target is `needs_connector`, run `superdense reward docs connectors --connector <name> --section install` for installation or auth help. The `connector` value is a free-text platform label you choose, such as `github`, `npm`, `x`, `youtube`, or `substack`; it is not tied to a Superdense-installed CLI. Do not mutate an external service, and do not attach matches found only through general web browsing. If indexed context is insufficient, follow the shared escalation policy in `reward/README.md`.

3. Replace the current assessment:

   ```bash
   # Intentionally internal
   superdense externalization assess --input '{"artifactId":"<id>","status":"not_external","evidence":"<why>","targets":[]}'

   # Clearly linked external identity
   superdense externalization assess --input '{"artifactId":"<id>","status":"external","evidence":"<why>","targets":[{"connector":"x","status":"linked","locator":"<opaque connector locator>","evidence":"<why this match is clear>"}]}'

   # External identity cannot yet be resolved
   superdense externalization assess --input '{"artifactId":"<id>","status":"external","evidence":"<why>","targets":[{"connector":"x","status":"needs_connector","locator":null,"evidence":"<external identity not yet resolved>"}]}'
   ```

   Valid target statuses are `linked`, `needs_connector`, `not_found`, and `ambiguous`. Preserve a known locator on a blocked target when it will help a later retry.

4. Confirm the saved result:

   ```bash
   superdense externalization show <artifact-id>
   ```

5. Stop after the current page. Report the returned `nextCursor`. When it is non-null, print the exact continuation command:

   ```bash
   superdense externalization inbox --limit 10 --cursor <opaque>
   ```

## Rules

- Process each inbox item at most once per run. Blocked artifacts intentionally remain visible for a future explicit run.
- Treat `nextCursor` as opaque. Never decode, edit, or invent a cursor. Process one page per invocation and continue only when explicitly asked.
- Attach only a clear connector-authoritative match. Keep uncertain candidates in evidence and use `ambiguous`.
- Keep artifact type and connector separate. Prefer `post` with connector `x`, `software-change` with connector `github`, and `release` with connector `npm`.
- Preserve existing linked targets when reassessing a partially blocked artifact unless evidence shows that the old match was wrong.
- `locator` is opaque text. Store the connector's exact identifier, URL, coordinate, or serialized query without translating it into a Superdense schema.
- Record concise evidence for every assessment and unresolved target.

---
name: superdense-project-profile
version: 0.1.0
description: Profile a Superdense project so later reward-layer discovery knows which local artifact shapes to enumerate.
argument-hint: project-id and optional change request
allowed-tools: Bash(superdense project *)
---

# Superdense Project Profile

Profile one detected Superdense project. This is a local, structural description for later
artifact discovery. Do not choose reward connectors, published URLs, or collection policies.

Arguments: `$ARGUMENTS`

## Workflow

1. If no project id was supplied, run:

   ```bash
   superdense project list --needs-action
   ```

   Ask the user which project to profile.

2. For the selected id, run:

   ```bash
   superdense project context <project-id>
   ```

3. Inspect accessible roots as needed. Decide:
   - a concise project `name` and `description`,
   - stable absolute `roots`,
   - `artifactShapes`,
   - a compact `evidenceSummary`,
   - optional `notes`,
   - whether related unprofiled project ids should be covered by this canonical profile,
   - whether unresolved ambiguity requires human attention.

4. Apply a minimal JSON merge patch. Omitted fields remain unchanged:

   ```bash
   superdense project apply <project-id> --patch '<json>'
   ```

5. Show the stored result and run:

   ```bash
   superdense project list --needs-action
   ```

## Artifact Shapes

Use an open artifact type name and one strict local detector:

```json
{
  "type": "video",
  "detector": {
    "kind": "folder-leaf",
    "include": ["showcase/*", "launch"]
  },
  "outputHint": {
    "globs": ["finals/*.mp4"],
    "note": "Rendered output supporting evidence"
  }
}
```

Supported detectors:

- `folder-leaf`: requires `include`, optionally `exclude`.
- `file-glob`: requires `include`, optionally `exclude`.
- `branch`: no extra fields.
- `whole-surface`: no extra fields.

Use `needsHumanAttention: true` only with specific `attentionReasons`. A valid completed
profile may have an empty `artifactShapes` array when no stable rewardable local artifacts exist.

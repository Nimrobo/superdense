---
name: superdense-project-profile
version: 0.1.0
description: Profile a Superdense project so later reward-layer discovery knows which local artifact shapes to enumerate.
---

# Superdense Project Profile

Use this skill when the user invokes `/superdense-project-profile`.

## Workflow

1. If the user did not supply a project id, run `superdense project list --needs-action` and ask
   which project to profile.
2. Run `superdense project context <project-id>`.
3. Inspect accessible roots as needed.
4. Infer a concise name, description, stable absolute roots, local artifact shapes, evidence
   summary, notes, covered project ids, and any specific human-attention reasons.
5. Run `superdense project apply <project-id> --patch '<json>'` with a minimal patch. Omitted
   fields remain unchanged.
6. Show the saved profile and run `superdense project list --needs-action`.

Layer boundary: store local artifact structure only. Do not choose reward connectors,
published URLs, or collection policies.

Artifact shapes use one open `type` and one strict detector:

- `{"kind":"folder-leaf","include":["showcase/*"],"exclude":["renders"]}`
- `{"kind":"file-glob","include":["drafts/*.md"]}`
- `{"kind":"branch"}`
- `{"kind":"whole-surface"}`

An artifact shape may include `outputHint: {"globs":["finals/*.mp4"],"note":"..."}` for local
supporting evidence. A completed profile may validly use an empty `artifactShapes` array.
Set `needsHumanAttention: true` only with specific `attentionReasons`.

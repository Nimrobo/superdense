# Artifact Types

Use artifact types to keep cohorts comparable. They are normalization guides, not an enum: create a project-specific lower-kebab type only when the closest common type would make comparison misleading.

Artifact type answers: what kind of thing did we produce?

## Rules

- Reuse the current project's `artifactShapes[].type` when it fits the finalized output.
- Use lower-kebab names, for example `software-change`, not `software_change` or `SoftwareChange`.
- Choose the output shape, not the publishing platform. Prefer `post` plus connector `x`, `software-change` plus connector `github`, and `release` plus connector `npm`.
- Avoid near-synonyms. Prefer one stable type over variants such as `feature`, `code-change`, `implementation`, and `software-change`.
- Create a new type only when existing types would group unlike artifacts into the same cohort.
- Do not encode status, location, or channel in the type. Use payload, title, and externalization targets for those details.

## Common Types

| Type              | Use for                                                                 | Avoid when                                                  |
| ----------------- | ----------------------------------------------------------------------- | ----------------------------------------------------------- |
| `software-change` | Code changes, features, bug fixes, refactors, migrations, CI changes.   | The durable output is a package release or standalone tool. |
| `release`         | Package releases, GitHub releases, changelog-backed launches.           | The work only prepared code and was not actually released.  |
| `documentation`   | Docs pages, README changes, tutorials, API guides, knowledge-base docs. | The output is a short social post announcing docs.          |
| `post`            | Social posts, blog posts, newsletters, launch updates, written content. | The primary artifact is a video, website, or code change.   |
| `video`           | Published videos, rendered clips, demos, recordings.                    | The session only wrote a script or plan for a future video. |
| `website`         | Public sites, landing pages, web apps, demos, microsites.               | The output is only source code with no stable surface.      |
| `dataset`         | Curated data files, benchmark sets, labeled examples, exports.          | The output is an analysis derived from a dataset.           |
| `design`          | Mockups, graphics, visual systems, generated image assets.              | The output is implementation of an existing design.         |
| `analysis`        | Research memos, evaluations, comparisons, validation reports.           | The analysis directly produced another durable artifact.    |
| `tooling`         | CLIs, scripts, developer tools, automation, reusable internal tools.    | The change is best compared as a normal software change.    |

## Payload Hints

- `software-change`: include files, branch, PR reference if known, or summary of changed surface.
- `release`: include package/name/version, release tag, changelog path, or release notes.
- `documentation` / `post` / `analysis`: include text, source files, published draft path, or canonical slug.
- `video` / `design` / `dataset`: include output files, asset paths, or external identifiers only when already known.
- `website`: include URL when local/stable, route list, screenshots, or changed surface.

# Connectors

Use connector labels to describe where an artifact exists in the real world. They are normalization guides, not installed-tool declarations and not a supported-connector registry. Superdense stores the free-text label and opaque locator; the agent supplies evidence.

Connector answers: where did that thing show up in the world?

## Rules

- Use short lower-kebab labels. Prefer common platform names such as `github`, `npm`, `x`, `youtube`, `substack`, `website`, `docs`, and `analytics`.
- Keep artifact type and connector separate. Prefer `post` + `x`, `software-change` + `github`, `release` + `npm`.
- A `linked` target needs connector-authoritative evidence: a provider URL, provider API/CLI result, official package metadata, project-owned site route, or other source controlled by the platform or project.
- General web search may surface leads, but do not link from search-result snippets alone.
- Use `ambiguous` when multiple plausible real artifacts exist and the evidence does not choose one.
- Use `not_found` when the connector/platform is known but no authoritative artifact exists there.
- Use `needs_connector` when the target likely exists but required account access, local tooling, or private provider data is unavailable.
- Keep `locator` opaque: store the provider URL, numeric id, package coordinate, tag, route, or serialized query exactly enough for later collection.

## Common Connectors

| Connector   | Good locators                                       | Evidence for `linked`                                      | Likely reward dimensions                       |
| ----------- | --------------------------------------------------- | ---------------------------------------------------------- | ---------------------------------------------- |
| `github`    | PR/issue/release URL, `owner/repo#123`, release tag | `gh`/GitHub API result, GitHub URL, merge/release metadata | comments, reactions, merge state, stars, forks |
| `npm`       | `package@version`, package URL                      | `npm view`, npm package page, registry metadata            | downloads, dependents, version adoption        |
| `x`         | status URL, numeric status id                       | X URL/API/authorized analytics result                      | views, likes, reposts, replies, bookmarks      |
| `youtube`   | video URL, channel/video id                         | YouTube URL/API/Studio-visible metadata                    | views, likes, comments, watch time             |
| `substack`  | post URL, publication slug                          | Substack URL/dashboard/API evidence                        | views, opens, likes, comments, subscriptions   |
| `website`   | canonical URL                                       | project-owned live URL, deployment provider, site response | visits, conversions, signups, clicks           |
| `docs`      | docs URL or route                                   | docs site route, search console, repo-published docs       | pageviews, search impressions, helpful votes   |
| `analytics` | serialized query or dashboard URL                   | provider dashboard/API result                              | events, users, conversions, retention, revenue |

## Collection Guidance

- Prefer connector-specific dimensions when they are real, but reuse shared names where possible: `reach`, `engagement`, `reactions`, `comments`, `conversions`, `downloads`, `views`.
- Choose `primaryDim` as the clearest headline outcome for that connector, usually `views`, `downloads`, `conversions`, or `revenue`.
- Keep richer provider details in `source` or `evidence`; `metrics` must remain a flat map of finite numbers.

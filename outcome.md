# Outcome Loop Design Notes

This captures the design discussion behind the Outcome Loop Skills V1.

## Core Shape

The outcome loop is outcome-centered, not repo-centered. One outcome folder manages one real-world outcome, such as improving X reach for an account or improving landing-page conversion for a website.

The outcome folder is the control plane:

```text
<outcome-folder>/
  goal.md
  run.md
  runs/
    <run-id>/
      work.md
      learnings.md
```

There is no `metrics.md`. Superdense owns durable measurement data through reward snapshots, linked artifacts, externalization targets, cohorts, and version chains. The folder stores intent, operating procedure, work references, and learning.

## goal.md Versus run.md

`goal.md` is protected. It defines what counts as progress:

- outcome boundary
- audience
- north-star metric
- guardrails
- target surfaces such as repos, accounts, pages, campaigns, or dashboards
- human-owned constraints and access

`run.md` is mutable. It defines how the loop currently operates:

- lever map
- action recipes
- diagnostic measurements per lever
- analytics and instrumentation checklist
- Superdense reward preflight
- intervention selection rules
- run record template
- update marker for the last reviewed run batch

`outcome-update` may improve `run.md`, but should not rewrite `goal.md`. If evidence suggests the north star itself is wrong, `outcome-update` should add a clearly marked recommendation for human review rather than changing the goal contract.

## North Star, Levers, Actions, Diagnostics

The north star is the stable real-world result we care about.

Levers are mechanisms that might move the north star.

Actions are concrete interventions an agent or human can take on a lever.

Diagnostics are measurements that explain why a lever did or did not move the north star. Diagnostics are defined in `run.md`, but their measured values are recorded in Superdense reward snapshots.

## Example: X Reach

North star: qualified audience growth for the X account.

Potential levers:

- topic selection
- hook quality
- format
- posting time

Potential actions:

- mine prior high-performing sessions for concrete founder/operator pain
- generate 10 first-line hook variants
- test single post versus thread versus visual
- test a posting window

Diagnostics:

- impressions
- profile visits
- follows
- bookmarks
- replies
- engagement rate

For X, the run folder may contain much of the work directly, such as drafts or final tweets.

## Example: Landing Page Conversion

North star: qualified signup conversion from landing-page visitors.

Potential levers:

- hero clarity
- signup friction
- trust
- traffic-message match

Potential actions:

- rewrite headline and CTA
- reduce form friction
- add proof or customer examples
- create a source-specific landing variant

Diagnostics:

- CTA click rate
- `signup_started`
- `signup_completed`
- form dropoff
- bounce rate
- source-level conversion

For landing conversion, the work usually lives in the website repo. The run folder should point to the branch, PR, deploy URL, analytics events, Superdense session IDs, artifact IDs, and externalization targets.

## Skill Roles

`outcome-setup` creates or repairs the folder and helps bootstrap measurement. It may instrument target repos when needed after inspecting local conventions and after the human provides external access.

`outcome-run` executes one intervention. It starts with a bounded Superdense reward-maintenance preflight, preferably in a subagent when supported. The preflight scopes project-sensitive reward status to the outcome's Superdense project id, then advances each actionable reward stage in pipeline order with one bounded batch per stage. It may mutate local Superdense reward state, but must not perform irreversible external actions.

`outcome-update` is observer mode. It reviews prior runs since `## Update Marker`, inspects Superdense reward evidence, and updates only `run.md` to improve future runs.

## Claude And Codex Packaging

The implemented repo-level bundle uses three portable skills:

- `outcome-setup`
- `outcome-run`
- `outcome-update`

Codex can invoke these via `$outcome-run`, `/skills`, or the slash-list skill entry depending on surface.

Claude Code can invoke normal skills as `/skill-name`. A future Claude plugin packaging can expose namespaced commands such as `/outcome:setup`, `/outcome:run`, and `/outcome:update`; that is a packaging layer over the same skill bodies.

# Outcome Loop Design Notes

This captures the design discussion behind the Outcome Loop Skills V1.

## Core Shape

The outcome loop is outcome-centered, not repo-centered. One outcome folder manages one real-world outcome, such as improving X reach for an account or improving landing-page conversion for a website.

The outcome folder is the control plane:

```text
<outcome-folder>/
  goal.md
  run.md
  gate.md
  runs/
    <run-id>/
      work.md
      learnings.md
```

There is no `metrics.md`. Superdense owns durable measurement data through reward snapshots, linked artifacts, externalization targets, cohorts, and version chains. The folder stores intent, operating procedure, work references, and learning.

There is also no `hypotheses.md` or `experiments.md`. Superdense owns durable prediction and verdict state through `hypothesis`, `experiment`, and `experiment_member` rows. The folder keeps the lever portfolio and the operating policy; Superdense keeps the falsifiable prediction, experiment membership, and verdict evidence.

## Search Model

The outcome loop is an LLM-driven bandit over a portfolio of levers:

- each lever is an arm,
- each run is a pull,
- reward snapshots are the delayed, multidimensional reward,
- hypotheses are preregistered predictions,
- experiments are the durable tests that compare predictions to observed reward.

The loop deliberately keeps a diverse lever archive instead of collapsing to the top aggregate winner. A lever can stay in the portfolio when it is Pareto-best on any reward dimension or guardrail, because multidimensional real-world reward should not be flattened into a single scalar too early.

This is adjacent to autoresearch systems such as evo for code: keep an archive, test variants, and select the next branch from evidence. The difference is the reward regime. Code benchmarks are cheap, synchronous, and reproducible; outcome loops deal with delayed, expensive, multidimensional, and sometimes human-collected reward. That is why Superdense stores structured hypotheses and experiment verdicts instead of relying on ephemeral free-text notes.

## goal.md Versus run.md

`goal.md` is protected. It defines what counts as progress:

- outcome boundary
- audience
- north-star metric
- guardrails
- target surfaces such as repos, accounts, pages, campaigns, or dashboards
- human-owned constraints and access

`run.md` is mutable. It defines how the loop currently operates:

- lever portfolio with status, pull count, reward summary, uncertainty, and last-pulled state
- action recipes
- diagnostic measurements per lever
- analytics and instrumentation checklist
- Superdense reward preflight
- explore/exploit selection policy
- run record template
- update marker for the last reviewed run batch

`gate.md` is reusable completion policy. It defines what must be true before an outcome run can be called complete:

- completion rules
- required checks
- warning checks
- deterministic checks when the outcome needs local scripts
- failure policy

It is not a per-run checklist. Each run writes the actual pass, warning, failure, fix-attempt, and unresolved-failure evidence into `runs/<run-id>/work.md`.

`outcome-update` may improve `run.md`, but should not rewrite `goal.md`. If evidence suggests the north star itself is wrong, `outcome-update` should add a clearly marked recommendation for human review rather than changing the goal contract.

## North Star, Levers, Actions, Diagnostics

The north star is the stable real-world result we care about.

Levers are mechanisms that might move the north star.

Actions are concrete steps an agent or human can take on a lever. An action is sometimes a rep of a proven recipe, such as posting another hook variant, and sometimes a fix to something in the path, such as repairing instrumentation or reducing signup friction.

Diagnostics are measurements that explain why a lever did or did not move the north star. Diagnostics are defined in `run.md`, but their measured values are recorded in Superdense reward snapshots.

Hypotheses are structured, falsifiable predictions recorded before a run ships. A valid hypothesis names the action, diagnostic metric direction and magnitude, north-star direction and magnitude, evaluation window, and mechanism.

Experiments bind a hypothesis to one or more run/artifact reps and a reward window. When target reps and reward-window maturity are met, `superdense experiment verdict <id>` folds member reward snapshots into `supported`, `refuted`, or `inconclusive` and updates the hypothesis.

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

`outcome-run` executes one action. It starts with a bounded Superdense reward-maintenance preflight, preferably in a subagent when supported. The preflight scopes project-sensitive reward status to the outcome's Superdense project id, advances each actionable reward stage in pipeline order, surfaces cohorts/chains, lists hypotheses/experiments, and renders due verdicts. The main agent then chooses `explore` or `exploit`, records or cites a hypothesis and experiment, ships one action, and writes the ids into `work.md`. Before completion, it applies `gate.md`; if required checks fail, it tries to fix them and stops with a recorded failure reason if they still fail.

`outcome-update` is observer mode. It reviews prior runs since `## Update Marker`, inspects Superdense reward evidence, audits realized explore/exploit mix, promotes or retires levers, prunes refuted hypotheses from future selection, identifies novelty gaps, and updates `run.md` plus `gate.md` when future runs need better reusable completion rules. It does not rewrite `goal.md`.

## Claude And Codex Packaging

The implemented repo-level bundle uses three portable skills:

- `outcome-setup`
- `outcome-run`
- `outcome-update`

Codex can invoke these via `$outcome-run`, `/skills`, or the slash-list skill entry depending on surface.

Claude Code can invoke normal skills as `/skill-name`. A future Claude plugin packaging can expose namespaced commands such as `/outcome:setup`, `/outcome:run`, and `/outcome:update`; that is a packaging layer over the same skill bodies.

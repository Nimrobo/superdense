# Outcome Loop Reference

## Core Model

The outcome folder is a control plane, not a duplicate analytics database. It records what the human and agent are trying to improve, how the loop currently operates, where work happened, and what the current run learned.

Superdense owns durable outcome evidence:

- sessions
- artifacts
- externalization targets
- reward snapshots
- cohort and version-chain comparison
- hypotheses and experiments

Do not create `metrics.md`, `hypotheses.md`, or `experiments.md`. If metrics are collected but cannot yet be recorded in Superdense, keep the note temporary in `work.md` under `## Blockers` and resolve it by recording the reward snapshot. Structured hypotheses and experiment verdicts belong in Superdense through `superdense hypothesis ...` and `superdense experiment ...`; the folder records only the ids and the procedure.

## Folder Contract

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

Optional files are allowed only when the outcome needs them, for example draft assets for an X run or local check scripts for deterministic gate validation. The fixed core stays small.

## Version Control

The outcome folder is git-tracked from setup onward. Its commit history is the loop's audit trail: `outcome-setup` initializes git when needed and commits the scaffold, while `outcome-update` commits playbook edits after reviewed runs. Commits are append-only; never amend or rewrite prior outcome history. Never commit private credentials or local secrets.

## Concepts

- North star: the stable real-world outcome that counts as progress.
- Guardrails: measurements or constraints that prevent cheap wins from degrading quality.
- Lever: a mechanism believed to influence the north star.
- Lever portfolio: the archive of candidate, promising, proven, exhausted, and retired levers in `run.md`.
- Action: one concrete step the agent or human can take on a lever, whether a rep of a proven recipe or a fix to something in the path.
- Diagnostic metric: a measurement that explains why a lever did or did not move the north star.
- Hypothesis: a falsifiable prediction attached to one lever and recorded in Superdense before the outcome is known.
- Experiment: the Superdense record binding a hypothesis to one or more run/artifact reps and a reward window.
- Mode: each run is either `explore` (test an uncertain or novel hypothesis) or `exploit` (rep a supported hypothesis on a proven lever).
- Gate: the reusable completion contract that says what must be true before an `outcome-run` can be called complete.

`goal.md` protects the north star and guardrails. `run.md` evolves the lever portfolio, action recipes, diagnostic measurements, instrumentation checklist, selection policy, and Superdense workflow. `gate.md` defines the reusable completion checks. It is not a checklist to clear each run; each run records the actual gate result in `runs/<run-id>/work.md`.

## Hypotheses And Experiments

Use Superdense as the durable home:

- `superdense hypothesis record --input <json|@file>`
- `superdense hypothesis list --project <project-id> [--status open|supported|refuted|inconclusive]`
- `superdense hypothesis resolve <id> --input <json|@file>`
- `superdense experiment open --input <json|@file>`
- `superdense experiment add-member --input <json|@file>`
- `superdense experiment verdict <id>`
- `superdense experiment list --project <project-id>`

A hypothesis statement must be structured and refutable:

```json
{
  "action": "ship one concrete action on this lever",
  "diagnostic": { "metric": "diagnostic_metric", "direction": "increase", "magnitude": 10 },
  "northStar": { "metric": "north_star_metric", "direction": "increase", "magnitude": 3 },
  "window": { "durationMs": 604800000, "label": "7 days" },
  "mechanism": "why this action should move the diagnostic and north star"
}
```

Valid directions are `increase`, `decrease`, and `maintain`. The prediction must include direction, magnitude, metric, window, and mechanism before the action ships. Do not retrofit the prediction after rewards arrive.

An experiment opens against one hypothesis, sets `targetReps`, declares a `rewardWindow`, and gains members as runs ship. `superdense experiment verdict <id>` folds the member artifacts' reward snapshots against the prediction. It returns `inconclusive` without resolving the experiment if the target reps are not met or the reward window is immature; once eligible, it resolves to `supported`, `refuted`, or `inconclusive` and updates the hypothesis status.

## Goal Template

```md
# Goal

## Outcome Boundary

Improve:
Audience:
Target surfaces:

## North Star

Primary metric:
Source of truth:
Evaluation window:

## Guardrails

-

## Constraints

-

## Human-Owned Access

-
```

## Gate Template

```md
# Gate

## Completion Rules

The run is complete only when the required checks below pass or the run records an unresolved failure and stops. Warning checks must be recorded, but they do not block completion. If no checks are known yet, leave the standard headings in place and mark the check lists as `none configured`.

## Required Checks

-

## Warning Checks

-

## Gate Phases

Checks may optionally be labeled `pre` or `post`:

- `pre`: run before shipping an irreversible real-world action.
- `post`: run after the action ships, before the run is called complete.

Unlabeled checks default to `post`. Use `pre` for expensive or irreversible actions where a cheap validation can prevent wasted external work.

## Deterministic Checks

Local scripts or commands may be listed here only when this outcome needs deterministic validation. Keep them in the outcome folder, make them runnable from the outcome folder root, and record each command plus its result in `runs/<run-id>/work.md`.

## Failure Policy

If a required check fails, try to fix the issue within the current run. If it still fails, set the run status to failed or blocked, record the reason under `## Gate Status`, and stop without presenting the run as complete.
```

A compulsory `gate.md` may be operationally empty. Missing `gate.md` is a folder-contract failure, but a `gate.md` with no configured checks is valid and should produce `Overall: pass` with `Checks run: none` in the run's `## Gate Status`.

## Run Template

```md
# Run Playbook

## Superdense Preflight

At the start of each run, launch a bounded reward-maintenance subagent when supported. It may mutate local Superdense reward state in bounded batches, but must not perform irreversible external actions.

Resolve this outcome's Superdense project id from `goal.md` target surfaces, the folder project key, or a global `superdense reward status` discovery fallback. For project-sensitive maintenance, run `superdense reward status --project <project-id>`.

Advance each actionable stage in pipeline order for this project: `profile`, `curate`, `finalize`, `reconcile`, then `collect`. Run one bounded batch per actionable stage, re-running scoped status between stages, and stop on blockers.

The preflight returns:

- reward status summary
- completed maintenance actions
- relevant cohorts/chains
- prior artifacts and reward evidence
- open, supported, refuted, and inconclusive hypotheses relevant to the project
- due or nearly due experiments and verdict results
- blockers and unresolved external access

## Lever Map

### Lever: <name>

State:

- status: candidate | promising | proven | exhausted | retired
- pull count:
- latest reward summary:
- uncertainty:
- last pulled:
- pareto-best dimension or guardrail:

Actions:

-

Diagnostics:

-

Decision rule:

-

## Selection Policy

Target explore ratio:

- Default: about 30% explore until at least one lever is proven, then retune in `outcome-update`.

Explore triggers:

- new candidate lever or hypothesis
- high-uncertainty lever with few pulls
- active experiment short of `targetReps`
- proven lever shows saturation or diminishing reward
- novelty gap in an untested lever region

Exploit triggers:

- proven lever with a supported hypothesis
- positive reward trend and remaining headroom
- low guardrail risk
- instrumentation ready enough to collect reward

Tie-break:

- Prefer the lever with the strongest expected north-star impact plus an uncertainty bonus for few pulls. This is UCB-style guidance for agent judgment, not a computed hard gate.

Keep rule:

- Keep a lever if it is Pareto-best on any reward dimension or guardrail, even if it is not best on the aggregate north star. Retire or exhaust levers only when evidence is mature enough to explain why.

## Action Selection

Choose exactly one action per run unless the human explicitly asks for exploration only. First choose `Mode: explore` or `Mode: exploit` from the Selection Policy and the lever portfolio state.

For `explore`, create or select a falsifiable hypothesis for the chosen lever, record it with `superdense hypothesis record` if it does not already exist, open or extend an experiment with `superdense experiment open` / `superdense experiment add-member`, and ship one rep.

For `exploit`, rep a proven lever with a supported hypothesis and cite the hypothesis and experiment ids it reinforces. Exploit runs still record the ids; they are not freeform actions.

## Analytics And Instrumentation

Required sources:

-

Required events or fields:

-

Setup checklist:

-

## Run Record Template

For each run, create `runs/<run-id>/work.md` and `runs/<run-id>/learnings.md` using the skeletons below. `outcome-update` may edit these skeletons when future runs need better structure.

### runs/<run-id>/work.md

# Work

Run id:
Status:
Mode:
Started:
Completed:
Outcome folder:

## Prior Evidence

Superdense status:
Relevant artifacts:
Relevant reward evidence:

## Action

Hypothesis id:
Experiment id:
Hypothesis:
Lever:
Action:
Mode rationale:
Target repo/account/surface:

## Work References

Branch:
PR:
Deploy:
Post or external URL:
Analytics events:
Superdense sessions:
Superdense artifacts:
Externalization targets:

## Gate Status

Overall:
Checks run:
Passes:
Warnings:
Failures:
Fixes attempted:
Unresolved failures:

## Blockers

-

## Follow-Ups

-

### runs/<run-id>/learnings.md

# Learnings

## From Prior Outcomes

-

## From This Execution

-

## Next Run Input

-

## Update Marker

Last reviewed run:
Last reviewed at:
```

## Example: X Reach

`goal.md`:

- North star: qualified audience growth for the X account.
- Primary metric: followers gained from target audience.
- Guardrails: no engagement bait, no low-quality follower spikes.

`run.md` lever map:

- topic selection: mine concrete founder/operator pain; diagnostics include impressions, profile visits, follows, bookmarks.
- hook quality: generate specific first-line variants; diagnostics include 2-hour impressions, replies, engagement rate.
- format: compare single post, thread, and visual; diagnostics include bookmarks and follows per impression.
- posting time: test time windows; diagnostics include early impressions and profile visits.

Run work may include final tweets directly in `work.md` or linked draft files.

`gate.md` may require no engagement bait, final copy present, external URL or scheduled-post reference recorded, Superdense session IDs listed, and warning checks for missing early diagnostics.

## Example: Landing Page Conversion

`goal.md`:

- North star: qualified signup conversion from landing-page visitors.
- Primary metric: qualified signups divided by unique landing-page visitors.
- Guardrails: lead quality, bounce rate, page performance.

`run.md` lever map:

- hero clarity: rewrite headline and CTA; diagnostics include CTA click rate, scroll depth, bounce rate.
- signup friction: reduce form friction; diagnostics include `signup_started`, `signup_completed`, form dropoff.
- trust: add proof or examples; diagnostics include pricing clicks, testimonial interactions, qualified signup rate.
- traffic-message match: source-specific variants; diagnostics include conversion by source and CTA click by source.

Run work points to the target website repo branch, PR, deploy URL, analytics events, and Superdense IDs.

`gate.md` may require relevant tests to pass, the run record to include branch/PR/deploy references, analytics event names to be listed, and no unresolved required gate failures before completion.

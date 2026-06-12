# Outcome Loop Reference

## Core Model

The outcome folder is a control plane, not a duplicate analytics database. It records what the human and agent are trying to improve, how the loop currently operates, where work happened, and what the current run learned.

Superdense owns durable outcome evidence:

- sessions
- artifacts
- externalization targets
- reward snapshots
- cohort and version-chain comparison

Do not create `metrics.md`. If metrics are collected but cannot yet be recorded in Superdense, keep the note temporary in `work.md` under a blocker section and resolve it by recording the reward snapshot.

## Folder Contract

```text
<outcome-folder>/
  goal.md
  run.md
  runs/
    <run-id>/
      work.md
      learnings.md
```

Optional files are allowed only when the outcome needs them, for example draft assets for an X run. The fixed core stays small.

## Concepts

- North star: the stable real-world outcome that counts as progress.
- Guardrails: measurements or constraints that prevent cheap wins from degrading quality.
- Lever: a mechanism believed to influence the north star.
- Action: one concrete intervention the agent or human can take on a lever.
- Diagnostic metric: a measurement that explains why a lever did or did not move the north star.

`goal.md` protects the north star and guardrails. `run.md` evolves the lever map, action recipes, diagnostic measurements, instrumentation checklist, and Superdense workflow.

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

## Run Template

```md
# Run Playbook

## Superdense Preflight

At the start of each run, launch a bounded reward-maintenance subagent when supported. It may mutate local Superdense reward state in bounded batches, but must not perform irreversible external actions.

The preflight returns:

- reward status summary
- completed maintenance actions
- relevant cohorts/chains
- prior artifacts and reward evidence
- blockers and unresolved external access

## Lever Map

### Lever: <name>

Actions:

-

Diagnostics:

-

Decision rule:

-

## Analytics And Instrumentation

Required sources:

-

Required events or fields:

-

Setup checklist:

-

## Run Record Template

Create `runs/<run-id>/work.md` and `runs/<run-id>/learnings.md`.
```

## Work Template

```md
# Work

Run id:
Started:
Outcome folder:

## Prior Evidence

Superdense status:
Relevant artifacts:
Relevant reward evidence:

## Intervention

Hypothesis:
Lever:
Action:
Target repo/account/surface:

## Work References

Branch:
PR:
Deploy:
Post or external URL:
Superdense sessions:
Superdense artifacts:
Externalization targets:

## Follow-Ups

-
```

## Learnings Template

```md
# Learnings

## From Prior Outcomes

-

## From This Execution

-

## Next Run Input

-
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

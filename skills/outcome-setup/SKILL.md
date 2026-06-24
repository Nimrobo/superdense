---
name: outcome-setup
version: 0.3.0
description: Set up or repair one outcome-loop folder for improving a real-world outcome. Use when the user wants to define goal.md, run.md, analytics/instrumentation, levers, target repos/accounts, or the folder contract for an outcome loop.
---

# Outcome Setup

Set up one outcome folder as the control plane for improving a real-world outcome. Superdense remains the durable store for sessions, artifacts, externalization targets, and reward snapshots.

Read `references/outcome-loop.md` before writing or repairing files.

## Outcome Packs

If the user asks to set up an outcome pack, resolve the pack before scaffolding files:

1. Use `superdense outcome-pack get <exact-name>` when the user provides an exact pack name such as `x-reach`.
2. Use `superdense outcome-pack search <keyword>` when the user provides a descriptive name or fuzzy intent such as "X reach" or "landing page".
3. Use `superdense outcome-pack list` when the available pack names are unknown.
4. Treat `list` and `search` responses as JSON. Use the returned `name` field as the exact name for `get`.
5. Treat `get` as the source markdown for the pack's starting `goal.md`, `run.md`, and `gate.md` shape.
6. Adapt the fetched pack to the user's actual folder, target surfaces, analytics, guardrails, and constraints. Do not copy it blindly when local context contradicts it.

## Workflow

1. Locate or choose the outcome folder. One folder manages one outcome. It may sit above target repos/accounts.
2. Inspect existing files and target surfaces before asking questions. Discover target repo conventions, analytics libraries, env patterns, and existing events from files and docs where possible.
3. Ask the human only for non-discoverable intent or external access:
   - north-star outcome and audience,
   - guardrails and constraints,
   - target surfaces such as repos, accounts, pages, campaigns, or dashboards,
   - acceptable analytics access and any required human setup.
4. Create or repair only the small fixed core:
   - `goal.md`
   - `run.md`
   - `gate.md`
   - `runs/`
5. Put the scaffold under git. If the outcome folder is already inside a parent git work tree, commit the new files there. Otherwise run `git init` in the outcome folder. Then stage and commit the scaffold, for example `git add goal.md run.md gate.md runs/ && git commit -m "outcome: scaffold <outcome-name>"`.
6. Do not create `metrics.md`, `hypotheses.md`, or `experiments.md`. Durable measurement results belong in Superdense reward snapshots; structured hypotheses and experiment verdicts belong in Superdense through `superdense hypothesis ...` and `superdense experiment ...`.
7. In `run.md`, scaffold the lever portfolio fields from `references/outcome-loop.md`: lever status, pull count, latest reward summary, uncertainty, last pulled, and Pareto-best dimension or guardrail. Also scaffold the Selection Policy with target explore ratio, explore triggers, exploit triggers, tie-break, and keep rule.
8. Put measurement definitions, diagnostics, event names, source systems, and instrumentation checklist in `run.md`.
9. Define `gate.md` as reusable completion policy, not a per-run checklist. Include the standard sections from `references/outcome-loop.md`: `# Gate`, `## Completion Rules`, `## Required Checks`, `## Warning Checks`, optional `## Gate Phases`, `## Deterministic Checks`, and `## Failure Policy`. It may be operationally empty when no checks are known yet; mark lists as `none configured` instead of inventing fake checks.
10. Add local deterministic check scripts only when this outcome needs them. Keep them inside the outcome folder, reference them from `gate.md`, and do not add bundled or generic script templates.
11. If analytics/instrumentation is missing and the target repo is available, implement the smallest viable instrumentation in that target repo after inspecting local conventions. Never commit private credentials. Treat public client tokens according to target repo conventions.
12. If external account setup is required, pause with a concrete checklist for the human. Continue once the human provides access or confirms setup.

## File Responsibilities

- `goal.md` is protected. It defines the outcome boundary, audience, north-star metric, guardrails, target surfaces, and human-owned constraints.
- `run.md` is mutable. It defines the current lever portfolio, actions, diagnostic measurements, analytics/instrumentation checklist, Superdense reward preflight, Selection Policy, action selection rules, and run template.
- `gate.md` is reusable completion policy. It defines required checks, warning checks, optional pre/post phases, deterministic checks when needed, and the failure policy for every run.
- `runs/` starts empty unless the user is repairing an existing loop.

## Version Control

Initialize git only when the outcome folder is not already inside a git work tree. If a parent repo tracks the folder, avoid nesting a repository and commit `goal.md`, `run.md`, `gate.md`, and `runs/` in the parent repo instead. Never commit private credentials; use `.gitignore` for local secrets, drafts, exports, or account-specific files that should stay untracked.

## Dry Run

If the user asks for a dry run, show the proposed `goal.md`, `run.md`, and `gate.md` contents plus the git commands that would run, without writing files, running git, or changing target repos.

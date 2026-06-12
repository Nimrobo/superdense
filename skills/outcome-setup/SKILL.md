---
name: outcome-setup
version: 0.1.0
description: Set up or repair one outcome-loop folder for improving a real-world outcome. Use when the user wants to define goal.md, run.md, analytics/instrumentation, levers, target repos/accounts, or the folder contract for an outcome loop.
---

# Outcome Setup

Set up one outcome folder as the control plane for improving a real-world outcome. Superdense remains the durable store for sessions, artifacts, externalization targets, and reward snapshots.

Read `references/outcome-loop.md` before writing or repairing files.

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
   - `runs/`
5. Do not create `metrics.md`. Durable measurement results belong in Superdense reward snapshots. Put measurement definitions, diagnostics, event names, source systems, and instrumentation checklist in `run.md`.
6. If analytics/instrumentation is missing and the target repo is available, implement the smallest viable instrumentation in that target repo after inspecting local conventions. Never commit private credentials. Treat public client tokens according to target repo conventions.
7. If external account setup is required, pause with a concrete checklist for the human. Continue once the human provides access or confirms setup.

## File Responsibilities

- `goal.md` is protected. It defines the outcome boundary, audience, north-star metric, guardrails, target surfaces, and human-owned constraints.
- `run.md` is mutable. It defines the current lever map, actions, diagnostic measurements, analytics/instrumentation checklist, Superdense reward preflight, intervention rules, and run template.
- `runs/` starts empty unless the user is repairing an existing loop.

## Dry Run

If the user asks for a dry run, show the proposed `goal.md` and `run.md` contents without writing files or changing target repos.

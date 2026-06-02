---
name: superdense-reward-collect
version: 0.1.0
description: Record multidimensional reward snapshots for finalized Superdense artifacts that are linked to real-world external identities.
allowed-tools: Bash(superdense *)
---

# Superdense Reward Collect

Collect how externalized artifacts are performing. For each linked external identity, gather its
current metrics and report a multidimensional reward snapshot. Superdense stores the snapshot; it
never runs connectors itself.

## Workflow

1. Find the linked targets that can be collected. Reconciliation (Layer 4) already attached an
   authoritative `locator` to each:

   ```bash
   superdense externalization list --status linked
   ```

   Each artifact's `targets[]` lists `{ id, connector, locator }`. The target `id` is what you
   record against.

2. For each linked target, gather its current real-world metrics using whatever tool you have — a
   platform CLI, the provider's own API, or the open web. Superdense neither installs nor runs
   connectors; you collect the numbers. The target's `connector` is just a free-text platform label.

3. Record one append-only snapshot per target:

   ```bash
   superdense reward record --input '{
     "targetId": "<externalization target id>",
     "metrics": { "views": 1200, "likes": 34, "reposts": 5 },
     "primaryDim": "views",
     "source": "x api",
     "evidence": "Fetched from the post analytics endpoint"
   }'
   ```

   `metrics` is a flat map of dimension -> finite number — the multidimensional reward. Snapshots
   are append-only; recording again later appends a new point to the time series.

4. Confirm the recorded series:

   ```bash
   superdense reward show <artifact-id>
   ```

## Rules

- Only `linked` targets are collectable. A snapshot against a non-linked target is rejected.
- `metrics` must be a non-empty object of finite numbers. Keep richer provider detail in `evidence`
  or `source`, not in `metrics`.
- `primaryDim`, when set, must be one of the keys in `metrics`. It names the headline dimension.
- `capturedAt` (epoch millis) is optional; omit it to stamp the current time.
- Reuse a loose shared vocabulary across connectors where it applies — for example `reach`,
  `engagement`, `reactions`, `conversions` — so later cohort comparison can align on common axes,
  while still keeping connector-specific dimensions.
- Never fabricate metrics. If you cannot gather a target's numbers, skip it and report why.

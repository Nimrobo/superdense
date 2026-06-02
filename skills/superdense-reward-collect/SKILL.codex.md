---
name: superdense-reward-collect
version: 0.1.0
description: Record multidimensional reward snapshots for finalized Superdense artifacts that are linked to real-world external identities.
---

# Superdense Reward Collect

Use this skill when the user asks to collect reward metrics for externalized artifacts.

1. List collectable identities with `superdense externalization list --status linked`. Each
   artifact's `targets[]` gives `{ id, connector, locator }`; the target `id` is the record anchor.
2. For each linked target, gather its current real-world metrics with whatever tool you have — a
   platform CLI, the provider API, or the open web. Superdense never installs or runs connectors; you
   collect the numbers. The target's `connector` is just a free-text platform label.
3. Record one append-only snapshot per target:
   `superdense reward record --input '{"targetId":"<id>","metrics":{"views":1200,"likes":34},"primaryDim":"views","source":"<tool>","evidence":"<how>"}'`.
4. Confirm with `superdense reward show <artifact-id>`.

`metrics` is a flat map of dimension -> finite number (the multidimensional reward); keep richer
provider detail in `evidence`/`source`. `primaryDim`, when set, must be a key in `metrics`.
`capturedAt` (epoch millis) is optional and defaults to now. Only `linked` targets are collectable.
Reuse a loose shared vocabulary (`reach`, `engagement`, `reactions`, `conversions`) where it applies
so later cohorts align, while keeping connector-specific dimensions. Never fabricate metrics; skip a
target you cannot gather and report why.

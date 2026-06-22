# Collect

Collect how externalized artifacts are performing. For each linked external identity, gather its current metrics and report a multidimensional reward snapshot. Superdense stores the snapshot; it never runs connectors itself.

## Workflow

1. Retire matured targets first so you never re-collect a target whose reward window has closed, then find the active linked targets that can be collected. Scope by project:

   ```bash
   superdense reward collect retire --project <id>
   superdense externalization list --project <id> --status linked
   ```

   `reward collect retire` marks matured targets `retired` (per-target override, else the 7-day default). `externalization list` is **active-only by default** — retired targets are hidden unless you pass `--include-retired`. Each artifact's `targets[]` lists `{ id, connector, locator, collectStatus }`; collect only these `active` targets. The target `id` is what you record against. (Inside an outcome-run preflight, `reward next` has already run retirement, so you can skip the explicit `reward collect retire` call.)

2. For each linked target, run `superdense reward docs connectors --connector <name>` for usage guidance, then gather its current real-world metrics using whatever tool you have: a platform CLI, the provider's own API, or the open web. If a connector fetch or collection attempt fails, run `superdense reward docs connectors --connector <name> --section troubleshoot`. Superdense neither installs nor runs connectors; you collect the numbers. The target's `connector` is just a free-text platform label.

3. Gather all available target metrics first, then record one atomic batch:

   ```bash
   superdense reward record-batch --input '{
     "snapshots": [
       {
         "targetId": "<externalization target id>",
         "metrics": { "views": 1200, "likes": 34, "reposts": 5 },
         "primaryDim": "views",
         "source": "x api",
         "evidence": "Fetched from the post analytics endpoint"
       }
     ]
   }'
   ```

   The batch accepts at most 100 snapshots, preserves input order, and rolls
   back completely if any item is invalid or targets a non-linked identity.
   For a one-off repair, `superdense reward record --input ...` remains
   supported. `metrics` is a flat map of dimension -> finite number: the
   multidimensional reward. Recording again later appends a new point.

4. Confirm the recorded series:

   ```bash
   superdense reward show <artifact-id> --full
   ```

## Rules

- Only `active` `linked` targets are collectable. A snapshot against a non-linked target is rejected; a `retired` target has matured out of collection — skip it instead of recording.
- An active target stays collectable until it retires — having a prior snapshot does **not** remove it. Record a fresh snapshot for every active target you can gather numbers for, even ones that already have points; that is how a multi-point series accrues over a target's reward window. Retirement (count quota or the time backstop), not the presence of a snapshot, is what ends collection.
- A target retires once its reward window matures: 7 days after its first snapshot by default, or per the `retireAfterMs` / `retireAfterN` override fixed at externalization-assess time. Run `superdense reward collect retire --project <id>` to apply the policy, or `superdense reward collect retire <target-id>` to force one.
- `metrics` must be a non-empty object of finite numbers. Keep richer provider detail in `evidence` or `source`, not in `metrics`.
- `primaryDim`, when set, must be one of the keys in `metrics`. It names the headline dimension.
- `capturedAt` as epoch millis is optional; omit it to stamp the current time.
- Reuse the loose shared vocabulary from `superdense reward docs connectors --connector <name>` where it applies, for example `reach`, `engagement`, `reactions`, and `conversions`, so later cohort comparison can align on common axes while still keeping connector-specific dimensions.
- Never fabricate metrics. If you cannot gather a target's numbers, skip it and report why.

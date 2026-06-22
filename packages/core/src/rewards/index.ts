import { randomUUID } from 'node:crypto';
import { DEFAULT_RETIRE_AFTER_MS, getDb, withImmediateTransaction } from '../db.js';
import { getProjectProfileResolution } from '../projects/index.js';

// Layer 4 reward collection. Superdense never executes connectors: an agent
// gathers current metrics with whatever tool it judges best and reports a
// multidimensional reward snapshot. Snapshots are append-only and anchored on a
// linked externalization target so Layer 5 can compare across targets and
// artifacts at read time. `metrics` is a flat map of dimension -> finite number;
// Superdense imposes no global normalization.

export interface RewardSnapshot {
  id: string;
  targetId: string;
  capturedAt: number;
  metrics: Record<string, number>;
  primaryDim: string | null;
  source: string | null;
  evidence: string | null;
  createdAt: number;
}

export type CollectStatus = 'active' | 'retired';

export interface RewardTargetSeries {
  targetId: string;
  connector: string;
  locator: string | null;
  collectStatus: CollectStatus;
  latest: RewardSnapshot | null;
  snapshots: RewardSnapshot[];
}

export interface ArtifactRewards {
  artifactId: string;
  targets: RewardTargetSeries[];
}

interface RewardSnapshotRow {
  id: string;
  target_id: string;
  captured_at: number;
  metrics: string;
  primary_dim: string | null;
  source: string | null;
  evidence: string | null;
  created_at: number;
}

interface LinkedTargetRow {
  id: string;
  connector: string;
  locator: string | null;
  collect_status: CollectStatus;
}

function expectObject(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${field} must be an object`);
  }
  return value as Record<string, unknown>;
}

function expectString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${field} must be a non-empty string`);
  }
  return value;
}

function expectNullableString(value: unknown, field: string): string | null {
  if (value == null) return null;
  if (typeof value !== 'string') throw new Error(`${field} must be a string or null`);
  return value;
}

function expectMetrics(value: unknown): Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('metrics must be a non-empty object of finite numbers');
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0) {
    throw new Error('metrics must be a non-empty object of finite numbers');
  }
  const metrics: Record<string, number> = {};
  for (const [key, raw] of entries) {
    if (typeof raw !== 'number' || !Number.isFinite(raw)) {
      throw new Error(`metrics.${key} must be a finite number`);
    }
    metrics[key] = raw;
  }
  return metrics;
}

function expectCapturedAt(value: unknown, now: number): number {
  if (value == null) return now;
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new Error('capturedAt must be an integer epoch millisecond timestamp');
  }
  return value;
}

function rowToSnapshot(row: RewardSnapshotRow): RewardSnapshot {
  return {
    id: row.id,
    targetId: row.target_id,
    capturedAt: row.captured_at,
    metrics: JSON.parse(row.metrics) as Record<string, number>,
    primaryDim: row.primary_dim,
    source: row.source,
    evidence: row.evidence,
    createdAt: row.created_at,
  };
}

interface ValidatedRewardSnapshot {
  id: string;
  targetId: string;
  capturedAt: number;
  metrics: Record<string, number>;
  primaryDim: string | null;
  source: string | null;
  evidence: string | null;
  createdAt: number;
}

function validateRewardSnapshot(input: unknown, now: number): ValidatedRewardSnapshot {
  const body = expectObject(input, 'input');
  const targetId = expectString(body.targetId, 'targetId');
  const metrics = expectMetrics(body.metrics);
  const primaryDim = expectNullableString(body.primaryDim, 'primaryDim');
  if (primaryDim != null && !Object.prototype.hasOwnProperty.call(metrics, primaryDim)) {
    throw new Error('primaryDim must be a key in metrics');
  }
  const source = expectNullableString(body.source, 'source');
  const evidence = expectNullableString(body.evidence, 'evidence');
  return {
    id: randomUUID(),
    targetId,
    capturedAt: expectCapturedAt(body.capturedAt, now),
    metrics,
    primaryDim,
    source,
    evidence,
    createdAt: now,
  };
}

function insertValidatedSnapshots(snapshots: ValidatedRewardSnapshot[]): RewardSnapshot[] {
  const db = getDb();
  return withImmediateTransaction(db, () => {
    const findTarget = db.prepare('SELECT id, status FROM externalization_target WHERE id = ?');
    for (const snapshot of snapshots) {
      const target = findTarget.get(snapshot.targetId) as
        | { id: string; status: string }
        | undefined;
      if (!target) throw new Error(`externalization target not found: ${snapshot.targetId}`);
      if (target.status !== 'linked') {
        throw new Error(
          `reward snapshots require a linked externalization target: ${snapshot.targetId}`,
        );
      }
    }
    const insert = db.prepare(
      `INSERT INTO reward_snapshot (
         id, target_id, captured_at, metrics, primary_dim, source, evidence, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const snapshot of snapshots) {
      insert.run(
        snapshot.id,
        snapshot.targetId,
        snapshot.capturedAt,
        JSON.stringify(snapshot.metrics),
        snapshot.primaryDim,
        snapshot.source,
        snapshot.evidence,
        snapshot.createdAt,
      );
    }
    return snapshots;
  });
}

export function recordRewardSnapshot(input: unknown): { ok: true; snapshot: RewardSnapshot } {
  const snapshot = validateRewardSnapshot(input, Date.now());
  insertValidatedSnapshots([snapshot]);
  return {
    ok: true,
    snapshot,
  };
}

export function recordRewardSnapshotBatch(input: unknown): {
  ok: true;
  snapshots: RewardSnapshot[];
} {
  const body = expectObject(input, 'input');
  if (!Array.isArray(body.snapshots) || body.snapshots.length === 0) {
    throw new Error('snapshots must be a non-empty array');
  }
  if (body.snapshots.length > 100) {
    throw new Error('snapshots must contain at most 100 items');
  }
  const now = Date.now();
  const snapshots = body.snapshots.map((snapshot, index) => {
    try {
      return validateRewardSnapshot(snapshot, now);
    } catch (err) {
      throw new Error(`snapshots[${index}]: ${err instanceof Error ? err.message : String(err)}`, {
        cause: err,
      });
    }
  });
  return { ok: true, snapshots: insertValidatedSnapshots(snapshots) };
}

export function listRewardSnapshots(targetId: string): RewardSnapshot[] {
  const rows = getDb()
    .prepare(
      `SELECT * FROM reward_snapshot
        WHERE target_id = ?
        ORDER BY captured_at DESC, id ASC`,
    )
    .all(targetId) as RewardSnapshotRow[];
  return rows.map(rowToSnapshot);
}

export function getArtifactRewards(artifactId: string): ArtifactRewards | null {
  const db = getDb();
  const artifact = db
    .prepare('SELECT id FROM work_thread WHERE id = ? AND artifact_type IS NOT NULL')
    .get(artifactId) as { id: string } | undefined;
  if (!artifact) return null;

  const linkedTargets = db
    .prepare(
      `SELECT id, connector, locator, collect_status FROM externalization_target
        WHERE artifact_id = ? AND status = 'linked'
        ORDER BY created_at, id`,
    )
    .all(artifactId) as LinkedTargetRow[];

  const targets = linkedTargets.map((target): RewardTargetSeries => {
    const snapshots = listRewardSnapshots(target.id);
    return {
      targetId: target.id,
      connector: target.connector,
      locator: target.locator,
      collectStatus: target.collect_status,
      latest: snapshots[0] ?? null,
      snapshots,
    };
  });

  return { artifactId, targets };
}

// Reward-collection lifecycle. A linked target stays collectable until it
// retires; retirement is the only thing that removes it from the collect list,
// so the live set stays bounded without targets lingering forever. A target's
// effective policy is:
//   - count quota (retire_after_n set): retire early once snapshot_count >= n
//   - time backstop (always applies): retire once the first snapshot is
//     retire_after_ms old, or DEFAULT_RETIRE_AFTER_MS old when no override.
// Whichever triggers first wins. The time backstop applies even when a count
// quota is set, so a target whose quota is never filled still retires instead of
// sitting active forever. A target with no snapshots is never retired
// automatically (the clock starts at the first snapshot).
export type RetireReason = 'time' | 'count' | 'manual';

export interface RetiredTarget {
  targetId: string;
  artifactId: string;
  connector: string;
  snapshotCount: number;
  firstCapturedAt: number | null;
  reason: RetireReason;
}

interface RetireCandidateRow {
  id: string;
  artifact_id: string;
  connector: string;
  retire_after_ms: number | null;
  retire_after_n: number | null;
  first_captured_at: number | null;
  snapshot_count: number;
}

function evaluateRetirement(row: RetireCandidateRow, now: number): RetireReason | null {
  if (row.snapshot_count <= 0 || row.first_captured_at == null) return null;
  if (row.retire_after_n != null && row.snapshot_count >= row.retire_after_n) {
    return 'count';
  }
  // Time backstop always applies (default unless retire_after_ms overrides), so
  // a target whose count quota is never reached still retires by age.
  const effectiveMs = row.retire_after_ms ?? DEFAULT_RETIRE_AFTER_MS;
  if (now - row.first_captured_at >= effectiveMs) {
    return 'time';
  }
  return null;
}

export function retireCollectTargets(opts: { projectId?: string } = {}): {
  ok: true;
  retired: RetiredTarget[];
} {
  const db = getDb();
  const canonicalProjectId = opts.projectId
    ? (getProjectProfileResolution(opts.projectId)?.project.id ??
      (() => {
        throw new Error(`project not found: ${opts.projectId}`);
      })())
    : null;
  const now = Date.now();
  return withImmediateTransaction(db, () => {
    const rows = db
      .prepare(
        `SELECT et.id              AS id,
                et.artifact_id      AS artifact_id,
                et.connector        AS connector,
                et.retire_after_ms  AS retire_after_ms,
                et.retire_after_n   AS retire_after_n,
                MIN(rs.captured_at) AS first_captured_at,
                COUNT(rs.id)        AS snapshot_count
           FROM externalization_target et
           JOIN work_thread wt ON wt.id = et.artifact_id
           LEFT JOIN reward_snapshot rs ON rs.target_id = et.id
          WHERE et.status = 'linked'
            AND et.collect_status = 'active'
            AND (? IS NULL OR wt.project_profile_id = ?)
          GROUP BY et.id`,
      )
      .all(canonicalProjectId, canonicalProjectId) as RetireCandidateRow[];

    const update = db.prepare(
      `UPDATE externalization_target
          SET collect_status = 'retired', retired_at = ?, updated_at = ?
        WHERE id = ? AND collect_status = 'active'`,
    );
    const retired: RetiredTarget[] = [];
    for (const row of rows) {
      const reason = evaluateRetirement(row, now);
      if (!reason) continue;
      update.run(now, now, row.id);
      retired.push({
        targetId: row.id,
        artifactId: row.artifact_id,
        connector: row.connector,
        snapshotCount: row.snapshot_count,
        firstCapturedAt: row.first_captured_at,
        reason,
      });
    }
    return { ok: true, retired };
  });
}

// Reconcile-stage hygiene. A non-located target (the artifact was assessed as
// external but the connector match was never resolved: needs_connector,
// not_found, or ambiguous) is retired once it has been unlocatable for
// DEFAULT_RETIRE_AFTER_MS, so it stops resurfacing in the reconcile inbox
// forever. Unlike collect retirement this is age-based on created_at (there are
// no snapshots to anchor on). Artifacts that were never assessed (no target
// row) are deliberately left alone.
export function retireUnlocatableTargets(opts: { projectId?: string } = {}): {
  ok: true;
  retired: RetiredTarget[];
} {
  const db = getDb();
  const canonicalProjectId = opts.projectId
    ? (getProjectProfileResolution(opts.projectId)?.project.id ??
      (() => {
        throw new Error(`project not found: ${opts.projectId}`);
      })())
    : null;
  const now = Date.now();
  return withImmediateTransaction(db, () => {
    const rows = db
      .prepare(
        `SELECT et.id          AS id,
                et.artifact_id  AS artifact_id,
                et.connector    AS connector,
                et.created_at   AS created_at
           FROM externalization_target et
           JOIN work_thread wt ON wt.id = et.artifact_id
          WHERE et.status IN ('needs_connector', 'not_found', 'ambiguous')
            AND et.collect_status = 'active'
            AND (? IS NULL OR wt.project_profile_id = ?)`,
      )
      .all(canonicalProjectId, canonicalProjectId) as Array<{
      id: string;
      artifact_id: string;
      connector: string;
      created_at: number;
    }>;

    const update = db.prepare(
      `UPDATE externalization_target
          SET collect_status = 'retired', retired_at = ?, updated_at = ?
        WHERE id = ? AND collect_status = 'active'`,
    );
    const retired: RetiredTarget[] = [];
    for (const row of rows) {
      if (now - row.created_at < DEFAULT_RETIRE_AFTER_MS) continue;
      update.run(now, now, row.id);
      retired.push({
        targetId: row.id,
        artifactId: row.artifact_id,
        connector: row.connector,
        snapshotCount: 0,
        firstCapturedAt: null,
        reason: 'time',
      });
    }
    return { ok: true, retired };
  });
}

export function retireCollectTarget(targetId: string): {
  ok: true;
  retired: RetiredTarget | null;
} {
  const db = getDb();
  const now = Date.now();
  return withImmediateTransaction(db, () => {
    const row = db
      .prepare(
        `SELECT et.id              AS id,
                et.artifact_id      AS artifact_id,
                et.connector        AS connector,
                et.status           AS status,
                et.collect_status   AS collect_status,
                MIN(rs.captured_at) AS first_captured_at,
                COUNT(rs.id)        AS snapshot_count
           FROM externalization_target et
           LEFT JOIN reward_snapshot rs ON rs.target_id = et.id
          WHERE et.id = ?
          GROUP BY et.id`,
      )
      .get(targetId) as
      | (RetireCandidateRow & { status: string; collect_status: CollectStatus })
      | undefined;
    if (!row) throw new Error(`externalization target not found: ${targetId}`);
    if (row.status !== 'linked') {
      throw new Error(`only linked targets can be retired: ${targetId}`);
    }
    if (row.collect_status === 'retired') return { ok: true, retired: null };
    db.prepare(
      `UPDATE externalization_target
          SET collect_status = 'retired', retired_at = ?, updated_at = ?
        WHERE id = ?`,
    ).run(now, now, targetId);
    return {
      ok: true,
      retired: {
        targetId: row.id,
        artifactId: row.artifact_id,
        connector: row.connector,
        snapshotCount: row.snapshot_count,
        firstCapturedAt: row.first_captured_at,
        reason: 'manual',
      },
    };
  });
}

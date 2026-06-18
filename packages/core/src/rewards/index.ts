import { randomUUID } from 'node:crypto';
import { getDb, withImmediateTransaction } from '../db.js';

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

export interface RewardTargetSeries {
  targetId: string;
  connector: string;
  locator: string | null;
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
      `SELECT id, connector, locator FROM externalization_target
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
      latest: snapshots[0] ?? null,
      snapshots,
    };
  });

  return { artifactId, targets };
}

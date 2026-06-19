import { randomUUID } from 'node:crypto';
import { getDb, withImmediateTransaction } from '../db.js';
import {
  getHypothesis,
  resolveHypothesis,
  type Hypothesis,
  type HypothesisStatus,
  type PredictionTarget,
} from '../hypotheses/index.js';

export type ExperimentStatus = 'open' | 'complete' | 'inconclusive';
export type ExperimentVerdict = Exclude<HypothesisStatus, 'open'>;

export interface ExperimentRewardWindow {
  startAt: number | null;
  endAt: number | null;
  durationMs: number | null;
  label: string | null;
}

export interface ExperimentMember {
  experimentId: string;
  runId: string;
  artifactId: string | null;
  role: string;
  addedAt: number;
}

export interface Experiment {
  id: string;
  hypothesisId: string;
  status: ExperimentStatus;
  targetReps: number;
  rewardWindow: ExperimentRewardWindow;
  predictedSummary: string;
  observedSummary: Record<string, unknown> | null;
  verdict: ExperimentVerdict | null;
  createdAt: number;
  resolvedAt: number | null;
  members: ExperimentMember[];
}

export interface OpenExperimentInput {
  id?: string;
  hypothesisId: string;
  targetReps: number;
  rewardWindow: Partial<ExperimentRewardWindow>;
  predictedSummary?: string;
  createdAt?: number;
}

export interface AddExperimentMemberInput {
  experimentId: string;
  runId: string;
  artifactId?: string | null;
  role?: string;
  addedAt?: number;
}

export interface ListExperimentsOptions {
  projectId?: string;
  hypothesisId?: string;
  status?: ExperimentStatus;
  limit?: number;
}

export interface ExperimentVerdictResult {
  ok: true;
  experiment: Experiment;
  hypothesis: Hypothesis;
  verdict: ExperimentVerdict;
  resolved: boolean;
  observedSummary: Record<string, unknown>;
}

interface ExperimentRow {
  id: string;
  hypothesis_id: string;
  status: ExperimentStatus;
  target_reps: number;
  reward_window: string;
  predicted_summary: string;
  observed_summary: string | null;
  verdict: ExperimentVerdict | null;
  created_at: number;
  resolved_at: number | null;
}

interface ExperimentMemberRow {
  experiment_id: string;
  run_id: string;
  artifact_id: string | null;
  role: string;
  added_at: number;
}

interface SnapshotRow {
  artifact_id: string;
  target_id: string;
  captured_at: number;
  metrics: string;
}

interface PredictionCheck {
  metric: string;
  expected: PredictionTarget;
  observed: number | null;
  pass: boolean | null;
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
  return value.trim();
}

function expectOptionalString(value: unknown, field: string): string | null {
  if (value == null) return null;
  if (typeof value !== 'string') throw new Error(`${field} must be a string or null`);
  return value.trim() || null;
}

function expectPositiveInteger(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${field} must be a positive integer`);
  }
  return value;
}

function expectNonNegativeInteger(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${field} must be a non-negative integer`);
  }
  return value;
}

function parseJsonObject(raw: string | null): Record<string, unknown> | null {
  if (raw == null) return null;
  try {
    const value = JSON.parse(raw) as unknown;
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function validateExperimentStatus(value: unknown, field: string): ExperimentStatus {
  if (value === 'open' || value === 'complete' || value === 'inconclusive') return value;
  throw new Error(`${field} must be open, complete, or inconclusive`);
}

function validateRewardWindow(value: unknown): ExperimentRewardWindow {
  const body = expectObject(value, 'rewardWindow');
  const startAt =
    body.startAt == null ? null : expectNonNegativeInteger(body.startAt, 'rewardWindow.startAt');
  const endAt =
    body.endAt == null ? null : expectNonNegativeInteger(body.endAt, 'rewardWindow.endAt');
  const durationMs =
    body.durationMs == null
      ? null
      : expectPositiveInteger(body.durationMs, 'rewardWindow.durationMs');
  if (endAt == null && durationMs == null) {
    throw new Error('rewardWindow requires endAt or durationMs');
  }
  if (startAt != null && endAt != null && endAt < startAt) {
    throw new Error('rewardWindow.endAt must be greater than or equal to startAt');
  }
  return {
    startAt,
    endAt,
    durationMs,
    label: expectOptionalString(body.label, 'rewardWindow.label'),
  };
}

function memberFromRow(row: ExperimentMemberRow): ExperimentMember {
  return {
    experimentId: row.experiment_id,
    runId: row.run_id,
    artifactId: row.artifact_id,
    role: row.role,
    addedAt: row.added_at,
  };
}

function rowToExperiment(row: ExperimentRow, members: ExperimentMember[]): Experiment {
  return {
    id: row.id,
    hypothesisId: row.hypothesis_id,
    status: row.status,
    targetReps: row.target_reps,
    rewardWindow: validateRewardWindow(JSON.parse(row.reward_window) as unknown),
    predictedSummary: row.predicted_summary,
    observedSummary: parseJsonObject(row.observed_summary),
    verdict: row.verdict,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
    members,
  };
}

function getExperimentMembers(experimentId: string): ExperimentMember[] {
  const rows = getDb()
    .prepare(
      `SELECT * FROM experiment_member
        WHERE experiment_id = ?
        ORDER BY added_at ASC, run_id ASC, role ASC`,
    )
    .all(experimentId) as ExperimentMemberRow[];
  return rows.map(memberFromRow);
}

function predictedSummaryFor(hypothesis: Hypothesis): string {
  const { statement } = hypothesis;
  return `${statement.action} should move ${statement.diagnostic.metric} ${statement.diagnostic.direction} by ${statement.diagnostic.magnitude} and ${statement.northStar.metric} ${statement.northStar.direction} by ${statement.northStar.magnitude} within ${statement.window.durationMs}ms.`;
}

function validateOpenInput(
  input: unknown,
  now: number,
): {
  id: string;
  hypothesisId: string;
  targetReps: number;
  rewardWindow: ExperimentRewardWindow;
  predictedSummary: string | null;
  createdAt: number;
} {
  const body = expectObject(input, 'input');
  return {
    id: body.id == null ? randomUUID() : expectString(body.id, 'id'),
    hypothesisId: expectString(body.hypothesisId, 'hypothesisId'),
    targetReps: expectPositiveInteger(body.targetReps, 'targetReps'),
    rewardWindow: validateRewardWindow(body.rewardWindow),
    predictedSummary:
      body.predictedSummary == null
        ? null
        : expectString(body.predictedSummary, 'predictedSummary'),
    createdAt: body.createdAt == null ? now : expectPositiveInteger(body.createdAt, 'createdAt'),
  };
}

function validateAddMemberInput(input: unknown, now: number): Required<AddExperimentMemberInput> {
  const body = expectObject(input, 'input');
  return {
    experimentId: expectString(body.experimentId, 'experimentId'),
    runId: expectString(body.runId, 'runId'),
    artifactId: body.artifactId == null ? null : expectString(body.artifactId, 'artifactId'),
    role: body.role == null ? 'rep' : expectString(body.role, 'role'),
    addedAt: body.addedAt == null ? now : expectPositiveInteger(body.addedAt, 'addedAt'),
  };
}

export function getExperiment(id: string): Experiment | null {
  const row = getDb().prepare('SELECT * FROM experiment WHERE id = ?').get(id) as
    | ExperimentRow
    | undefined;
  return row ? rowToExperiment(row, getExperimentMembers(id)) : null;
}

export function openExperiment(input: unknown): { ok: true; experiment: Experiment } {
  const now = Date.now();
  const experiment = validateOpenInput(input, now);
  const db = getDb();
  withImmediateTransaction(db, () => {
    const hypothesis = getHypothesis(experiment.hypothesisId);
    if (!hypothesis) throw new Error(`hypothesis not found: ${experiment.hypothesisId}`);
    db.prepare(
      `INSERT INTO experiment (
         id, hypothesis_id, status, target_reps, reward_window, predicted_summary,
         observed_summary, verdict, created_at, resolved_at
       ) VALUES (?, ?, 'open', ?, ?, ?, NULL, NULL, ?, NULL)`,
    ).run(
      experiment.id,
      experiment.hypothesisId,
      experiment.targetReps,
      JSON.stringify(experiment.rewardWindow),
      experiment.predictedSummary ?? predictedSummaryFor(hypothesis),
      experiment.createdAt,
    );
  });

  const opened = getExperiment(experiment.id);
  if (!opened) throw new Error(`failed to open experiment: ${experiment.id}`);
  return { ok: true, experiment: opened };
}

export function addExperimentMember(input: unknown): { ok: true; experiment: Experiment } {
  const now = Date.now();
  const member = validateAddMemberInput(input, now);
  const db = getDb();
  withImmediateTransaction(db, () => {
    const experiment = db
      .prepare(
        `SELECT e.id, h.project_id
           FROM experiment e
           JOIN hypothesis h ON h.id = e.hypothesis_id
          WHERE e.id = ?`,
      )
      .get(member.experimentId) as { id: string; project_id: string } | undefined;
    if (!experiment) throw new Error(`experiment not found: ${member.experimentId}`);

    if (member.artifactId) {
      const artifact = db
        .prepare(
          `SELECT id
             FROM work_thread
            WHERE id = ?
              AND artifact_type IS NOT NULL
              AND project_profile_id = ?`,
        )
        .get(member.artifactId, experiment.project_id) as { id: string } | undefined;
      if (!artifact) throw new Error(`artifact not found: ${member.artifactId}`);
    }

    db.prepare(
      `INSERT INTO experiment_member (experiment_id, run_id, artifact_id, role, added_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(member.experimentId, member.runId, member.artifactId, member.role, member.addedAt);
  });

  const experiment = getExperiment(member.experimentId);
  if (!experiment) throw new Error(`experiment not found: ${member.experimentId}`);
  return { ok: true, experiment };
}

export function listExperiments(opts: ListExperimentsOptions = {}): Experiment[] {
  const where: string[] = [];
  const params: Record<string, unknown> = {};
  if (opts.projectId) {
    where.push('h.project_id = @projectId');
    params.projectId = opts.projectId;
  }
  if (opts.hypothesisId) {
    where.push('e.hypothesis_id = @hypothesisId');
    params.hypothesisId = opts.hypothesisId;
  }
  if (opts.status) {
    where.push('e.status = @status');
    params.status = validateExperimentStatus(opts.status, 'status');
  }
  params.limit = Math.max(0, Math.min(Math.floor(opts.limit ?? 100), 1000));
  const rows = getDb()
    .prepare(
      `SELECT e.*
         FROM experiment e
         JOIN hypothesis h ON h.id = e.hypothesis_id
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY e.created_at DESC, e.id ASC
        LIMIT @limit`,
    )
    .all(params) as ExperimentRow[];
  return rows.map((row) => rowToExperiment(row, getExperimentMembers(row.id)));
}

function windowBounds(
  experiment: Experiment,
  now = Date.now(),
): {
  startAt: number | null;
  endAt: number | null;
  matureAt: number;
  mature: boolean;
} {
  const explicitEnd = experiment.rewardWindow.endAt;
  const windowStart = experiment.rewardWindow.startAt ?? experiment.createdAt;
  const matureAt = explicitEnd ?? windowStart + (experiment.rewardWindow.durationMs ?? 0);
  return {
    startAt: experiment.rewardWindow.startAt,
    endAt: explicitEnd ?? matureAt,
    matureAt,
    mature: now >= matureAt,
  };
}

function collectLatestMetricValues(
  experimentId: string,
  bounds: { startAt: number | null; endAt: number | null },
): Record<string, { values: number[]; latestCapturedAt: number | null }> {
  const clauses = ['em.experiment_id = ?', 'em.artifact_id IS NOT NULL'];
  const params: unknown[] = [experimentId];
  if (bounds.startAt != null) {
    clauses.push('rs.captured_at >= ?');
    params.push(bounds.startAt);
  }
  if (bounds.endAt != null) {
    clauses.push('rs.captured_at <= ?');
    params.push(bounds.endAt);
  }

  const rows = getDb()
    .prepare(
      `SELECT em.artifact_id, et.id AS target_id, rs.captured_at, rs.metrics
         FROM experiment_member em
         JOIN externalization_target et
           ON et.artifact_id = em.artifact_id
          AND et.status = 'linked'
         JOIN reward_snapshot rs ON rs.target_id = et.id
        WHERE ${clauses.join(' AND ')}
        ORDER BY em.artifact_id ASC, et.id ASC, rs.captured_at DESC, rs.id ASC`,
    )
    .all(...params) as SnapshotRow[];

  const seenTarget = new Set<string>();
  const out: Record<string, { values: number[]; latestCapturedAt: number | null }> = {};
  for (const row of rows) {
    const targetKey = `${row.artifact_id}:${row.target_id}`;
    if (seenTarget.has(targetKey)) continue;
    seenTarget.add(targetKey);
    const metrics = JSON.parse(row.metrics) as Record<string, unknown>;
    for (const [metric, value] of Object.entries(metrics)) {
      if (typeof value !== 'number' || !Number.isFinite(value)) continue;
      const bucket = (out[metric] ??= { values: [], latestCapturedAt: null });
      bucket.values.push(value);
      bucket.latestCapturedAt =
        bucket.latestCapturedAt == null
          ? row.captured_at
          : Math.max(bucket.latestCapturedAt, row.captured_at);
    }
  }
  return out;
}

function aggregate(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function evaluatePrediction(target: PredictionTarget, observed: number | null): PredictionCheck {
  if (observed == null) {
    return { metric: target.metric, expected: target, observed: null, pass: null };
  }
  const pass =
    target.direction === 'increase'
      ? observed >= target.magnitude
      : target.direction === 'decrease'
        ? observed <= target.magnitude
        : Math.abs(observed) <= target.magnitude;
  return { metric: target.metric, expected: target, observed, pass };
}

function computeVerdict(
  hypothesis: Hypothesis,
  experiment: Experiment,
  now = Date.now(),
): { verdict: ExperimentVerdict; observedSummary: Record<string, unknown>; eligible: boolean } {
  const bounds = windowBounds(experiment, now);
  const memberCount = experiment.members.length;
  const metrics = collectLatestMetricValues(experiment.id, {
    startAt: bounds.startAt,
    endAt: bounds.endAt,
  });
  const observedMetrics = Object.fromEntries(
    Object.entries(metrics).map(([metric, value]) => [
      metric,
      {
        values: value.values,
        aggregate: aggregate(value.values),
        latestCapturedAt: value.latestCapturedAt,
      },
    ]),
  ) as Record<
    string,
    { values: number[]; aggregate: number | null; latestCapturedAt: number | null }
  >;

  const diagnosticObserved =
    observedMetrics[hypothesis.statement.diagnostic.metric]?.aggregate ?? null;
  const northStarObserved =
    observedMetrics[hypothesis.statement.northStar.metric]?.aggregate ?? null;
  const diagnostic = evaluatePrediction(hypothesis.statement.diagnostic, diagnosticObserved);
  const northStar = evaluatePrediction(hypothesis.statement.northStar, northStarObserved);
  const missingMetrics = [
    diagnosticObserved == null ? hypothesis.statement.diagnostic.metric : null,
    northStarObserved == null ? hypothesis.statement.northStar.metric : null,
  ].filter((metric): metric is string => metric != null);

  const eligible = memberCount >= experiment.targetReps && bounds.mature;
  let verdict: ExperimentVerdict = 'inconclusive';
  if (eligible && missingMetrics.length === 0) {
    const diagnosticPass = diagnostic.pass === true;
    const northStarPass = northStar.pass === true;
    verdict = diagnosticPass && northStarPass ? 'supported' : 'refuted';
  }

  const reasons: string[] = [];
  if (memberCount < experiment.targetReps) {
    reasons.push(`needs ${experiment.targetReps - memberCount} more experiment member(s)`);
  }
  if (!bounds.mature) reasons.push(`reward window matures at ${bounds.matureAt}`);
  if (eligible && missingMetrics.length > 0) {
    reasons.push(`missing reward metrics: ${[...new Set(missingMetrics)].join(', ')}`);
  }
  if (eligible && missingMetrics.length === 0) {
    reasons.push(
      verdict === 'supported' ? 'all predictions passed' : 'one or more predictions failed',
    );
  }

  return {
    verdict,
    eligible,
    observedSummary: {
      memberCount,
      targetReps: experiment.targetReps,
      windowMature: bounds.mature,
      windowStartAt: bounds.startAt,
      windowEndAt: bounds.endAt,
      matureAt: bounds.matureAt,
      metrics: observedMetrics,
      checks: { diagnostic, northStar },
      missingMetrics: [...new Set(missingMetrics)],
      reason: reasons.join('; ') || 'no blocking reason',
    },
  };
}

export function renderExperimentVerdict(
  id: string,
  opts: { now?: number } = {},
): ExperimentVerdictResult {
  const now = opts.now ?? Date.now();
  const experiment = getExperiment(id);
  if (!experiment) throw new Error(`experiment not found: ${id}`);
  const hypothesis = getHypothesis(experiment.hypothesisId);
  if (!hypothesis) throw new Error(`hypothesis not found: ${experiment.hypothesisId}`);

  const result = computeVerdict(hypothesis, experiment, now);
  const db = getDb();
  withImmediateTransaction(db, () => {
    if (result.eligible) {
      const status: ExperimentStatus =
        result.verdict === 'inconclusive' ? 'inconclusive' : 'complete';
      db.prepare(
        `UPDATE experiment
            SET status = ?,
                observed_summary = ?,
                verdict = ?,
                resolved_at = ?
          WHERE id = ?`,
      ).run(status, JSON.stringify(result.observedSummary), result.verdict, now, id);
    } else {
      db.prepare(
        `UPDATE experiment
            SET observed_summary = ?
          WHERE id = ?`,
      ).run(JSON.stringify(result.observedSummary), id);
    }
  });

  if (result.eligible) {
    resolveHypothesis(hypothesis.id, {
      status: result.verdict,
      resolvedAt: now,
      verdictEvidence: {
        experimentId: id,
        observedSummary: result.observedSummary,
      },
    });
  }

  const updatedExperiment = getExperiment(id);
  const updatedHypothesis = getHypothesis(hypothesis.id);
  if (!updatedExperiment || !updatedHypothesis) {
    throw new Error(`failed to render verdict for experiment: ${id}`);
  }
  return {
    ok: true,
    experiment: updatedExperiment,
    hypothesis: updatedHypothesis,
    verdict: result.verdict,
    resolved: result.eligible,
    observedSummary: result.observedSummary,
  };
}

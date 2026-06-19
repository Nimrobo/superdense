import { randomUUID } from 'node:crypto';
import { getDb, withImmediateTransaction } from '../db.js';

export type HypothesisStatus = 'open' | 'supported' | 'refuted' | 'inconclusive';
export type PredictionDirection = 'increase' | 'decrease' | 'maintain';

export interface PredictionTarget {
  metric: string;
  direction: PredictionDirection;
  magnitude: number;
}

export interface HypothesisWindow {
  durationMs: number;
  label: string | null;
}

export interface HypothesisStatement {
  action: string;
  diagnostic: PredictionTarget;
  northStar: PredictionTarget;
  window: HypothesisWindow;
  mechanism: string;
}

export interface Hypothesis {
  id: string;
  projectId: string;
  leverKey: string;
  statement: HypothesisStatement;
  status: HypothesisStatus;
  createdAt: number;
  resolvedAt: number | null;
  verdictEvidence: Record<string, unknown> | null;
}

export interface RecordHypothesisInput {
  id?: string;
  projectId: string;
  leverKey: string;
  statement: HypothesisStatement;
  createdAt?: number;
}

export interface ListHypothesesOptions {
  projectId?: string;
  status?: HypothesisStatus;
  leverKey?: string;
  limit?: number;
}

export interface ResolveHypothesisInput {
  status: HypothesisStatus;
  verdictEvidence?: Record<string, unknown> | null;
  resolvedAt?: number;
}

interface HypothesisRow {
  id: string;
  project_id: string;
  lever_key: string;
  statement: string;
  status: HypothesisStatus;
  created_at: number;
  resolved_at: number | null;
  verdict_evidence: string | null;
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

function expectFiniteNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${field} must be a finite number`);
  }
  return value;
}

function expectPositiveInteger(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${field} must be a positive integer`);
  }
  return value;
}

function expectDirection(value: unknown, field: string): PredictionDirection {
  if (value === 'increase' || value === 'decrease' || value === 'maintain') return value;
  throw new Error(`${field} must be 'increase', 'decrease', or 'maintain'`);
}

function validatePredictionTarget(value: unknown, field: string): PredictionTarget {
  const body = expectObject(value, field);
  return {
    metric: expectString(body.metric, `${field}.metric`),
    direction: expectDirection(body.direction, `${field}.direction`),
    magnitude: expectFiniteNumber(body.magnitude, `${field}.magnitude`),
  };
}

export function validateHypothesisStatement(value: unknown): HypothesisStatement {
  const body = expectObject(value, 'statement');
  const window = expectObject(body.window, 'statement.window');
  return {
    action: expectString(body.action, 'statement.action'),
    diagnostic: validatePredictionTarget(body.diagnostic, 'statement.diagnostic'),
    northStar: validatePredictionTarget(body.northStar, 'statement.northStar'),
    window: {
      durationMs: expectPositiveInteger(window.durationMs, 'statement.window.durationMs'),
      label: expectOptionalString(window.label, 'statement.window.label'),
    },
    mechanism: expectString(body.mechanism, 'statement.mechanism'),
  };
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

function rowToHypothesis(row: HypothesisRow): Hypothesis {
  return {
    id: row.id,
    projectId: row.project_id,
    leverKey: row.lever_key,
    statement: validateHypothesisStatement(JSON.parse(row.statement) as unknown),
    status: row.status,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
    verdictEvidence: parseJsonObject(row.verdict_evidence),
  };
}

function validateStatus(value: unknown, field: string): HypothesisStatus {
  if (
    value === 'open' ||
    value === 'supported' ||
    value === 'refuted' ||
    value === 'inconclusive'
  ) {
    return value;
  }
  throw new Error(`${field} must be open, supported, refuted, or inconclusive`);
}

function validateRecordInput(input: unknown, now: number): Required<RecordHypothesisInput> {
  const body = expectObject(input, 'input');
  const id = body.id == null ? randomUUID() : expectString(body.id, 'id');
  return {
    id,
    projectId: expectString(body.projectId, 'projectId'),
    leverKey: expectString(body.leverKey, 'leverKey'),
    statement: validateHypothesisStatement(body.statement),
    createdAt: body.createdAt == null ? now : expectPositiveInteger(body.createdAt, 'createdAt'),
  };
}

export function getHypothesis(id: string): Hypothesis | null {
  const row = getDb().prepare('SELECT * FROM hypothesis WHERE id = ?').get(id) as
    | HypothesisRow
    | undefined;
  return row ? rowToHypothesis(row) : null;
}

export function recordHypothesis(input: unknown): { ok: true; hypothesis: Hypothesis } {
  const now = Date.now();
  const hypothesis = validateRecordInput(input, now);
  const db = getDb();
  withImmediateTransaction(db, () => {
    const project = db
      .prepare('SELECT id FROM project_profile WHERE id = ?')
      .get(hypothesis.projectId) as { id: string } | undefined;
    if (!project) throw new Error(`project not found: ${hypothesis.projectId}`);

    db.prepare(
      `INSERT INTO hypothesis (
         id, project_id, lever_key, statement, status, created_at, resolved_at, verdict_evidence
       ) VALUES (?, ?, ?, ?, 'open', ?, NULL, NULL)`,
    ).run(
      hypothesis.id,
      hypothesis.projectId,
      hypothesis.leverKey,
      JSON.stringify(hypothesis.statement),
      hypothesis.createdAt,
    );
  });

  const recorded = getHypothesis(hypothesis.id);
  if (!recorded) throw new Error(`failed to record hypothesis: ${hypothesis.id}`);
  return { ok: true, hypothesis: recorded };
}

export function listHypotheses(opts: ListHypothesesOptions = {}): Hypothesis[] {
  const where: string[] = [];
  const params: Record<string, unknown> = {};
  if (opts.projectId) {
    where.push('project_id = @projectId');
    params.projectId = opts.projectId;
  }
  if (opts.status) {
    where.push('status = @status');
    params.status = validateStatus(opts.status, 'status');
  }
  if (opts.leverKey) {
    where.push('lever_key = @leverKey');
    params.leverKey = opts.leverKey;
  }
  params.limit = Math.max(0, Math.min(Math.floor(opts.limit ?? 100), 1000));
  const rows = getDb()
    .prepare(
      `SELECT * FROM hypothesis
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY created_at DESC, id ASC
       LIMIT @limit`,
    )
    .all(params) as HypothesisRow[];
  return rows.map(rowToHypothesis);
}

export function resolveHypothesis(
  id: string,
  input: unknown,
): { ok: true; hypothesis: Hypothesis } {
  const body = expectObject(input, 'input');
  const status = validateStatus(body.status, 'status');
  const resolvedAt =
    status === 'open'
      ? null
      : body.resolvedAt == null
        ? Date.now()
        : expectPositiveInteger(body.resolvedAt, 'resolvedAt');
  const verdictEvidence =
    body.verdictEvidence == null ? null : expectObject(body.verdictEvidence, 'verdictEvidence');

  const db = getDb();
  withImmediateTransaction(db, () => {
    const existing = db.prepare('SELECT id FROM hypothesis WHERE id = ?').get(id) as
      | { id: string }
      | undefined;
    if (!existing) throw new Error(`hypothesis not found: ${id}`);
    db.prepare(
      `UPDATE hypothesis
          SET status = ?,
              resolved_at = ?,
              verdict_evidence = ?
        WHERE id = ?`,
    ).run(status, resolvedAt, verdictEvidence ? JSON.stringify(verdictEvidence) : null, id);
  });

  const hypothesis = getHypothesis(id);
  if (!hypothesis) throw new Error(`hypothesis not found: ${id}`);
  return { ok: true, hypothesis };
}

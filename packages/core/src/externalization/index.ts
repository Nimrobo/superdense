import { randomUUID } from 'node:crypto';
import { getDb } from '../db.js';

export { listExternalizationConnectors } from './catalog.js';
export type { ExternalizationConnector, ExternalizationConnectorAvailability } from './catalog.js';

export type ExternalizationConclusion = 'not_external' | 'external';
export type ExternalizationTargetStatus = 'linked' | 'needs_connector' | 'not_found' | 'ambiguous';
export type ExternalizationStatus = 'unprocessed' | 'not_external' | 'linked' | 'blocked';

export interface ExternalizationTarget {
  id: string;
  artifactId: string;
  connector: string;
  status: ExternalizationTargetStatus;
  locator: string | null;
  evidence: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface ArtifactExternalization {
  artifactId: string;
  artifactType: string;
  title: string;
  summary: string | null;
  artifactFinalizedAt: number;
  status: ExternalizationStatus;
  conclusion: ExternalizationConclusion | null;
  evidence: string | null;
  updatedAt: number | null;
  targets: ExternalizationTarget[];
}

interface ArtifactRow {
  id: string;
  artifact_type: string;
  provisional_title: string;
  summary: string | null;
  artifact_finalized_at: number;
  externalization_status: ExternalizationConclusion | null;
  externalization_evidence: string | null;
  externalization_updated_at: number | null;
}

interface ExternalizationTargetRow {
  id: string;
  artifact_id: string;
  connector: string;
  status: ExternalizationTargetStatus;
  locator: string | null;
  evidence: string | null;
  created_at: number;
  updated_at: number;
}

interface ExternalizationInboxCursor {
  v: 1;
  artifactFinalizedAt: number;
  artifactId: string;
}

const INVALID_INBOX_CURSOR = 'cursor must be a valid externalization inbox cursor';

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

function expectConclusion(value: unknown): ExternalizationConclusion {
  if (value !== 'not_external' && value !== 'external') {
    throw new Error('status must be not_external or external');
  }
  return value;
}

function expectTargetStatus(value: unknown): ExternalizationTargetStatus {
  if (
    value !== 'linked' &&
    value !== 'needs_connector' &&
    value !== 'not_found' &&
    value !== 'ambiguous'
  ) {
    throw new Error('targets[].status must be linked, needs_connector, not_found, or ambiguous');
  }
  return value;
}

function rowToTarget(row: ExternalizationTargetRow): ExternalizationTarget {
  return {
    id: row.id,
    artifactId: row.artifact_id,
    connector: row.connector,
    status: row.status,
    locator: row.locator,
    evidence: row.evidence,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function deriveStatus(
  conclusion: ExternalizationConclusion | null,
  targets: ExternalizationTarget[],
): ExternalizationStatus {
  if (conclusion == null) return 'unprocessed';
  if (conclusion === 'not_external') return 'not_external';
  return targets.length > 0 && targets.every((target) => target.status === 'linked')
    ? 'linked'
    : 'blocked';
}

function rowToExternalization(
  row: ArtifactRow,
  targets: ExternalizationTarget[],
): ArtifactExternalization {
  return {
    artifactId: row.id,
    artifactType: row.artifact_type,
    title: row.provisional_title,
    summary: row.summary,
    artifactFinalizedAt: row.artifact_finalized_at,
    status: deriveStatus(row.externalization_status, targets),
    conclusion: row.externalization_status,
    evidence: row.externalization_evidence,
    updatedAt: row.externalization_updated_at,
    targets,
  };
}

function listTargetsByArtifact(artifactIds?: string[]): Map<string, ExternalizationTarget[]> {
  const db = getDb();
  const rows: ExternalizationTargetRow[] = [];
  if (artifactIds === undefined) {
    rows.push(
      ...(db
        .prepare('SELECT * FROM externalization_target ORDER BY artifact_id, created_at, id')
        .all() as ExternalizationTargetRow[]),
    );
  } else {
    // Stay below SQLite builds with the historical 999 bind-parameter limit.
    for (let offset = 0; offset < artifactIds.length; offset += 500) {
      const chunk = artifactIds.slice(offset, offset + 500);
      if (chunk.length === 0) continue;
      rows.push(
        ...(db
          .prepare(
            `SELECT * FROM externalization_target
              WHERE artifact_id IN (${chunk.map(() => '?').join(',')})
              ORDER BY artifact_id, created_at, id`,
          )
          .all(...chunk) as ExternalizationTargetRow[]),
      );
    }
  }
  const byArtifact = new Map<string, ExternalizationTarget[]>();
  for (const row of rows) {
    const targets = byArtifact.get(row.artifact_id) ?? [];
    targets.push(rowToTarget(row));
    byArtifact.set(row.artifact_id, targets);
  }
  return byArtifact;
}

export function getExternalization(artifactId: string): ArtifactExternalization | null {
  const row = getDb()
    .prepare(
      `SELECT id, artifact_type, provisional_title, summary, artifact_finalized_at,
              externalization_status, externalization_evidence, externalization_updated_at
         FROM work_thread
        WHERE id = ? AND artifact_type IS NOT NULL`,
    )
    .get(artifactId) as ArtifactRow | undefined;
  if (!row) return null;
  return rowToExternalization(row, listTargetsByArtifact([row.id]).get(row.id) ?? []);
}

export function listExternalizations(opts: { status?: string } = {}): ArtifactExternalization[] {
  if (
    opts.status !== undefined &&
    !['unprocessed', 'not_external', 'linked', 'blocked'].includes(opts.status)
  ) {
    throw new Error('status must be unprocessed, not_external, linked, or blocked');
  }
  const rows = getDb()
    .prepare(
      `SELECT id, artifact_type, provisional_title, summary, artifact_finalized_at,
              externalization_status, externalization_evidence, externalization_updated_at
         FROM work_thread
        WHERE artifact_type IS NOT NULL
        ORDER BY artifact_finalized_at DESC, id ASC`,
    )
    .all() as ArtifactRow[];
  const targets = listTargetsByArtifact();
  const items = rows.map((row) => rowToExternalization(row, targets.get(row.id) ?? []));
  return opts.status ? items.filter((item) => item.status === opts.status) : items;
}

function encodeInboxCursor(row: ArtifactRow): string {
  const cursor: ExternalizationInboxCursor = {
    v: 1,
    artifactFinalizedAt: row.artifact_finalized_at,
    artifactId: row.id,
  };
  return Buffer.from(JSON.stringify(cursor)).toString('base64url');
}

function decodeInboxCursor(raw: string): ExternalizationInboxCursor {
  try {
    if (!raw || raw.trim() !== raw || !/^[A-Za-z0-9_-]+$/.test(raw)) {
      throw new Error(INVALID_INBOX_CURSOR);
    }
    const decoded = Buffer.from(raw, 'base64url');
    if (decoded.toString('base64url') !== raw) throw new Error(INVALID_INBOX_CURSOR);
    const cursor = JSON.parse(decoded.toString('utf8')) as Partial<ExternalizationInboxCursor>;
    if (
      cursor.v !== 1 ||
      !Number.isSafeInteger(cursor.artifactFinalizedAt) ||
      typeof cursor.artifactId !== 'string' ||
      !cursor.artifactId
    ) {
      throw new Error(INVALID_INBOX_CURSOR);
    }
    return cursor as ExternalizationInboxCursor;
  } catch {
    throw new Error(INVALID_INBOX_CURSOR);
  }
}

export function listExternalizationInbox(opts: { limit?: number; cursor?: string } = {}) {
  const limit = Math.max(0, Math.min(Math.floor(opts.limit ?? 10), 1000));
  const cursor = opts.cursor === undefined ? null : decodeInboxCursor(opts.cursor);
  const db = getDb();
  const actionableWhere = `
    artifact_type IS NOT NULL
    AND (
      externalization_status IS NULL
      OR (
        externalization_status = 'external'
        AND (
          NOT EXISTS (
            SELECT 1 FROM externalization_target t WHERE t.artifact_id = work_thread.id
          )
          OR EXISTS (
            SELECT 1 FROM externalization_target t
             WHERE t.artifact_id = work_thread.id AND t.status != 'linked'
          )
        )
      )
    )`;
  const cursorWhere = cursor
    ? 'AND (artifact_finalized_at < ? OR (artifact_finalized_at = ? AND id > ?))'
    : '';
  const cursorParams = cursor
    ? [cursor.artifactFinalizedAt, cursor.artifactFinalizedAt, cursor.artifactId]
    : [];
  const rows = db
    .prepare(
      `SELECT id, artifact_type, provisional_title, summary, artifact_finalized_at,
              externalization_status, externalization_evidence, externalization_updated_at
         FROM work_thread
        WHERE ${actionableWhere}
          ${cursorWhere}
        ORDER BY artifact_finalized_at DESC, id ASC
        LIMIT ?`,
    )
    .all(...cursorParams, limit + 1) as ArtifactRow[];
  const pageRows = rows.slice(0, limit);
  const targetMap = listTargetsByArtifact(pageRows.map((row) => row.id));
  const items = pageRows.map((row) => rowToExternalization(row, targetMap.get(row.id) ?? []));
  const lastRow = pageRows.at(-1);
  const counts = db
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN externalization_status IS NULL THEN 1 ELSE 0 END), 0)
           AS unprocessed,
         COALESCE(SUM(CASE WHEN externalization_status = 'external' THEN 1 ELSE 0 END), 0)
           AS blocked
       FROM work_thread
       WHERE ${actionableWhere}`,
    )
    .get() as { unprocessed: number; blocked: number };
  return {
    items,
    limit,
    remaining: counts.unprocessed + counts.blocked,
    counts,
    nextCursor: rows.length > limit && lastRow ? encodeInboxCursor(lastRow) : null,
  };
}

export function assessExternalization(input: unknown): {
  ok: true;
  artifactId: string;
  externalization: ArtifactExternalization;
} {
  const body = expectObject(input, 'input');
  const artifactId = expectString(body.artifactId, 'artifactId');
  const status = expectConclusion(body.status);
  const evidence = expectString(body.evidence, 'evidence');
  const rawTargets = body.targets ?? [];
  if (!Array.isArray(rawTargets)) throw new Error('targets must be an array');
  if (status === 'not_external' && rawTargets.length > 0) {
    throw new Error('not_external assessments must not include targets');
  }
  if (status === 'external' && rawTargets.length === 0) {
    throw new Error('external assessments must include at least one target');
  }

  const targetIds = new Set<string>();
  const targets = rawTargets.map((rawTarget, index) => {
    const target = expectObject(rawTarget, `targets[${index}]`);
    const id =
      target.id === undefined ? randomUUID() : expectString(target.id, `targets[${index}].id`);
    if (targetIds.has(id)) throw new Error('targets[].id must be unique');
    targetIds.add(id);
    const connector = expectString(target.connector, `targets[${index}].connector`).trim();
    const targetStatus = expectTargetStatus(target.status);
    const locator = expectNullableString(target.locator, `targets[${index}].locator`);
    if (targetStatus === 'linked' && (!locator || !locator.trim())) {
      throw new Error('linked targets must include a non-empty locator');
    }
    return {
      id,
      connector,
      status: targetStatus,
      locator,
      evidence: expectNullableString(target.evidence, `targets[${index}].evidence`),
    };
  });

  const db = getDb();
  const now = Date.now();
  const tx = db.transaction(() => {
    const artifact = db
      .prepare('SELECT id FROM work_thread WHERE id = ? AND artifact_type IS NOT NULL')
      .get(artifactId) as { id: string } | undefined;
    if (!artifact) throw new Error(`artifact not found: ${artifactId}`);

    db.prepare(
      `UPDATE work_thread
          SET externalization_status = ?,
              externalization_evidence = ?,
              externalization_updated_at = ?
        WHERE id = ?`,
    ).run(status, evidence, now, artifactId);
    db.prepare('DELETE FROM externalization_target WHERE artifact_id = ?').run(artifactId);
    const insert = db.prepare(
      `INSERT INTO externalization_target (
         id, artifact_id, connector, status, locator, evidence, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const target of targets) {
      insert.run(
        target.id,
        artifactId,
        target.connector,
        target.status,
        target.locator,
        target.evidence,
        now,
        now,
      );
    }
  });
  tx();

  return {
    ok: true,
    artifactId,
    externalization: getExternalization(artifactId)!,
  };
}

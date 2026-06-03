import { randomUUID } from 'node:crypto';
import {
  getDb,
  getSession,
  getSessionParent,
  getSessionTree,
  listSessionEnrichments,
  withDbRetry,
  SYSTEM_RUN_ID,
} from '../db.js';
import type { Session } from '../types.js';

export type CurationStatus = 'pending' | 'consumed' | 'skipped' | 'deferred';
export type WorkThreadRole = 'contributor' | 'evidence';
export type ThreadExternalizationStatus = 'not_external' | 'external';

// Layer 3B lifecycle, derived from the folded work_thread row:
//   open     -> still being curated (L3A)
//   ready    -> agent-confirmed output queued for artifact creation
//   artifact -> stable payload created (lineage may still gain audited evidence)
export type ThreadLifecycle = 'open' | 'ready' | 'artifact';

export interface WorkThreadSession {
  sessionId: string;
  role: WorkThreadRole;
  rationale: string | null;
}

export type WorkThreadLineageEventType = 'attach' | 'retract';

export interface WorkThreadLineageEvent {
  id: string;
  sessionId: string;
  eventType: WorkThreadLineageEventType;
  role: WorkThreadRole;
  rationale: string | null;
  createdAt: number;
}

export interface WorkThread {
  id: string;
  projectProfileId: string;
  provisionalTitle: string;
  summary: string | null;
  status: string;
  createdAt: number;
  updatedAt: number;
  // Layer 3B artifact fields (folded onto work_thread; null until finalized).
  artifactType: string | null;
  payload: Record<string, unknown> | null;
  artifactFinalizedAt: number | null;
  readyAt: number | null;
  readinessRationale: string | null;
  predecessorArtifactId: string | null;
  externalizationStatus: ThreadExternalizationStatus | null;
  externalizationEvidence: string | null;
  externalizationUpdatedAt: number | null;
  lifecycle: ThreadLifecycle;
  headSessionId?: string | null;
  sessions?: WorkThreadSession[];
  lineageEvents?: WorkThreadLineageEvent[];
}

interface WorkThreadRow {
  id: string;
  project_profile_id: string;
  provisional_title: string;
  summary: string | null;
  status: string;
  created_at: number;
  updated_at: number;
  artifact_type: string | null;
  payload: string | null;
  artifact_finalized_at: number | null;
  ready_at: number | null;
  readiness_rationale: string | null;
  predecessor_artifact_id: string | null;
  externalization_status: ThreadExternalizationStatus | null;
  externalization_evidence: string | null;
  externalization_updated_at: number | null;
}

interface WorkThreadSessionRow {
  session_id: string;
  role: WorkThreadRole;
  rationale: string | null;
}

interface WorkThreadLineageEventRow {
  id: string;
  session_id: string;
  event_type: WorkThreadLineageEventType;
  role: WorkThreadRole;
  rationale: string | null;
  created_at: number;
}

interface SessionSignalRow {
  session_id: string;
  path_rel: string;
  role: string;
  writes: number;
  reads: number;
}

function parsePayload(raw: string | null): Record<string, unknown> | null {
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

function rowToThread(row: WorkThreadRow): WorkThread {
  const artifactType = row.artifact_type ?? null;
  const lifecycle: ThreadLifecycle =
    artifactType != null ? 'artifact' : row.status === 'ready' ? 'ready' : 'open';
  return {
    id: row.id,
    projectProfileId: row.project_profile_id,
    provisionalTitle: row.provisional_title,
    summary: row.summary,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    artifactType,
    payload: parsePayload(row.payload),
    artifactFinalizedAt: row.artifact_finalized_at ?? null,
    readyAt: row.ready_at ?? null,
    readinessRationale: row.readiness_rationale ?? null,
    predecessorArtifactId: row.predecessor_artifact_id ?? null,
    externalizationStatus: row.externalization_status ?? null,
    externalizationEvidence: row.externalization_evidence ?? null,
    externalizationUpdatedAt: row.externalization_updated_at ?? null,
    lifecycle,
  };
}

export function sessionRevision(
  session: Pick<Session, 'fileMtime' | 'modifiedAt' | 'messageCount'>,
) {
  return JSON.stringify([
    session.fileMtime ?? null,
    session.modifiedAt ?? null,
    session.messageCount ?? null,
  ]);
}

export function resolveRootSessionId(sessionId: string): string {
  let current = sessionId;
  const visited = new Set<string>();
  while (!visited.has(current)) {
    visited.add(current);
    const parent =
      getSessionParent(current)?.parentId ?? getSession(current)?.parentSessionId ?? null;
    if (!parent) return current;
    current = parent;
  }
  return current;
}

export function markSessionForCuration(
  sessionId: string,
  markedAt = Date.now(),
): { sessionId: string; buffered: boolean; markedAt: number } {
  if (!sessionId.trim() || !sessionId.includes(':')) {
    throw new Error('session id must use <adapter>:<id> format');
  }
  const db = getDb();
  if (getSession(sessionId)) {
    const rootSessionId = resolveRootSessionId(sessionId);
    const tx = db.transaction(() => {
      db.prepare(
        `UPDATE sessions
            SET curation_priority_at = MAX(COALESCE(curation_priority_at, 0), ?)
          WHERE id = ?`,
      ).run(markedAt, sessionId);
      db.prepare(
        `UPDATE sessions
            SET curation_status = 'pending'
          WHERE id = ?
            AND curation_status != 'pending'`,
      ).run(rootSessionId);
    });
    withDbRetry(tx);
    return { sessionId, buffered: false, markedAt };
  }
  db.prepare(
    `INSERT INTO pending_session_marker (session_id, marked_at)
     VALUES (?, ?)
     ON CONFLICT(session_id) DO UPDATE SET marked_at = MAX(marked_at, excluded.marked_at)`,
  ).run(sessionId, markedAt);
  return { sessionId, buffered: true, markedAt };
}

/**
 * Merge a cheap pre-index marker and reset reviewed root sessions when their
 * own metadata or the metadata of one of their linked subagents changed.
 */
export function reconcileIndexedSession(sessionId: string, changed: boolean): void {
  const db = getDb();
  const rootSessionId = resolveRootSessionId(sessionId);
  const tx = db.transaction(() => {
    db.prepare(
      `UPDATE sessions
          SET curation_priority_at = MAX(
            COALESCE(curation_priority_at, 0),
            COALESCE((SELECT marked_at FROM pending_session_marker WHERE session_id = ?), 0)
          )
        WHERE id = ?
          AND EXISTS (SELECT 1 FROM pending_session_marker WHERE session_id = ?)`,
    ).run(sessionId, sessionId, sessionId);
    db.prepare('DELETE FROM pending_session_marker WHERE session_id = ?').run(sessionId);
    db.prepare(
      `UPDATE sessions
          SET curation_status = 'pending',
              -- Root changes preserve their prior token so inbox ordering can
              -- distinguish changed roots. Subagent changes invalidate the
              -- root review without changing the root metadata tuple.
              curated_revision = CASE WHEN id = ? THEN curated_revision ELSE NULL END
        WHERE id = ?
          AND curation_status IN ('consumed', 'skipped', 'deferred')
          AND (
            ? = 1
            OR curated_revision IS NULL
            OR curated_revision != json_array(file_mtime, modified_at, message_count)
          )`,
    ).run(sessionId, rootSessionId, changed && sessionId !== rootSessionId ? 1 : 0);
  });
  withDbRetry(tx);
}

function canonicalProjectId(projectId: string): string {
  const row = getDb()
    .prepare('SELECT id, covered_by FROM project_profile WHERE id = ?')
    .get(projectId) as { id: string; covered_by: string | null } | undefined;
  if (!row) throw new Error(`project not found: ${projectId}`);
  return row.covered_by ?? row.id;
}

function projectKeys(projectId: string): string[] {
  const canonicalId = canonicalProjectId(projectId);
  const rows = getDb()
    .prepare(
      'SELECT project_key FROM project_profile WHERE id = ? OR covered_by = ? ORDER BY project_key',
    )
    .all(canonicalId, canonicalId) as Array<{ project_key: string }>;
  return rows.map((row) => row.project_key);
}

function projectWhere(projectId: string | undefined, column = 's.project_key') {
  if (!projectId) return { sql: '', params: [] as string[] };
  const keys = projectKeys(projectId);
  return {
    sql: ` AND ${column} IN (${keys.map(() => '?').join(',')})`,
    params: keys,
  };
}

function serializeInboxSession(row: Record<string, unknown>) {
  return {
    id: row.id,
    agent: row.agent,
    sessionId: row.session_id,
    pwd: row.pwd,
    projectKey: row.project_key,
    firstPrompt: row.first_prompt,
    summary: row.summary,
    messageCount: row.message_count,
    gitBranch: row.git_branch,
    createdAt: row.created_at,
    modifiedAt: row.modified_at,
    curationStatus: row.curation_status,
    curatedAt: row.curated_at,
    curationNote: row.curation_note,
    curationPriorityAt: row.priority_at,
    priorityBucket: row.priority_bucket,
  };
}

export function listCurationInbox(opts: { projectId?: string; limit?: number } = {}) {
  const db = getDb();
  const limit = Math.max(0, Math.min(Math.floor(opts.limit ?? 10), 1000));
  const filter = projectWhere(opts.projectId);
  const rows = db
    .prepare(
      `WITH RECURSIVE descendants(root_id, session_id) AS (
         SELECT id, id FROM sessions WHERE is_subagent = 0
         UNION
         SELECT d.root_id, sl.child_id
           FROM descendants d
           JOIN session_links sl ON sl.parent_id = d.session_id
       ),
       root_priority AS (
         SELECT root_id, MAX(s.curation_priority_at) AS priority_at
           FROM descendants d
           JOIN sessions s ON s.id = d.session_id
          GROUP BY root_id
       )
       SELECT s.*, rp.priority_at,
              CASE
                WHEN s.curation_status = 'pending' AND rp.priority_at IS NOT NULL THEN 1
                WHEN s.curation_status = 'pending'
                 AND EXISTS (
                   SELECT 1
                     FROM session_enrich se
                    WHERE se.session_id = s.id
                      AND se.query_run_id = '${SYSTEM_RUN_ID}'
                      AND se.name = 'session_kind'
                      AND json_extract(se.value, '$.kind') = 'deliverable'
                 )
                  THEN 2
                WHEN s.curation_status = 'pending'
                 AND (s.curated_revision IS NULL OR
                      s.curated_revision != json_array(s.file_mtime, s.modified_at, s.message_count))
                  THEN 3
                WHEN s.curation_status = 'deferred' THEN 4
                ELSE 5
              END AS priority_bucket
         FROM sessions s
         LEFT JOIN root_priority rp ON rp.root_id = s.id
        WHERE s.is_subagent = 0
          AND s.curation_status IN ('pending', 'deferred')
          ${filter.sql}
        ORDER BY priority_bucket ASC,
                 COALESCE(rp.priority_at, 0) DESC,
                 COALESCE(s.modified_at, s.created_at, 0) DESC,
                 s.id ASC
        LIMIT ?`,
    )
    .all(...filter.params, limit) as Array<Record<string, unknown>>;
  const counts = db
    .prepare(
      `SELECT curation_status AS status, COUNT(*) AS count
         FROM sessions s
        WHERE is_subagent = 0 ${filter.sql}
        GROUP BY curation_status`,
    )
    .all(...filter.params) as Array<{ status: CurationStatus; count: number }>;
  const byStatus: Record<CurationStatus, number> = {
    pending: 0,
    consumed: 0,
    skipped: 0,
    deferred: 0,
  };
  for (const row of counts) byStatus[row.status] = row.count;
  return {
    items: rows.map((row) => ({ kind: 'session' as const, ...serializeInboxSession(row) })),
    limit,
    remaining: byStatus.pending + byStatus.deferred,
    counts: byStatus,
  };
}

export function getCurationContext(sessionId: string) {
  const rootSessionId = resolveRootSessionId(sessionId);
  const root = getSession(rootSessionId);
  if (!root) throw new Error(`session not found: ${sessionId}`);
  const db = getDb();
  const rows = db
    .prepare(
      `WITH RECURSIVE descendants(id) AS (
         SELECT ?
         UNION
         SELECT sl.child_id FROM session_links sl JOIN descendants d ON sl.parent_id = d.id
       )
       SELECT id FROM descendants`,
    )
    .all(rootSessionId) as Array<{ id: string }>;
  const sessions = rows.map(({ id }) => {
    const session = getSession(id)!;
    const files = db
      .prepare(
        `SELECT session_id, path_rel, role, writes, reads
           FROM session_file WHERE session_id = ? ORDER BY writes DESC, reads DESC, path_rel ASC`,
      )
      .all(id) as SessionSignalRow[];
    const planRefs = db
      .prepare(
        'SELECT plan_slug AS slug, kind FROM plan_refs WHERE session_id = ? ORDER BY plan_slug, kind',
      )
      .all(id);
    const enrichments = listSessionEnrichments(id, SYSTEM_RUN_ID).filter((item) =>
      ['first_intent', 'session_kind', 'subagent_summary'].includes(item.name),
    );
    return { session, revision: sessionRevision(session), files, planRefs, enrichments };
  });
  return {
    requestedSessionId: sessionId,
    rootSessionId,
    tree: getSessionTree(rootSessionId, 20),
    sessions,
  };
}

export function listWorkThreads(
  opts: { projectId?: string; lifecycle?: ThreadLifecycle } = {},
): WorkThread[] {
  const db = getDb();
  const params: string[] = [];
  const clauses: string[] = [];
  if (opts.projectId) {
    clauses.push('project_profile_id = ?');
    params.push(canonicalProjectId(opts.projectId));
  }
  if (opts.lifecycle === 'artifact') {
    clauses.push('artifact_type IS NOT NULL');
  } else if (opts.lifecycle === 'ready') {
    clauses.push("status = 'ready' AND artifact_type IS NULL");
  } else if (opts.lifecycle === 'open') {
    clauses.push("status != 'ready' AND artifact_type IS NULL");
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  return (
    db
      .prepare(`SELECT * FROM work_thread ${where} ORDER BY updated_at DESC, id ASC`)
      .all(...params) as WorkThreadRow[]
  ).map(rowToThread);
}

export function getWorkThread(id: string): WorkThread | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM work_thread WHERE id = ?').get(id) as
    | WorkThreadRow
    | undefined;
  if (!row) return null;
  // Lineage order is the "first need -> final" narrative: by session creation
  // time, with a stable id tiebreak when timestamps are equal or missing.
  const sessions = db
    .prepare(
      `SELECT wts.session_id, wts.role, wts.rationale, s.created_at AS created_at
         FROM work_thread_session wts
         JOIN sessions s ON s.id = wts.session_id
        WHERE wts.thread_id = ?
        ORDER BY COALESCE(s.created_at, 0) ASC, wts.session_id ASC`,
    )
    .all(id) as Array<WorkThreadSessionRow & { created_at: number | null }>;
  const lineageEvents = (
    db
      .prepare(
        `SELECT id, session_id, event_type, role, rationale, created_at
           FROM work_thread_lineage_event
          WHERE thread_id = ?
          ORDER BY created_at ASC, id ASC`,
      )
      .all(id) as WorkThreadLineageEventRow[]
  ).map((row) => ({
    id: row.id,
    sessionId: row.session_id,
    eventType: row.event_type,
    role: row.role,
    rationale: row.rationale,
    createdAt: row.created_at,
  }));
  // The head is the session that finalized the artifact: the latest contributor
  // (falling back to the latest session of any role), derived at read time.
  const contributors = sessions.filter((session) => session.role === 'contributor');
  const headPool = contributors.length ? contributors : sessions;
  const headSessionId = headPool.length
    ? headPool.reduce((best, session) =>
        (session.created_at ?? 0) > (best.created_at ?? 0) ? session : best,
      ).session_id
    : null;
  return {
    ...rowToThread(row),
    headSessionId,
    sessions: sessions.map((session) => ({
      sessionId: session.session_id,
      role: session.role,
      rationale: session.rationale,
    })),
    lineageEvents,
  };
}

function expectString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim())
    throw new Error(`${field} must be a non-empty string`);
  return value;
}

function expectRole(value: unknown): WorkThreadRole {
  if (value !== 'contributor' && value !== 'evidence')
    throw new Error('role must be contributor or evidence');
  return value;
}

function expectActionObject(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`${field} must be an object`);
  return value as Record<string, unknown>;
}

function requireThread(id: string): WorkThread {
  const thread = getWorkThread(id);
  if (!thread) throw new Error(`thread not found: ${id}`);
  return thread;
}

// Open threads may be regrouped freely. Ready threads are queued for artifact
// creation, while artifacts accept lineage events only.
function requireMutableThread(id: string): WorkThread {
  const thread = requireThread(id);
  if (thread.lifecycle !== 'open')
    throw new Error(`thread ${id} is ${thread.lifecycle} and can no longer be regrouped`);
  return thread;
}

function requireSession(id: string, resolvedSessions?: Map<string, string>): string {
  const rootId = resolveRootSessionId(id);
  if (!getSession(rootId)) throw new Error(`session not found: ${id}`);
  resolvedSessions?.set(id, rootId);
  return rootId;
}

function nextLineageEventTime(threadId: string): number {
  const previous = getDb()
    .prepare(
      'SELECT MAX(created_at) AS created_at FROM work_thread_lineage_event WHERE thread_id = ?',
    )
    .get(threadId) as { created_at: number | null };
  return Math.max(Date.now(), (previous.created_at ?? 0) + 1);
}

function appendLineageAttach(
  threadId: string,
  sessionId: string,
  role: WorkThreadRole,
  rationale: unknown,
  resolvedSessions?: Map<string, string>,
  opts: { allowNonOpen?: boolean } = {},
): void {
  const thread = opts.allowNonOpen ? requireThread(threadId) : requireMutableThread(threadId);
  const rootId = requireSession(sessionId, resolvedSessions);
  if (rationale != null && typeof rationale !== 'string')
    throw new Error('rationale must be a string or null');
  const db = getDb();
  const now = nextLineageEventTime(threadId);
  db.prepare(
    `INSERT INTO work_thread_lineage_event (
       id, thread_id, session_id, event_type, role, rationale, created_at
     ) VALUES (?, ?, ?, 'attach', ?, ?, ?)`,
  ).run(randomUUID(), threadId, rootId, role, rationale ?? null, now);
  db.prepare(
    `INSERT INTO work_thread_session (thread_id, session_id, role, rationale)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(thread_id, session_id) DO UPDATE SET role=excluded.role, rationale=excluded.rationale`,
  ).run(threadId, rootId, role, rationale ?? null);
  if (thread.lifecycle === 'ready') {
    db.prepare(
      `UPDATE work_thread
          SET status = 'open', ready_at = NULL,
              readiness_rationale = 'Reopened after lineage attachment', updated_at = ?
        WHERE id = ? AND artifact_type IS NULL`,
    ).run(now, threadId);
  }
}

function appendLineageRetract(threadId: string, sessionId: string, rationale: unknown): void {
  const thread = requireThread(threadId);
  const rootId = requireSession(sessionId);
  if (rationale != null && typeof rationale !== 'string')
    throw new Error('rationale must be a string or null');
  const db = getDb();
  const current = db
    .prepare('SELECT role FROM work_thread_session WHERE thread_id = ? AND session_id = ?')
    .get(threadId, rootId) as { role: WorkThreadRole } | undefined;
  if (!current) throw new Error(`session ${rootId} is not attached to thread ${threadId}`);
  const now = nextLineageEventTime(threadId);
  db.prepare(
    `INSERT INTO work_thread_lineage_event (
       id, thread_id, session_id, event_type, role, rationale, created_at
     ) VALUES (?, ?, ?, 'retract', ?, ?, ?)`,
  ).run(randomUUID(), threadId, rootId, current.role, rationale ?? null, now);
  db.prepare('DELETE FROM work_thread_session WHERE thread_id = ? AND session_id = ?').run(
    threadId,
    rootId,
  );
  db.prepare(
    `UPDATE sessions
        SET curation_status = 'pending'
      WHERE id = ?
        AND curation_status = 'consumed'
        AND NOT EXISTS (SELECT 1 FROM work_thread_session WHERE session_id = ?)`,
  ).run(rootId, rootId);
  if (thread.artifactType == null) {
    db.prepare(
      `UPDATE work_thread
          SET status = 'open', ready_at = NULL,
              readiness_rationale = 'Reopened after lineage retraction', updated_at = ?
        WHERE id = ?`,
    ).run(now, threadId);
  }
}

function createThread(action: Record<string, unknown>, now: number): string {
  const id = typeof action.id === 'string' && action.id.trim() ? action.id : randomUUID();
  const projectProfileId = canonicalProjectId(
    expectString(action.projectProfileId, 'projectProfileId'),
  );
  const provisionalTitle = expectString(action.provisionalTitle, 'provisionalTitle');
  if (action.summary != null && typeof action.summary !== 'string')
    throw new Error('summary must be a string or null');
  if (action.status !== undefined) throw new Error('thread.create.status is not supported');
  getDb()
    .prepare(
      `INSERT INTO work_thread
        (id, project_profile_id, provisional_title, summary, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, projectProfileId, provisionalTitle, action.summary ?? null, 'open', now, now);
  return id;
}

export function applyCurationBatch(input: unknown) {
  const body = expectActionObject(input, 'input');
  if (!Array.isArray(body.actions) || body.actions.length === 0)
    throw new Error('actions must be a non-empty array');
  const actions = body.actions;
  const db = getDb();
  const now = Date.now();
  const createdThreadIds: string[] = [];
  const resolvedSessions = new Map<string, string>();
  const tx = db.transaction(() => {
    for (const [index, raw] of actions.entries()) {
      const action = expectActionObject(raw, `actions[${index}]`);
      const type = expectString(action.type, `actions[${index}].type`);
      if (type === 'thread.create') {
        createdThreadIds.push(createThread(action, now));
        continue;
      }
      if (type === 'thread.update') {
        const threadId = expectString(action.threadId, 'threadId');
        requireMutableThread(threadId);
        const patch = expectActionObject(action.patch, 'patch');
        for (const key of Object.keys(patch)) {
          if (!['provisionalTitle', 'summary'].includes(key))
            throw new Error(`unsupported thread patch field: ${key}`);
        }
        const current = getWorkThread(threadId)!;
        const title =
          patch.provisionalTitle === undefined
            ? current.provisionalTitle
            : expectString(patch.provisionalTitle, 'provisionalTitle');
        const summary = patch.summary === undefined ? current.summary : patch.summary;
        if (summary != null && typeof summary !== 'string')
          throw new Error('summary must be a string or null');
        db.prepare(
          'UPDATE work_thread SET provisional_title = ?, summary = ?, updated_at = ? WHERE id = ?',
        ).run(title, summary, now, threadId);
        continue;
      }
      if (type === 'thread.attach') {
        appendLineageAttach(
          expectString(action.threadId, 'threadId'),
          expectString(action.sessionId, 'sessionId'),
          expectRole(action.role),
          action.rationale,
          resolvedSessions,
        );
        continue;
      }
      if (type === 'thread.detach') {
        const threadId = expectString(action.threadId, 'threadId');
        requireMutableThread(threadId);
        appendLineageRetract(
          threadId,
          requireSession(expectString(action.sessionId, 'sessionId'), resolvedSessions),
          action.rationale ?? 'Detached during mutable curation',
        );
        continue;
      }
      if (type === 'lineage.attach') {
        appendLineageAttach(
          expectString(action.threadId, 'threadId'),
          expectString(action.sessionId, 'sessionId'),
          expectRole(action.role),
          action.rationale,
          resolvedSessions,
          { allowNonOpen: true },
        );
        continue;
      }
      if (type === 'lineage.retract') {
        appendLineageRetract(
          expectString(action.threadId, 'threadId'),
          expectString(action.sessionId, 'sessionId'),
          action.rationale,
        );
        continue;
      }
      if (type === 'thread.merge') {
        const targetThreadId = expectString(action.targetThreadId, 'targetThreadId');
        requireMutableThread(targetThreadId);
        const target = getWorkThread(targetThreadId)!;
        if (!Array.isArray(action.sourceThreadIds) || action.sourceThreadIds.length === 0)
          throw new Error('sourceThreadIds must be a non-empty array');
        for (const rawId of action.sourceThreadIds) {
          const sourceId = expectString(rawId, 'sourceThreadIds[]');
          if (sourceId === targetThreadId) continue;
          requireMutableThread(sourceId);
          if (getWorkThread(sourceId)!.projectProfileId !== target.projectProfileId) {
            throw new Error('merged threads must belong to the same project');
          }
          const memberships = db
            .prepare(
              'SELECT session_id, role, rationale FROM work_thread_session WHERE thread_id = ?',
            )
            .all(sourceId) as Array<WorkThreadSessionRow>;
          for (const membership of memberships) {
            appendLineageAttach(
              targetThreadId,
              membership.session_id,
              membership.role,
              membership.rationale,
              resolvedSessions,
            );
          }
          db.prepare('DELETE FROM work_thread WHERE id = ?').run(sourceId);
        }
        db.prepare('UPDATE work_thread SET updated_at = ? WHERE id = ?').run(now, targetThreadId);
        continue;
      }
      if (type === 'thread.split') {
        const sourceThreadId = expectString(action.sourceThreadId, 'sourceThreadId');
        requireMutableThread(sourceThreadId);
        if (!Array.isArray(action.threads) || action.threads.length === 0)
          throw new Error('threads must be a non-empty array');
        for (const rawThread of action.threads) {
          const thread = expectActionObject(rawThread, 'threads[]');
          if (!Array.isArray(thread.sessionIds) || thread.sessionIds.length === 0)
            throw new Error('threads[].sessionIds must be a non-empty array');
          const id = createThread(
            { ...thread, projectProfileId: getWorkThread(sourceThreadId)!.projectProfileId },
            now,
          );
          createdThreadIds.push(id);
          for (const rawSessionId of thread.sessionIds) {
            const rootId = requireSession(
              expectString(rawSessionId, 'threads[].sessionIds[]'),
              resolvedSessions,
            );
            const membership = db
              .prepare(
                'SELECT role, rationale FROM work_thread_session WHERE thread_id = ? AND session_id = ?',
              )
              .get(sourceThreadId, rootId) as WorkThreadSessionRow | undefined;
            if (!membership)
              throw new Error(`session ${rootId} is not attached to thread ${sourceThreadId}`);
            appendLineageAttach(
              id,
              rootId,
              thread.role === undefined ? membership.role : expectRole(thread.role),
              thread.rationale === undefined ? membership.rationale : thread.rationale,
              resolvedSessions,
            );
            appendLineageRetract(sourceThreadId, rootId, 'Moved into split work thread');
          }
        }
        db.prepare('UPDATE work_thread SET updated_at = ? WHERE id = ?').run(now, sourceThreadId);
        continue;
      }
      if (type === 'thread.mark-ready' || type === 'thread.finalize') {
        const threadId = expectString(action.threadId, 'threadId');
        requireMutableThread(threadId);
        const contributorCount = (
          db
            .prepare(
              "SELECT COUNT(*) AS count FROM work_thread_session WHERE thread_id = ? AND role = 'contributor'",
            )
            .get(threadId) as { count: number }
        ).count;
        if (contributorCount === 0)
          throw new Error(`thread ${threadId} has no contributor sessions to mark ready`);
        const rationale =
          type === 'thread.finalize' && action.rationale === undefined
            ? 'Marked ready via deprecated thread.finalize action'
            : expectString(action.rationale, 'rationale');
        db.prepare(
          `UPDATE work_thread
              SET status = 'ready', ready_at = ?, readiness_rationale = ?, updated_at = ?
            WHERE id = ?`,
        ).run(now, rationale, now, threadId);
        continue;
      }
      if (type === 'thread.reopen') {
        const threadId = expectString(action.threadId, 'threadId');
        const thread = requireThread(threadId);
        if (thread.artifactType != null) throw new Error(`artifact ${threadId} cannot be reopened`);
        const rationale = expectString(action.rationale, 'rationale');
        db.prepare(
          `UPDATE work_thread
              SET status = 'open', ready_at = NULL, readiness_rationale = ?, updated_at = ?
            WHERE id = ?`,
        ).run(`Reopened: ${rationale}`, now, threadId);
        continue;
      }
      if (type === 'session.consume' || type === 'session.skip' || type === 'session.defer') {
        const sessionId = requireSession(
          expectString(action.sessionId, 'sessionId'),
          resolvedSessions,
        );
        if (action.note != null && typeof action.note !== 'string')
          throw new Error('note must be a string or null');
        const status: CurationStatus =
          type === 'session.consume'
            ? 'consumed'
            : type === 'session.skip'
              ? 'skipped'
              : 'deferred';
        const session = getSession(sessionId)!;
        db.prepare(
          `UPDATE sessions
              SET curation_status = ?, curated_revision = ?, curated_at = ?,
                  curation_note = ?, curation_priority_at = NULL
            WHERE id = ?`,
        ).run(status, sessionRevision(session), now, action.note ?? null, sessionId);
        continue;
      }
      throw new Error(`unknown curation action: ${type}`);
    }
    // Keep this global: a consumed orphan indicates database corruption or a
    // mutation path that bypassed this API. Refuse further writes until repaired.
    const invalid = db
      .prepare(
        `SELECT s.id
           FROM sessions s
          WHERE s.curation_status = 'consumed'
            AND NOT EXISTS (SELECT 1 FROM work_thread_session wts WHERE wts.session_id = s.id)
          LIMIT 1`,
      )
      .get() as { id: string } | undefined;
    if (invalid)
      throw new Error(`consumed session must be attached to at least one thread: ${invalid.id}`);
  });
  withDbRetry(tx);
  return {
    ok: true,
    createdThreadIds,
    resolvedSessions: [...resolvedSessions].map(([requestedSessionId, rootSessionId]) => ({
      requestedSessionId,
      rootSessionId,
    })),
  };
}

// Layer 3B step 2: create a stable artifact payload from a ready work thread.
// `payload` is open JSON so the deliverable can be a file set
// (`{ "files": [...] }`), inline content (`{ "text": "..." }` for a tweet that
// only lives in the session), or a mix.
export function finalizeArtifact(input: unknown): {
  ok: true;
  threadId: string;
  artifactType: string;
} {
  const body = expectActionObject(input, 'input');
  const threadId = expectString(body.threadId, 'threadId');
  const type = expectString(body.type, 'type');
  const title = body.title === undefined ? null : expectString(body.title, 'title');
  const predecessorArtifactId =
    body.predecessorArtifactId === undefined
      ? null
      : expectString(body.predecessorArtifactId, 'predecessorArtifactId');
  let payload: Record<string, unknown> = {};
  if (body.payload !== undefined) payload = expectActionObject(body.payload, 'payload');
  const db = getDb();
  const now = Date.now();
  const tx = db.transaction(() => {
    const row = db.prepare('SELECT * FROM work_thread WHERE id = ?').get(threadId) as
      | WorkThreadRow
      | undefined;
    if (!row) throw new Error(`thread not found: ${threadId}`);
    if (row.status !== 'ready')
      throw new Error(`thread ${threadId} must be ready before creating an artifact`);
    if (row.artifact_type != null) throw new Error(`thread ${threadId} already has an artifact`);
    const contributorCount = (
      db
        .prepare(
          "SELECT COUNT(*) AS count FROM work_thread_session WHERE thread_id = ? AND role = 'contributor'",
        )
        .get(threadId) as { count: number }
    ).count;
    if (contributorCount === 0)
      throw new Error(`thread ${threadId} has no contributor sessions for artifact creation`);
    if (!row.readiness_rationale?.trim())
      throw new Error(`thread ${threadId} has no readiness rationale`);
    if (predecessorArtifactId != null) {
      const predecessor = getArtifact(predecessorArtifactId);
      if (!predecessor) throw new Error(`predecessor artifact not found: ${predecessorArtifactId}`);
      if (predecessor.id === threadId) throw new Error('artifact cannot succeed itself');
    }
    db.prepare(
      `UPDATE work_thread
          SET artifact_type = ?,
              payload = ?,
              artifact_finalized_at = ?,
              predecessor_artifact_id = ?,
              provisional_title = COALESCE(?, provisional_title),
              updated_at = ?
        WHERE id = ?`,
    ).run(type, JSON.stringify(payload), now, predecessorArtifactId, title, now, threadId);
  });
  withDbRetry(tx);
  return { ok: true, threadId, artifactType: type };
}

export function listArtifactInbox(opts: { limit?: number } = {}) {
  const limit = Math.max(0, Math.min(Math.floor(opts.limit ?? 10), 1000));
  const items = (
    getDb()
      .prepare(
        `SELECT *
           FROM work_thread
          WHERE status = 'ready'
            AND artifact_type IS NULL
          ORDER BY COALESCE(ready_at, updated_at) ASC, id ASC
          LIMIT ?`,
      )
      .all(limit) as WorkThreadRow[]
  ).map(rowToThread);
  const remaining = (
    getDb()
      .prepare(
        `SELECT COUNT(*) AS count
           FROM work_thread
          WHERE status = 'ready'
            AND artifact_type IS NULL`,
      )
      .get() as { count: number }
  ).count;
  return { items, limit, remaining };
}

// Read finalized artifacts (work threads where an artifact has been extracted).
export function listArtifacts(opts: { projectId?: string; type?: string } = {}): WorkThread[] {
  const db = getDb();
  const clauses = ['artifact_type IS NOT NULL'];
  const params: string[] = [];
  if (opts.projectId) {
    clauses.push('project_profile_id = ?');
    params.push(canonicalProjectId(opts.projectId));
  }
  if (opts.type) {
    clauses.push('artifact_type = ?');
    params.push(opts.type);
  }
  return (
    db
      .prepare(
        `SELECT * FROM work_thread
          WHERE ${clauses.join(' AND ')}
          ORDER BY artifact_finalized_at DESC, id ASC`,
      )
      .all(...params) as WorkThreadRow[]
  ).map(rowToThread);
}

// A single artifact: the stable payload plus current effective lineage and its
// audited event stream. Returns null when the thread is missing or has no artifact yet.
export function getArtifact(threadId: string): WorkThread | null {
  const thread = getWorkThread(threadId);
  if (!thread || thread.artifactType == null) return null;
  return thread;
}

import { randomUUID } from 'node:crypto';
import {
  getDb,
  getSession,
  getSessionParent,
  getSessionTree,
  listSessionEnrichments,
  SYSTEM_RUN_ID,
} from '../db.js';
import type { Session } from '../types.js';

export type CurationStatus = 'pending' | 'consumed' | 'skipped' | 'deferred';
export type WorkThreadRole = 'contributor' | 'evidence';

// Layer 3B lifecycle, derived from the folded work_thread row:
//   open      -> still being curated (L3A)
//   finalized -> work-thread finalize done; the thread is locked
//   artifact  -> artifact extracted (artifact_type set)
export type ThreadLifecycle = 'open' | 'finalized' | 'artifact';

export interface WorkThreadSession {
  sessionId: string;
  role: WorkThreadRole;
  rationale: string | null;
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
  lifecycle: ThreadLifecycle;
  headSessionId?: string | null;
  sessions?: WorkThreadSession[];
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
}

interface WorkThreadSessionRow {
  session_id: string;
  role: WorkThreadRole;
  rationale: string | null;
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
    artifactType != null ? 'artifact' : row.status === 'finalized' ? 'finalized' : 'open';
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
    tx();
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
  tx();
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
                WHEN s.curation_status = 'pending' AND rp.priority_at IS NOT NULL THEN 0
                WHEN s.curation_status = 'pending'
                 AND (s.curated_revision IS NULL OR
                      s.curated_revision != json_array(s.file_mtime, s.modified_at, s.message_count))
                  THEN 1
                WHEN s.curation_status = 'deferred' THEN 2
                ELSE 3
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
    items: rows.map((row) => ({
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
    })),
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
  } else if (opts.lifecycle === 'finalized') {
    clauses.push("status = 'finalized' AND artifact_type IS NULL");
  } else if (opts.lifecycle === 'open') {
    clauses.push("status != 'finalized' AND artifact_type IS NULL");
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

// A finalized thread is an immutable artifact (or a locked thread awaiting
// extraction); curation can no longer touch it. This guard is what makes the
// folded artifact immutable without a physically separate table.
function requireMutableThread(id: string): WorkThread {
  const thread = requireThread(id);
  if (thread.lifecycle !== 'open')
    throw new Error(`thread ${id} is finalized and can no longer be curated`);
  return thread;
}

function requireSession(id: string, resolvedSessions?: Map<string, string>): string {
  const rootId = resolveRootSessionId(id);
  if (!getSession(rootId)) throw new Error(`session not found: ${id}`);
  resolvedSessions?.set(id, rootId);
  return rootId;
}

function attach(
  threadId: string,
  sessionId: string,
  role: WorkThreadRole,
  rationale: unknown,
  resolvedSessions?: Map<string, string>,
): void {
  requireMutableThread(threadId);
  const rootId = requireSession(sessionId, resolvedSessions);
  if (rationale != null && typeof rationale !== 'string')
    throw new Error('rationale must be a string or null');
  getDb()
    .prepare(
      `INSERT INTO work_thread_session (thread_id, session_id, role, rationale)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(thread_id, session_id) DO UPDATE SET role=excluded.role, rationale=excluded.rationale`,
    )
    .run(threadId, rootId, role, rationale ?? null);
}

function createThread(action: Record<string, unknown>, now: number): string {
  const id = typeof action.id === 'string' && action.id.trim() ? action.id : randomUUID();
  const projectProfileId = canonicalProjectId(
    expectString(action.projectProfileId, 'projectProfileId'),
  );
  const provisionalTitle = expectString(action.provisionalTitle, 'provisionalTitle');
  if (action.summary != null && typeof action.summary !== 'string')
    throw new Error('summary must be a string or null');
  if (action.status != null && typeof action.status !== 'string')
    throw new Error('status must be a string');
  getDb()
    .prepare(
      `INSERT INTO work_thread
        (id, project_profile_id, provisional_title, summary, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      projectProfileId,
      provisionalTitle,
      action.summary ?? null,
      action.status ?? 'open',
      now,
      now,
    );
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
          if (!['provisionalTitle', 'summary', 'status'].includes(key))
            throw new Error(`unsupported thread patch field: ${key}`);
        }
        const current = getWorkThread(threadId)!;
        const title =
          patch.provisionalTitle === undefined
            ? current.provisionalTitle
            : expectString(patch.provisionalTitle, 'provisionalTitle');
        const summary = patch.summary === undefined ? current.summary : patch.summary;
        const status =
          patch.status === undefined ? current.status : expectString(patch.status, 'status');
        if (summary != null && typeof summary !== 'string')
          throw new Error('summary must be a string or null');
        db.prepare(
          'UPDATE work_thread SET provisional_title = ?, summary = ?, status = ?, updated_at = ? WHERE id = ?',
        ).run(title, summary, status, now, threadId);
        continue;
      }
      if (type === 'thread.attach') {
        attach(
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
        db.prepare('DELETE FROM work_thread_session WHERE thread_id = ? AND session_id = ?').run(
          threadId,
          requireSession(expectString(action.sessionId, 'sessionId'), resolvedSessions),
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
          db.prepare(
            `INSERT OR IGNORE INTO work_thread_session (thread_id, session_id, role, rationale)
             SELECT ?, session_id, role, rationale FROM work_thread_session WHERE thread_id = ?`,
          ).run(targetThreadId, sourceId);
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
            attach(
              id,
              rootId,
              thread.role === undefined ? membership.role : expectRole(thread.role),
              thread.rationale === undefined ? membership.rationale : thread.rationale,
              resolvedSessions,
            );
            db.prepare(
              'DELETE FROM work_thread_session WHERE thread_id = ? AND session_id = ?',
            ).run(sourceThreadId, rootId);
          }
        }
        db.prepare('UPDATE work_thread SET updated_at = ? WHERE id = ?').run(now, sourceThreadId);
        continue;
      }
      if (type === 'thread.finalize') {
        // Step 1 of Layer 3B: curation is complete for this thread. Lock it so
        // its membership is frozen, ready for artifact extraction.
        const threadId = expectString(action.threadId, 'threadId');
        requireMutableThread(threadId);
        const memberCount = (
          db
            .prepare('SELECT COUNT(*) AS count FROM work_thread_session WHERE thread_id = ?')
            .get(threadId) as { count: number }
        ).count;
        if (memberCount === 0) throw new Error(`thread ${threadId} has no sessions to finalize`);
        db.prepare("UPDATE work_thread SET status = 'finalized', updated_at = ? WHERE id = ?").run(
          now,
          threadId,
        );
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
  tx();
  return {
    ok: true,
    createdThreadIds,
    resolvedSessions: [...resolvedSessions].map(([requestedSessionId, rootSessionId]) => ({
      requestedSessionId,
      rootSessionId,
    })),
  };
}

// Layer 3B step 2: extract the durable artifact from a finalized work thread.
// The thread must already be finalized (locked) and must not yet carry an
// artifact. `payload` is open JSON so the deliverable can be a file set
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
  let payload: Record<string, unknown> = {};
  if (body.payload !== undefined) payload = expectActionObject(body.payload, 'payload');
  const db = getDb();
  const now = Date.now();
  const tx = db.transaction(() => {
    const row = db.prepare('SELECT * FROM work_thread WHERE id = ?').get(threadId) as
      | WorkThreadRow
      | undefined;
    if (!row) throw new Error(`thread not found: ${threadId}`);
    if (row.status !== 'finalized')
      throw new Error(`thread ${threadId} must be finalized before extracting an artifact`);
    if (row.artifact_type != null) throw new Error(`thread ${threadId} already has an artifact`);
    db.prepare(
      `UPDATE work_thread
          SET artifact_type = ?,
              payload = ?,
              artifact_finalized_at = ?,
              provisional_title = COALESCE(?, provisional_title),
              updated_at = ?
        WHERE id = ?`,
    ).run(type, JSON.stringify(payload), now, title, now, threadId);
  });
  tx();
  return { ok: true, threadId, artifactType: type };
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

// A single artifact: the finalized thread plus its frozen lineage and derived
// head. Returns null when the thread is missing or has no artifact yet.
export function getArtifact(threadId: string): WorkThread | null {
  const thread = getWorkThread(threadId);
  if (!thread || thread.artifactType == null) return null;
  return thread;
}

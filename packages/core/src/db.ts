import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { DB_PATH, ensureSuperdenseDirs } from './paths.js';
import { normalizeQueryDefinition, type QueryDefinition } from './query/types.js';
import type { Query, QueryMatch, Session } from './types.js';
import { resolveProjectKey } from './util/project-key.js';

let dbInstance: Database.Database | null = null;

export const SYSTEM_RUN_ID = 'system';

export function getDb(): Database.Database {
  if (dbInstance) return dbInstance;
  ensureSuperdenseDirs();
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.function('REGEXP', { deterministic: true }, (pattern: unknown, value: unknown) => {
    if (value == null || pattern == null) return 0;
    try {
      return new RegExp(String(pattern)).test(String(value)) ? 1 : 0;
    } catch {
      return 0;
    }
  });
  migrate(db);
  dbInstance = db;
  return db;
}

/** Test-only: reset the cached instance so a fresh :memory: DB can be opened. */
export function _resetDbForTests(): void {
  if (dbInstance) {
    try {
      dbInstance.close();
    } catch {
      /* ignore */
    }
  }
  dbInstance = null;
}

function migrate(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id              TEXT PRIMARY KEY,
      agent           TEXT NOT NULL,
      session_id      TEXT NOT NULL,
      log_path        TEXT NOT NULL,
      pwd             TEXT NOT NULL,
      project_key     TEXT NOT NULL DEFAULT '',
      first_prompt    TEXT,
      summary         TEXT,
      message_count   INTEGER,
      git_branch      TEXT,
      created_at      INTEGER,
      modified_at     INTEGER,
      is_sidechain    INTEGER DEFAULT 0,
      file_mtime      INTEGER,
      last_indexed_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_pwd ON sessions(pwd);
    CREATE INDEX IF NOT EXISTS idx_sessions_agent ON sessions(agent);
    CREATE INDEX IF NOT EXISTS idx_sessions_modified ON sessions(modified_at);

    CREATE TABLE IF NOT EXISTS queries (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      predicate   TEXT NOT NULL,
      created_at  INTEGER,
      last_run_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS query_run (
      id              TEXT PRIMARY KEY,
      saved_query_id  TEXT REFERENCES queries(id) ON DELETE SET NULL,
      dsl             TEXT NOT NULL,
      started_at      INTEGER NOT NULL,
      finished_at     INTEGER,
      matched_count   INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_qrun_saved ON query_run(saved_query_id);
    CREATE INDEX IF NOT EXISTS idx_qrun_started ON query_run(started_at);
  `);

  // query_matches: create with new schema only if it doesn't already exist.
  // (For V2 dbs the old (query_id, ...) schema is still present until V3 rewrites it.)
  if (!tableExists(db, 'query_matches')) {
    db.exec(`
      CREATE TABLE query_matches (
        query_run_id TEXT NOT NULL REFERENCES query_run(id) ON DELETE CASCADE,
        session_id   TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        added_at     INTEGER,
        evidence     TEXT,
        PRIMARY KEY (query_run_id, session_id)
      );
      CREATE INDEX IF NOT EXISTS idx_query_matches_session ON query_matches(session_id);
      CREATE INDEX IF NOT EXISTS idx_query_matches_run ON query_matches(query_run_id);
    `);
  }

  // session_enrich: same — only create with new schema if not present.
  if (!tableExists(db, 'session_enrich')) {
    db.exec(`
      CREATE TABLE session_enrich (
        session_id   TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        query_run_id TEXT NOT NULL REFERENCES query_run(id) ON DELETE CASCADE,
        name         TEXT NOT NULL,
        version      INTEGER NOT NULL,
        value        TEXT NOT NULL,
        computed_at  INTEGER NOT NULL,
        PRIMARY KEY (session_id, query_run_id, name)
      );
      CREATE INDEX IF NOT EXISTS idx_senrich_name ON session_enrich(name);
      CREATE INDEX IF NOT EXISTS idx_senrich_run ON session_enrich(query_run_id);
    `);
  }

  const currentVersion = (db.pragma('user_version', { simple: true }) as number) ?? 0;
  if (currentVersion < 1) {
    runDataMigrationV1(db);
    db.pragma('user_version = 1');
  }
  if (currentVersion < 2) {
    runDataMigrationV2(db);
    db.pragma('user_version = 2');
  }
  if (currentVersion < 3) {
    runDataMigrationV3(db);
    db.pragma('user_version = 3');
  }
  if (currentVersion < 4) {
    runDataMigrationV4(db);
    db.pragma('user_version = 4');
  }

  ensureSystemRun(db);
}

function tableExists(db: Database.Database, name: string): boolean {
  const row = db
    .prepare("SELECT 1 AS x FROM sqlite_master WHERE type='table' AND name = ?")
    .get(name) as { x: number } | undefined;
  return !!row;
}

function columnExists(db: Database.Database, table: string, column: string): boolean {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return rows.some((r) => r.name === column);
}

function runDataMigrationV1(db: Database.Database): void {
  const hasOldGroups = tableExists(db, 'groups');
  const hasOldItems = tableExists(db, 'group_items');
  const hasOldEnrich = tableExists(db, 'session_enrichments');
  if (!hasOldGroups && !hasOldItems && !hasOldEnrich) return;

  const migrateTx = db.transaction(() => {
    if (hasOldGroups) {
      const oldGroups = db
        .prepare('SELECT id, name, plugin_name, plugin_config, created_at, last_run_at FROM groups')
        .all() as Array<{
        id: string;
        name: string;
        plugin_name: string;
        plugin_config: string | null;
        created_at: number | null;
        last_run_at: number | null;
      }>;
      const insertQuery = db.prepare(
        'INSERT OR IGNORE INTO queries (id, name, predicate, created_at, last_run_at) VALUES (?, ?, ?, ?, ?)',
      );
      for (const g of oldGroups) {
        const cfg = g.plugin_config ? JSON.parse(g.plugin_config) : {};
        const filterName =
          g.plugin_name === 'by-user-prompt-keyword' ? 'user_prompt_contains' : g.plugin_name;
        const definition: QueryDefinition = {
          filters: { filter: { name: filterName, params: cfg } },
          enrichers: [],
        };
        insertQuery.run(g.id, g.name, JSON.stringify(definition), g.created_at, g.last_run_at);
      }
    }

    // group_items memberships and session_enrichments values are regeneratable
    // (re-running a saved query rebuilds matches; re-indexing rebuilds enrichments),
    // so we just drop them rather than carry them across schemas.
    if (hasOldItems) db.exec('DROP TABLE group_items;');
    if (hasOldGroups) db.exec('DROP TABLE groups;');
    if (hasOldEnrich) db.exec('DROP TABLE session_enrichments;');
  });
  migrateTx();
}

function runDataMigrationV2(db: Database.Database): void {
  const migrateTx = db.transaction(() => {
    if (!columnExists(db, 'sessions', 'project_key')) {
      db.exec("ALTER TABLE sessions ADD COLUMN project_key TEXT NOT NULL DEFAULT '';");
    }

    const rows = db.prepare('SELECT id, pwd FROM sessions').all() as Array<{
      id: string;
      pwd: string;
    }>;
    const update = db.prepare('UPDATE sessions SET project_key = ? WHERE id = ?');
    for (const row of rows) update.run(resolveProjectKey(row.pwd), row.id);
  });
  migrateTx();
}

function runDataMigrationV3(db: Database.Database): void {
  const hasLegacyEnrich = tableExists(db, 'query_enrich');
  const hasLegacyMatches =
    tableExists(db, 'query_matches') &&
    columnExists(db, 'query_matches', 'query_id') &&
    !columnExists(db, 'query_matches', 'query_run_id');
  if (!hasLegacyEnrich && !hasLegacyMatches) return;

  const tx = db.transaction(() => {
    ensureSystemRun(db);

    // Both legacy match memberships and legacy enrichments are regeneratable — drop
    // the old shapes rather than carrying rows forward.
    if (hasLegacyEnrich) {
      db.exec('DROP TABLE query_enrich;');
    }

    if (hasLegacyMatches) {
      db.exec(`
        DROP TABLE query_matches;
        CREATE TABLE query_matches (
          query_run_id TEXT NOT NULL REFERENCES query_run(id) ON DELETE CASCADE,
          session_id   TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
          added_at     INTEGER,
          evidence     TEXT,
          PRIMARY KEY (query_run_id, session_id)
        );
        CREATE INDEX IF NOT EXISTS idx_query_matches_session ON query_matches(session_id);
        CREATE INDEX IF NOT EXISTS idx_query_matches_run ON query_matches(query_run_id);
      `);
    }
  });
  tx();
}

function runDataMigrationV4(db: Database.Database): void {
  const tx = db.transaction(() => {
    if (!columnExists(db, 'sessions', 'is_subagent')) {
      db.exec('ALTER TABLE sessions ADD COLUMN is_subagent INTEGER NOT NULL DEFAULT 0;');
    }
    if (!columnExists(db, 'sessions', 'parent_session_id')) {
      db.exec('ALTER TABLE sessions ADD COLUMN parent_session_id TEXT;');
    }
    if (!tableExists(db, 'session_links')) {
      db.exec(`
        CREATE TABLE session_links (
          parent_id  TEXT NOT NULL,
          child_id   TEXT NOT NULL,
          relation   TEXT NOT NULL,
          metadata   TEXT,
          created_at INTEGER NOT NULL,
          PRIMARY KEY (parent_id, child_id)
        );
        CREATE INDEX IF NOT EXISTS idx_session_links_child ON session_links(child_id);
        CREATE INDEX IF NOT EXISTS idx_session_links_parent ON session_links(parent_id);
      `);
    }
  });
  tx();
}

function ensureSystemRun(db: Database.Database): void {
  const now = Date.now();
  db.prepare(
    `INSERT OR IGNORE INTO query_run (id, saved_query_id, dsl, started_at, finished_at, matched_count)
     VALUES (?, NULL, '{}', ?, ?, NULL)`,
  ).run(SYSTEM_RUN_ID, now, now);
}

export function _migrateForTests(db: Database.Database): void {
  migrate(db);
}

interface SessionRow {
  id: string;
  agent: string;
  session_id: string;
  log_path: string;
  pwd: string;
  project_key: string;
  first_prompt: string | null;
  summary: string | null;
  message_count: number | null;
  git_branch: string | null;
  created_at: number | null;
  modified_at: number | null;
  is_sidechain: number;
  is_subagent: number;
  parent_session_id: string | null;
  file_mtime: number | null;
  last_indexed_at: number | null;
}

function rowToSession(r: SessionRow): Session {
  return {
    id: r.id,
    agent: r.agent,
    sessionId: r.session_id,
    logPath: r.log_path,
    pwd: r.pwd,
    projectKey: r.project_key || resolveProjectKey(r.pwd),
    firstPrompt: r.first_prompt,
    summary: r.summary,
    messageCount: r.message_count,
    gitBranch: r.git_branch,
    createdAt: r.created_at,
    modifiedAt: r.modified_at,
    isSidechain: !!r.is_sidechain,
    isSubagent: !!r.is_subagent,
    parentSessionId: r.parent_session_id ?? null,
    fileMtime: r.file_mtime,
    lastIndexedAt: r.last_indexed_at,
  };
}

export function upsertSession(s: Session): void {
  const db = getDb();
  db.prepare(
    `
    INSERT INTO sessions (
      id, agent, session_id, log_path, pwd, project_key, first_prompt, summary,
      message_count, git_branch, created_at, modified_at, is_sidechain,
      is_subagent, parent_session_id, file_mtime, last_indexed_at
    ) VALUES (
      @id, @agent, @sessionId, @logPath, @pwd, @projectKey, @firstPrompt, @summary,
      @messageCount, @gitBranch, @createdAt, @modifiedAt, @isSidechain,
      @isSubagent, @parentSessionId, @fileMtime, @lastIndexedAt
    )
    ON CONFLICT(id) DO UPDATE SET
      agent=excluded.agent,
      session_id=excluded.session_id,
      log_path=excluded.log_path,
      pwd=excluded.pwd,
      project_key=excluded.project_key,
      first_prompt=excluded.first_prompt,
      summary=excluded.summary,
      message_count=excluded.message_count,
      git_branch=excluded.git_branch,
      created_at=excluded.created_at,
      modified_at=excluded.modified_at,
      is_sidechain=excluded.is_sidechain,
      is_subagent=excluded.is_subagent,
      parent_session_id=excluded.parent_session_id,
      file_mtime=excluded.file_mtime,
      last_indexed_at=excluded.last_indexed_at
  `,
  ).run({
    id: s.id,
    agent: s.agent,
    sessionId: s.sessionId,
    logPath: s.logPath,
    pwd: s.pwd,
    projectKey: resolveProjectKey(s.pwd),
    firstPrompt: s.firstPrompt ?? null,
    summary: s.summary ?? null,
    messageCount: s.messageCount ?? null,
    gitBranch: s.gitBranch ?? null,
    createdAt: s.createdAt ?? null,
    modifiedAt: s.modifiedAt ?? null,
    isSidechain: s.isSidechain ? 1 : 0,
    isSubagent: s.isSubagent ? 1 : 0,
    parentSessionId: s.parentSessionId ?? null,
    fileMtime: s.fileMtime ?? null,
    lastIndexedAt: s.lastIndexedAt ?? null,
  });
}

export interface SessionFilter {
  agent?: string;
  pwd?: string;
  q?: string;
  limit?: number;
  offset?: number;
  includeSubagents?: boolean;
}

export function listSessions(filter: SessionFilter = {}): Session[] {
  const db = getDb();
  const where: string[] = [];
  const params: Record<string, unknown> = {};
  if (!filter.includeSubagents) {
    where.push('is_subagent = 0');
  }
  if (filter.agent) {
    where.push('agent = @agent');
    params.agent = filter.agent;
  }
  if (filter.pwd) {
    where.push('pwd = @pwd');
    params.pwd = filter.pwd;
  }
  if (filter.q) {
    where.push('(first_prompt LIKE @q OR summary LIKE @q OR pwd LIKE @q)');
    params.q = `%${filter.q}%`;
  }
  const sql = `
    SELECT * FROM sessions
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY COALESCE(modified_at, 0) DESC
    LIMIT @limit OFFSET @offset
  `;
  params.limit = filter.limit ?? 200;
  params.offset = filter.offset ?? 0;
  return db
    .prepare(sql)
    .all(params)
    .map((r: unknown) => rowToSession(r as SessionRow));
}

export function countSessions(filter: SessionFilter = {}): number {
  const db = getDb();
  const where: string[] = [];
  const params: Record<string, unknown> = {};
  if (!filter.includeSubagents) {
    where.push('is_subagent = 0');
  }
  if (filter.agent) {
    where.push('agent = @agent');
    params.agent = filter.agent;
  }
  if (filter.pwd) {
    where.push('pwd = @pwd');
    params.pwd = filter.pwd;
  }
  if (filter.q) {
    where.push('(first_prompt LIKE @q OR summary LIKE @q OR pwd LIKE @q)');
    params.q = `%${filter.q}%`;
  }
  const sql = `SELECT COUNT(*) AS c FROM sessions ${where.length ? 'WHERE ' + where.join(' AND ') : ''}`;
  return (db.prepare(sql).get(params) as { c: number }).c;
}

export function getSession(id: string): Session | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as SessionRow | undefined;
  return row ? rowToSession(row) : null;
}

export function getDirtySessions(): Session[] {
  const db = getDb();
  const rows = db
    .prepare(
      `
    SELECT * FROM sessions
    WHERE last_indexed_at IS NULL OR (file_mtime IS NOT NULL AND file_mtime > last_indexed_at)
  `,
    )
    .all() as SessionRow[];
  return rows.map(rowToSession);
}

export function markIndexed(sessionId: string, now: number): void {
  getDb().prepare('UPDATE sessions SET last_indexed_at = ? WHERE id = ?').run(now, sessionId);
}

// ---- session links

export function upsertSessionLink(
  parentId: string,
  childId: string,
  relation: string,
  metadata: Record<string, unknown> | null,
  createdAt: number,
): void {
  getDb()
    .prepare(
      `INSERT INTO session_links (parent_id, child_id, relation, metadata, created_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(parent_id, child_id) DO UPDATE SET
         relation=excluded.relation,
         metadata=excluded.metadata`,
    )
    .run(parentId, childId, relation, metadata ? JSON.stringify(metadata) : null, createdAt);
}

export interface SessionLinkRow {
  childId: string;
  parentId: string;
  relation: string;
  metadata: Record<string, unknown> | null;
}

export function getSessionChildren(parentId: string): SessionLinkRow[] {
  const rows = getDb()
    .prepare('SELECT child_id, relation, metadata FROM session_links WHERE parent_id = ?')
    .all(parentId) as Array<{ child_id: string; relation: string; metadata: string | null }>;
  return rows.map((r) => ({
    childId: r.child_id,
    parentId,
    relation: r.relation,
    metadata: r.metadata ? (JSON.parse(r.metadata) as Record<string, unknown>) : null,
  }));
}

export function getSessionParent(childId: string): SessionLinkRow | null {
  const row = getDb()
    .prepare('SELECT parent_id, relation, metadata FROM session_links WHERE child_id = ? LIMIT 1')
    .get(childId) as { parent_id: string; relation: string; metadata: string | null } | undefined;
  if (!row) return null;
  return {
    childId,
    parentId: row.parent_id,
    relation: row.relation,
    metadata: row.metadata ? (JSON.parse(row.metadata) as Record<string, unknown>) : null,
  };
}

export interface SessionTreeNode {
  id: string;
  relation: string;
  children: SessionTreeNode[];
}

export function getSessionTree(rootId: string, maxDepth = 1): SessionTreeNode {
  function build(id: string, relation: string, depth: number): SessionTreeNode {
    const children: SessionTreeNode[] =
      depth < maxDepth
        ? getSessionChildren(id).map((c) => build(c.childId, c.relation, depth + 1))
        : [];
    return { id, relation, children };
  }
  return build(rootId, 'root', 0);
}

export interface SessionSubagentSummary {
  v: 1;
  hasSubagents: boolean;
  subagentCount: number;
  subagentIds: string[];
  descendantSubagentCount: number;
  subagentDepth: number;
  rootSessionId: string;
  ancestorSessionIds: string[];
}

function getDirectSubagentChildIds(parentId: string): string[] {
  const out = new Set<string>();
  for (const child of getSessionChildren(parentId)) out.add(child.childId);
  const rows = getDb()
    .prepare('SELECT id FROM sessions WHERE parent_session_id = ? ORDER BY id ASC')
    .all(parentId) as Array<{ id: string }>;
  for (const row of rows) out.add(row.id);
  return [...out];
}

function getParentSessionIdForSummary(childId: string): string | null {
  const link = getSessionParent(childId);
  if (link) return link.parentId;
  return getSession(childId)?.parentSessionId ?? null;
}

export function getSessionSubagentSummary(sessionId: string): SessionSubagentSummary {
  const subagentIds = getDirectSubagentChildIds(sessionId);
  const visitedDescendants = new Set<string>([sessionId]);
  const stack = [...subagentIds];
  let descendantSubagentCount = 0;

  while (stack.length > 0) {
    const id = stack.pop()!;
    if (visitedDescendants.has(id)) continue;
    visitedDescendants.add(id);
    descendantSubagentCount += 1;
    stack.push(...getDirectSubagentChildIds(id));
  }

  const ancestorsFromParent: string[] = [];
  const visitedAncestors = new Set<string>([sessionId]);
  let parentId = getParentSessionIdForSummary(sessionId);
  while (parentId && !visitedAncestors.has(parentId)) {
    visitedAncestors.add(parentId);
    ancestorsFromParent.push(parentId);
    parentId = getParentSessionIdForSummary(parentId);
  }

  const ancestorSessionIds = ancestorsFromParent.reverse();
  return {
    v: 1,
    hasSubagents: subagentIds.length > 0,
    subagentCount: subagentIds.length,
    subagentIds,
    descendantSubagentCount,
    subagentDepth: ancestorSessionIds.length,
    rootSessionId: ancestorSessionIds[0] ?? sessionId,
    ancestorSessionIds,
  };
}

// ---- queries

interface QueryRow {
  id: string;
  name: string;
  predicate: string;
  created_at: number | null;
  last_run_at: number | null;
}

function rowToQuery(r: QueryRow, memberCount?: number): Query {
  const definition = normalizeQueryDefinition(JSON.parse(r.predicate));
  return {
    id: r.id,
    name: r.name,
    filters: definition.filters,
    enrichers: definition.enrichers ?? [],
    createdAt: r.created_at ?? 0,
    lastRunAt: r.last_run_at,
    memberCount,
  };
}

/** SQL fragment that counts matches in the latest finished run for a saved query. */
const LATEST_RUN_MEMBER_COUNT_SQL = `
  (SELECT COUNT(*)
     FROM query_matches qm
     JOIN query_run qr ON qr.id = qm.query_run_id
    WHERE qr.saved_query_id = q.id
      AND qr.finished_at IS NOT NULL
      AND qr.started_at = (
        SELECT MAX(started_at) FROM query_run
         WHERE saved_query_id = q.id
           AND finished_at IS NOT NULL
      ))
`;

export function createQuery(q: Omit<Query, 'memberCount' | 'lastRunAt'>): void {
  const definition: QueryDefinition = { filters: q.filters, enrichers: q.enrichers ?? [] };
  getDb()
    .prepare(
      `
    INSERT INTO queries (id, name, predicate, created_at)
    VALUES (?, ?, ?, ?)
  `,
    )
    .run(q.id, q.name, JSON.stringify(definition), q.createdAt);
}

export function updateQueryDefinition(id: string, definition: QueryDefinition): void {
  getDb()
    .prepare('UPDATE queries SET predicate = ? WHERE id = ?')
    .run(JSON.stringify(definition), id);
}

export function listQueries(): Query[] {
  const db = getDb();
  const rows = db
    .prepare(
      `
    SELECT q.*, ${LATEST_RUN_MEMBER_COUNT_SQL} AS member_count
    FROM queries q ORDER BY q.created_at DESC
  `,
    )
    .all() as (QueryRow & { member_count: number })[];
  return rows.map((r) => rowToQuery(r, r.member_count));
}

export function getQuery(id: string): Query | null {
  const db = getDb();
  const row = db
    .prepare(
      `
    SELECT q.*, ${LATEST_RUN_MEMBER_COUNT_SQL} AS member_count
    FROM queries q WHERE q.id = ?
  `,
    )
    .get(id) as (QueryRow & { member_count: number }) | undefined;
  return row ? rowToQuery(row, row.member_count) : null;
}

export function deleteQuery(id: string): void {
  getDb().prepare('DELETE FROM queries WHERE id = ?').run(id);
}

export interface QueryMatchDetail {
  session: Session;
  addedAt: number | null;
  evidence?: string | null;
}

/** Latest finished run id for a saved query, or null if none has run. */
function latestRunIdForSavedQuery(db: Database.Database, savedQueryId: string): string | null {
  const row = db
    .prepare(
      `SELECT id FROM query_run
        WHERE saved_query_id = ?
          AND finished_at IS NOT NULL
        ORDER BY started_at DESC
        LIMIT 1`,
    )
    .get(savedQueryId) as { id: string } | undefined;
  return row?.id ?? null;
}

export function listQueryMatches(savedQueryId: string): Session[] {
  const db = getDb();
  const runId = latestRunIdForSavedQuery(db, savedQueryId);
  if (!runId) return [];
  const rows = db
    .prepare(
      `
    SELECT s.* FROM sessions s
    INNER JOIN query_matches qm ON qm.session_id = s.id
    WHERE qm.query_run_id = ?
    ORDER BY COALESCE(s.modified_at, 0) DESC
  `,
    )
    .all(runId) as SessionRow[];
  return rows.map(rowToSession);
}

export function listQueryMatchDetails(
  savedQueryId: string,
  opts: { limit?: number; offset?: number } = {},
): QueryMatchDetail[] {
  const db = getDb();
  const runId = latestRunIdForSavedQuery(db, savedQueryId);
  if (!runId) return [];
  const rows = db
    .prepare(
      `
    SELECT
      s.*,
      qm.added_at AS match_added_at,
      qm.evidence AS match_evidence
    FROM sessions s
    INNER JOIN query_matches qm ON qm.session_id = s.id
    WHERE qm.query_run_id = @runId
    ORDER BY COALESCE(s.modified_at, 0) DESC
    LIMIT @limit OFFSET @offset
  `,
    )
    .all({
      runId,
      limit: opts.limit ?? 200,
      offset: opts.offset ?? 0,
    }) as Array<SessionRow & { match_added_at: number | null; match_evidence: string | null }>;
  return rows.map((r) => ({
    session: rowToSession(r),
    addedAt: r.match_added_at,
    evidence: r.match_evidence,
  }));
}

export function countQueryMatches(savedQueryId: string): number {
  const db = getDb();
  const runId = latestRunIdForSavedQuery(db, savedQueryId);
  if (!runId) return 0;
  const row = db
    .prepare('SELECT COUNT(*) AS c FROM query_matches WHERE query_run_id = ?')
    .get(runId) as { c: number };
  return row.c;
}

export function upsertQueryMatch(item: QueryMatch): void {
  getDb()
    .prepare(
      `
    INSERT INTO query_matches (query_run_id, session_id, added_at, evidence)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(query_run_id, session_id) DO UPDATE SET evidence=excluded.evidence
  `,
    )
    .run(item.queryRunId, item.sessionId, item.addedAt, item.evidence ?? null);
}

export function dropQueryMatch(queryRunId: string, sessionId: string): void {
  getDb()
    .prepare('DELETE FROM query_matches WHERE query_run_id = ? AND session_id = ?')
    .run(queryRunId, sessionId);
}

export function markQueryRun(savedQueryId: string, now: number): void {
  getDb().prepare('UPDATE queries SET last_run_at = ? WHERE id = ?').run(now, savedQueryId);
}

export function isQueryMatch(savedQueryId: string, sessionId: string): boolean {
  const db = getDb();
  const runId = latestRunIdForSavedQuery(db, savedQueryId);
  if (!runId) return false;
  const r = db
    .prepare('SELECT 1 AS x FROM query_matches WHERE query_run_id = ? AND session_id = ?')
    .get(runId, sessionId);
  return !!r;
}

export function listAllSessionsForBackfill(): Session[] {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM sessions').all() as SessionRow[];
  return rows.map(rowToSession);
}

// ---- query runs

export interface QueryRunRow {
  id: string;
  savedQueryId: string | null;
  dsl: QueryDefinition;
  startedAt: number;
  finishedAt: number | null;
  matchedCount: number | null;
}

interface RawQueryRunRow {
  id: string;
  saved_query_id: string | null;
  dsl: string;
  started_at: number;
  finished_at: number | null;
  matched_count: number | null;
}

function rowToQueryRun(r: RawQueryRunRow): QueryRunRow {
  let dsl: QueryDefinition;
  try {
    const parsed = JSON.parse(r.dsl) as unknown;
    if (
      parsed &&
      typeof parsed === 'object' &&
      'filters' in (parsed as Record<string, unknown>) &&
      (parsed as { filters?: unknown }).filters != null
    ) {
      dsl = parsed as QueryDefinition;
    } else {
      // System run and synthetic legacy rows may have a placeholder dsl.
      dsl = { filters: { and: [] }, enrichers: [] };
    }
  } catch {
    dsl = { filters: { and: [] }, enrichers: [] };
  }
  return {
    id: r.id,
    savedQueryId: r.saved_query_id,
    dsl,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
    matchedCount: r.matched_count,
  };
}

export interface CreateQueryRunInput {
  savedQueryId: string | null;
  dsl: QueryDefinition;
  startedAt: number;
  /** Optional explicit id (defaults to a new UUID). */
  id?: string;
}

export function createQueryRun(input: CreateQueryRunInput): string {
  const id = input.id ?? randomUUID();
  getDb()
    .prepare(
      `INSERT INTO query_run (id, saved_query_id, dsl, started_at, finished_at, matched_count)
       VALUES (?, ?, ?, ?, NULL, NULL)`,
    )
    .run(id, input.savedQueryId, JSON.stringify(input.dsl), input.startedAt);
  return id;
}

export function finishQueryRun(
  runId: string,
  opts: { finishedAt: number; matchedCount: number },
): void {
  getDb()
    .prepare('UPDATE query_run SET finished_at = ?, matched_count = ? WHERE id = ?')
    .run(opts.finishedAt, opts.matchedCount, runId);
}

export function clearQueryRun(runId: string): void {
  if (runId === SYSTEM_RUN_ID) return;
  getDb().prepare('DELETE FROM query_run WHERE id = ?').run(runId);
}

export function getQueryRun(runId: string): QueryRunRow | null {
  const row = getDb().prepare('SELECT * FROM query_run WHERE id = ?').get(runId) as
    | RawQueryRunRow
    | undefined;
  return row ? rowToQueryRun(row) : null;
}

export interface ListRunsOptions {
  limit?: number;
  offset?: number;
}

export function listQueryRunsForSavedQuery(
  savedQueryId: string,
  opts: ListRunsOptions = {},
): QueryRunRow[] {
  const rows = getDb()
    .prepare(
      `SELECT * FROM query_run
        WHERE saved_query_id = @savedQueryId
        ORDER BY started_at DESC
        LIMIT @limit OFFSET @offset`,
    )
    .all({
      savedQueryId,
      limit: opts.limit ?? 50,
      offset: opts.offset ?? 0,
    }) as RawQueryRunRow[];
  return rows.map(rowToQueryRun);
}

export function listStandaloneRuns(opts: ListRunsOptions = {}): QueryRunRow[] {
  const rows = getDb()
    .prepare(
      `SELECT * FROM query_run
        WHERE saved_query_id IS NULL AND id != @sys
        ORDER BY started_at DESC
        LIMIT @limit OFFSET @offset`,
    )
    .all({
      sys: SYSTEM_RUN_ID,
      limit: opts.limit ?? 50,
      offset: opts.offset ?? 0,
    }) as RawQueryRunRow[];
  return rows.map(rowToQueryRun);
}

export interface PruneOptions {
  perSavedQuery?: number;
  standalone?: number;
}

/**
 * Count-based retention: keep the N most recent runs per saved query, plus the N most
 * recent standalone runs. The system run is exempt.
 */
export function pruneQueryRuns(opts: PruneOptions = {}): { pruned: number } {
  const perSavedQuery = opts.perSavedQuery ?? 10;
  const standalone = opts.standalone ?? 10;
  const db = getDb();

  let pruned = 0;
  const tx = db.transaction(() => {
    // Per-saved-query
    const savedRows = db
      .prepare('SELECT DISTINCT saved_query_id FROM query_run WHERE saved_query_id IS NOT NULL')
      .all() as Array<{ saved_query_id: string }>;
    const pickKeep = db.prepare(
      `SELECT id FROM query_run
        WHERE saved_query_id = ?
        ORDER BY started_at DESC
        LIMIT ?`,
    );
    const deleteByIdNotIn = (savedId: string, keepIds: string[]) => {
      if (keepIds.length === 0) {
        const r = db
          .prepare('DELETE FROM query_run WHERE saved_query_id = ? AND id != ?')
          .run(savedId, SYSTEM_RUN_ID);
        pruned += r.changes;
        return;
      }
      const placeholders = keepIds.map(() => '?').join(',');
      const r = db
        .prepare(
          `DELETE FROM query_run
            WHERE saved_query_id = ?
              AND id != ?
              AND id NOT IN (${placeholders})`,
        )
        .run(savedId, SYSTEM_RUN_ID, ...keepIds);
      pruned += r.changes;
    };
    for (const r of savedRows) {
      const keep = pickKeep.all(r.saved_query_id, perSavedQuery) as Array<{ id: string }>;
      deleteByIdNotIn(
        r.saved_query_id,
        keep.map((k) => k.id),
      );
    }

    // Standalone (saved_query_id IS NULL, excluding system)
    const keepStandalone = (
      db
        .prepare(
          `SELECT id FROM query_run
            WHERE saved_query_id IS NULL AND id != ?
            ORDER BY started_at DESC
            LIMIT ?`,
        )
        .all(SYSTEM_RUN_ID, standalone) as Array<{ id: string }>
    ).map((k) => k.id);
    if (keepStandalone.length === 0) {
      const r = db
        .prepare('DELETE FROM query_run WHERE saved_query_id IS NULL AND id != ?')
        .run(SYSTEM_RUN_ID);
      pruned += r.changes;
    } else {
      const placeholders = keepStandalone.map(() => '?').join(',');
      const r = db
        .prepare(
          `DELETE FROM query_run
            WHERE saved_query_id IS NULL
              AND id != ?
              AND id NOT IN (${placeholders})`,
        )
        .run(SYSTEM_RUN_ID, ...keepStandalone);
      pruned += r.changes;
    }
  });
  tx();
  return { pruned };
}

// ---- enrichments (stored in session_enrich, scoped by query_run_id)

export interface EnrichmentRow {
  version: number;
  value: unknown;
  computedAt: number;
}

export interface NamedEnrichmentRow extends EnrichmentRow {
  name: string;
}

export function upsertEnrichment(
  sessionId: string,
  queryRunId: string,
  name: string,
  version: number,
  value: unknown,
  computedAt: number,
): void {
  getDb()
    .prepare(
      `
    INSERT INTO session_enrich (session_id, query_run_id, name, version, value, computed_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(session_id, query_run_id, name) DO UPDATE SET
      version=excluded.version,
      value=excluded.value,
      computed_at=excluded.computed_at
  `,
    )
    .run(sessionId, queryRunId, name, version, JSON.stringify(value), computedAt);
}

export function getEnrichment(
  sessionId: string,
  queryRunId: string,
  name: string,
): EnrichmentRow | null {
  const row = getDb()
    .prepare(
      'SELECT version, value, computed_at FROM session_enrich WHERE session_id = ? AND query_run_id = ? AND name = ?',
    )
    .get(sessionId, queryRunId, name) as
    | { version: number; value: string; computed_at: number }
    | undefined;
  if (!row) return null;
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(row.value);
  } catch {
    parsed = null;
  }
  return { version: row.version, value: parsed, computedAt: row.computed_at };
}

export function listSessionEnrichments(
  sessionId: string,
  queryRunId?: string,
): NamedEnrichmentRow[] {
  const sql = queryRunId
    ? 'SELECT name, version, value, computed_at FROM session_enrich WHERE session_id = ? AND query_run_id = ? ORDER BY name ASC'
    : 'SELECT name, version, value, computed_at FROM session_enrich WHERE session_id = ? ORDER BY name ASC';
  const rows = (
    queryRunId
      ? getDb().prepare(sql).all(sessionId, queryRunId)
      : getDb().prepare(sql).all(sessionId)
  ) as Array<{ name: string; version: number; value: string; computed_at: number }>;
  return rows.map((row) => {
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(row.value);
    } catch {
      parsed = null;
    }
    return {
      name: row.name,
      version: row.version,
      value: parsed,
      computedAt: row.computed_at,
    };
  });
}

// ---- stats / aggregates

export interface StatsTotals {
  sessions: number;
  sessionsLast7d: number;
  distinctPwds: number;
  distinctAgents: number;
  queries: number;
}

export function getStatsTotals(now: number = Date.now()): StatsTotals {
  const db = getDb();
  const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
  const sessions = (db.prepare('SELECT COUNT(*) AS c FROM sessions').get() as { c: number }).c;
  const sessionsLast7d = (
    db
      .prepare(
        'SELECT COUNT(*) AS c FROM sessions WHERE modified_at IS NOT NULL AND modified_at >= ?',
      )
      .get(sevenDaysAgo) as { c: number }
  ).c;
  const distinctPwds = (
    db
      .prepare("SELECT COUNT(DISTINCT COALESCE(NULLIF(project_key, ''), pwd)) AS c FROM sessions")
      .get() as { c: number }
  ).c;
  const distinctAgents = (
    db.prepare('SELECT COUNT(DISTINCT agent) AS c FROM sessions').get() as { c: number }
  ).c;
  const queries = (db.prepare('SELECT COUNT(*) AS c FROM queries').get() as { c: number }).c;
  return { sessions, sessionsLast7d, distinctPwds, distinctAgents, queries };
}

export function getMaxLastIndexedAt(): number | null {
  const row = getDb().prepare('SELECT MAX(last_indexed_at) AS m FROM sessions').get() as {
    m: number | null;
  };
  return row.m;
}

export function getSessionsPerDay(days: number): Array<{ date: string; count: number }> {
  const db = getDb();
  const rows = db
    .prepare(
      `
    SELECT date(modified_at / 1000, 'unixepoch', 'localtime') AS d, COUNT(*) AS c
      FROM sessions
     WHERE modified_at IS NOT NULL
     GROUP BY d
     ORDER BY d DESC
     LIMIT ?
  `,
    )
    .all(days) as Array<{ d: string; c: number }>;
  return rows.map((r) => ({ date: r.d, count: r.c })).reverse();
}

export function getTopPwds(limit: number): Array<{ pwd: string; count: number }> {
  const rows = getDb()
    .prepare(
      `
    SELECT COALESCE(NULLIF(project_key, ''), pwd) AS pwd, COUNT(*) AS c FROM sessions
     GROUP BY COALESCE(NULLIF(project_key, ''), pwd)
     ORDER BY c DESC LIMIT ?
  `,
    )
    .all(limit) as Array<{ pwd: string; c: number }>;
  return rows.map((r) => ({ pwd: r.pwd, count: r.c }));
}

export function getTopQueries(
  limit: number,
): Array<{ id: string; name: string; memberCount: number }> {
  const rows = getDb()
    .prepare(
      `
    SELECT q.id, q.name, ${LATEST_RUN_MEMBER_COUNT_SQL} AS member_count
      FROM queries q
     ORDER BY member_count DESC
     LIMIT ?
  `,
    )
    .all(limit) as Array<{ id: string; name: string; member_count: number }>;
  return rows.map((r) => ({ id: r.id, name: r.name, memberCount: r.member_count }));
}

export function listRecentSessions(limit: number): Session[] {
  const rows = getDb()
    .prepare(
      `
    SELECT * FROM sessions ORDER BY COALESCE(modified_at, 0) DESC LIMIT ?
  `,
    )
    .all(limit) as SessionRow[];
  return rows.map(rowToSession);
}

export interface InsightRunRow {
  sessionId: string;
  insightName: string;
  runId: string;
  version: number;
  answer: string | null;
  computedAt: number;
  session: Session;
}

export function listInsightRuns(limit = 200): InsightRunRow[] {
  const rows = getDb()
    .prepare(
      `
    SELECT s.*, se.value AS value, se.computed_at AS computed_at
      FROM session_enrich se
      JOIN sessions s ON s.id = se.session_id
     WHERE se.name = 'insight_run'
       AND se.query_run_id = ?
       AND se.value IS NOT NULL
       AND se.value != 'null'
     ORDER BY COALESCE(s.modified_at, se.computed_at) DESC
     LIMIT ?
  `,
    )
    .all(SYSTEM_RUN_ID, limit) as Array<SessionRow & { value: string; computed_at: number }>;

  const out: InsightRunRow[] = [];
  for (const r of rows) {
    let parsedRaw: unknown = null;
    try {
      parsedRaw = JSON.parse(r.value);
    } catch {
      parsedRaw = null;
    }
    if (!parsedRaw || typeof parsedRaw !== 'object') continue;
    const parsed = parsedRaw as Record<string, unknown>;
    if (typeof parsed.name !== 'string' || !parsed.name) continue;
    out.push({
      sessionId: r.id,
      insightName: parsed.name,
      runId: typeof parsed.runId === 'string' ? parsed.runId : '',
      version: typeof parsed.version === 'number' ? parsed.version : 1,
      answer: typeof parsed.answer === 'string' ? parsed.answer : null,
      computedAt: r.computed_at,
      session: rowToSession(r),
    });
  }
  return out;
}

export function getTopTools(limit: number): Array<{ tool: string; count: number }> {
  const rows = getDb()
    .prepare(
      `
    SELECT je.key AS tool, SUM(CAST(je.value AS INTEGER)) AS c
      FROM session_enrich se, json_each(se.value) je
     WHERE se.name = 'tool_counts'
       AND se.query_run_id = ?
     GROUP BY je.key
     ORDER BY c DESC
     LIMIT ?
  `,
    )
    .all(SYSTEM_RUN_ID, limit) as Array<{ tool: string; c: number }>;
  return rows.map((r) => ({ tool: r.tool, count: r.c }));
}

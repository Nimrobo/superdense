import Database from 'better-sqlite3';
import { DB_PATH, ensureRoad42Dirs } from './paths.js';
import type { Predicate } from './query/types.js';
import type { Query, QueryMatch, Session } from './types.js';
import { resolveProjectKey } from './util/project-key.js';

let dbInstance: Database.Database | null = null;

export function getDb(): Database.Database {
  if (dbInstance) return dbInstance;
  ensureRoad42Dirs();
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
    try { dbInstance.close(); } catch { /* ignore */ }
  }
  dbInstance = null;
}

const SCHEMA_VERSION = 2;

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

    CREATE TABLE IF NOT EXISTS query_matches (
      query_id   TEXT NOT NULL REFERENCES queries(id) ON DELETE CASCADE,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      added_at   INTEGER,
      evidence   TEXT,
      PRIMARY KEY (query_id, session_id)
    );
    CREATE INDEX IF NOT EXISTS idx_query_matches_session ON query_matches(session_id);

    CREATE TABLE IF NOT EXISTS query_enrich (
      session_id  TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      name        TEXT NOT NULL,
      version     INTEGER NOT NULL,
      value       TEXT NOT NULL,
      computed_at INTEGER NOT NULL,
      PRIMARY KEY (session_id, name)
    );
    CREATE INDEX IF NOT EXISTS idx_qenrich_name ON query_enrich(name);
  `);

  const currentVersion = (db.pragma('user_version', { simple: true }) as number) ?? 0;
  if (currentVersion < 1) {
    runDataMigrationV1(db);
    db.pragma('user_version = 1');
  }
  if (currentVersion < 2) {
    runDataMigrationV2(db);
    db.pragma('user_version = 2');
  }
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
        const predicate: Predicate = { plugin: { name: g.plugin_name, config: cfg } };
        insertQuery.run(g.id, g.name, JSON.stringify(predicate), g.created_at, g.last_run_at);
      }
    }

    if (hasOldItems) {
      db.exec(`
        INSERT OR IGNORE INTO query_matches (query_id, session_id, added_at, evidence)
        SELECT group_id, session_id, added_at, evidence FROM group_items;
      `);
    }

    if (hasOldEnrich) {
      db.exec(`
        INSERT OR IGNORE INTO query_enrich (session_id, name, version, value, computed_at)
        SELECT session_id, name, version, value, computed_at FROM session_enrichments;
      `);
    }

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

    const rows = db.prepare('SELECT id, pwd FROM sessions').all() as Array<{ id: string; pwd: string }>;
    const update = db.prepare('UPDATE sessions SET project_key = ? WHERE id = ?');
    for (const row of rows) update.run(resolveProjectKey(row.pwd), row.id);
  });
  migrateTx();
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
    fileMtime: r.file_mtime,
    lastIndexedAt: r.last_indexed_at,
  };
}

export function upsertSession(s: Session): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO sessions (
      id, agent, session_id, log_path, pwd, project_key, first_prompt, summary,
      message_count, git_branch, created_at, modified_at, is_sidechain,
      file_mtime, last_indexed_at
    ) VALUES (
      @id, @agent, @sessionId, @logPath, @pwd, @projectKey, @firstPrompt, @summary,
      @messageCount, @gitBranch, @createdAt, @modifiedAt, @isSidechain,
      @fileMtime, @lastIndexedAt
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
      file_mtime=excluded.file_mtime,
      last_indexed_at=excluded.last_indexed_at
  `).run({
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
}

export function listSessions(filter: SessionFilter = {}): Session[] {
  const db = getDb();
  const where: string[] = [];
  const params: Record<string, unknown> = {};
  if (filter.agent) { where.push('agent = @agent'); params.agent = filter.agent; }
  if (filter.pwd) { where.push('pwd = @pwd'); params.pwd = filter.pwd; }
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
  return db.prepare(sql).all(params).map((r: unknown) => rowToSession(r as SessionRow));
}

export function countSessions(filter: SessionFilter = {}): number {
  const db = getDb();
  const where: string[] = [];
  const params: Record<string, unknown> = {};
  if (filter.agent) { where.push('agent = @agent'); params.agent = filter.agent; }
  if (filter.pwd) { where.push('pwd = @pwd'); params.pwd = filter.pwd; }
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
  const rows = db.prepare(`
    SELECT * FROM sessions
    WHERE last_indexed_at IS NULL OR (file_mtime IS NOT NULL AND file_mtime > last_indexed_at)
  `).all() as SessionRow[];
  return rows.map(rowToSession);
}

export function markIndexed(sessionId: string, now: number): void {
  getDb().prepare('UPDATE sessions SET last_indexed_at = ? WHERE id = ?').run(now, sessionId);
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
  return {
    id: r.id,
    name: r.name,
    predicate: JSON.parse(r.predicate) as Predicate,
    createdAt: r.created_at ?? 0,
    lastRunAt: r.last_run_at,
    memberCount,
  };
}

export function createQuery(q: Omit<Query, 'memberCount' | 'lastRunAt'>): void {
  getDb().prepare(`
    INSERT INTO queries (id, name, predicate, created_at)
    VALUES (?, ?, ?, ?)
  `).run(q.id, q.name, JSON.stringify(q.predicate), q.createdAt);
}

export function updateQueryPredicate(id: string, predicate: Predicate): void {
  getDb().prepare('UPDATE queries SET predicate = ? WHERE id = ?').run(JSON.stringify(predicate), id);
}

export function listQueries(): Query[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT q.*, (SELECT COUNT(*) FROM query_matches qm WHERE qm.query_id = q.id) AS member_count
    FROM queries q ORDER BY q.created_at DESC
  `).all() as (QueryRow & { member_count: number })[];
  return rows.map((r) => rowToQuery(r, r.member_count));
}

export function getQuery(id: string): Query | null {
  const db = getDb();
  const row = db.prepare(`
    SELECT q.*, (SELECT COUNT(*) FROM query_matches qm WHERE qm.query_id = q.id) AS member_count
    FROM queries q WHERE q.id = ?
  `).get(id) as (QueryRow & { member_count: number }) | undefined;
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

export function listQueryMatches(queryId: string): Session[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT s.* FROM sessions s
    INNER JOIN query_matches qm ON qm.session_id = s.id
    WHERE qm.query_id = ?
    ORDER BY COALESCE(s.modified_at, 0) DESC
  `).all(queryId) as SessionRow[];
  return rows.map(rowToSession);
}

export function listQueryMatchDetails(
  queryId: string,
  opts: { limit?: number; offset?: number } = {},
): QueryMatchDetail[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT
      s.*,
      qm.added_at AS match_added_at,
      qm.evidence AS match_evidence
    FROM sessions s
    INNER JOIN query_matches qm ON qm.session_id = s.id
    WHERE qm.query_id = @queryId
    ORDER BY COALESCE(s.modified_at, 0) DESC
    LIMIT @limit OFFSET @offset
  `).all({
    queryId,
    limit: opts.limit ?? 200,
    offset: opts.offset ?? 0,
  }) as Array<SessionRow & { match_added_at: number | null; match_evidence: string | null }>;
  return rows.map((r) => ({
    session: rowToSession(r),
    addedAt: r.match_added_at,
    evidence: r.match_evidence,
  }));
}

export function countQueryMatches(queryId: string): number {
  const row = getDb()
    .prepare('SELECT COUNT(*) AS c FROM query_matches WHERE query_id = ?')
    .get(queryId) as { c: number };
  return row.c;
}

export function upsertQueryMatch(item: QueryMatch): void {
  getDb().prepare(`
    INSERT INTO query_matches (query_id, session_id, added_at, evidence)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(query_id, session_id) DO UPDATE SET evidence=excluded.evidence
  `).run(item.queryId, item.sessionId, item.addedAt, item.evidence ?? null);
}

export function dropQueryMatch(queryId: string, sessionId: string): void {
  getDb().prepare('DELETE FROM query_matches WHERE query_id = ? AND session_id = ?').run(queryId, sessionId);
}

export function clearQueryMatches(queryId: string): void {
  getDb().prepare('DELETE FROM query_matches WHERE query_id = ?').run(queryId);
}

export function markQueryRun(queryId: string, now: number): void {
  getDb().prepare('UPDATE queries SET last_run_at = ? WHERE id = ?').run(now, queryId);
}

export function isQueryMatch(queryId: string, sessionId: string): boolean {
  const db = getDb();
  const r = db.prepare('SELECT 1 AS x FROM query_matches WHERE query_id = ? AND session_id = ?').get(queryId, sessionId);
  return !!r;
}

export function listAllSessionsForBackfill(): Session[] {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM sessions').all() as SessionRow[];
  return rows.map(rowToSession);
}

// ---- enrichments (stored in query_enrich)

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
  name: string,
  version: number,
  value: unknown,
  computedAt: number,
): void {
  getDb().prepare(`
    INSERT INTO query_enrich (session_id, name, version, value, computed_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(session_id, name) DO UPDATE SET
      version=excluded.version,
      value=excluded.value,
      computed_at=excluded.computed_at
  `).run(sessionId, name, version, JSON.stringify(value), computedAt);
}

export function getEnrichment(sessionId: string, name: string): EnrichmentRow | null {
  const row = getDb()
    .prepare('SELECT version, value, computed_at FROM query_enrich WHERE session_id = ? AND name = ?')
    .get(sessionId, name) as { version: number; value: string; computed_at: number } | undefined;
  if (!row) return null;
  let parsed: unknown = null;
  try { parsed = JSON.parse(row.value); } catch { parsed = null; }
  return { version: row.version, value: parsed, computedAt: row.computed_at };
}

export function listSessionEnrichments(sessionId: string): NamedEnrichmentRow[] {
  const rows = getDb()
    .prepare('SELECT name, version, value, computed_at FROM query_enrich WHERE session_id = ? ORDER BY name ASC')
    .all(sessionId) as Array<{ name: string; version: number; value: string; computed_at: number }>;
  return rows.map((row) => {
    let parsed: unknown = null;
    try { parsed = JSON.parse(row.value); } catch { parsed = null; }
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
  const sessionsLast7d = (db
    .prepare('SELECT COUNT(*) AS c FROM sessions WHERE modified_at IS NOT NULL AND modified_at >= ?')
    .get(sevenDaysAgo) as { c: number }).c;
  const distinctPwds = (db
    .prepare("SELECT COUNT(DISTINCT COALESCE(NULLIF(project_key, ''), pwd)) AS c FROM sessions")
    .get() as { c: number }).c;
  const distinctAgents = (db.prepare('SELECT COUNT(DISTINCT agent) AS c FROM sessions').get() as { c: number }).c;
  const queries = (db.prepare('SELECT COUNT(*) AS c FROM queries').get() as { c: number }).c;
  return { sessions, sessionsLast7d, distinctPwds, distinctAgents, queries };
}

export function getMaxLastIndexedAt(): number | null {
  const row = getDb()
    .prepare('SELECT MAX(last_indexed_at) AS m FROM sessions')
    .get() as { m: number | null };
  return row.m;
}

export function getSessionsPerDay(days: number): Array<{ date: string; count: number }> {
  const db = getDb();
  const rows = db.prepare(`
    SELECT date(modified_at / 1000, 'unixepoch') AS d, COUNT(*) AS c
      FROM sessions
     WHERE modified_at IS NOT NULL
     GROUP BY d
     ORDER BY d DESC
     LIMIT ?
  `).all(days) as Array<{ d: string; c: number }>;
  return rows.map((r) => ({ date: r.d, count: r.c })).reverse();
}

export function getTopPwds(limit: number): Array<{ pwd: string; count: number }> {
  const rows = getDb().prepare(`
    SELECT COALESCE(NULLIF(project_key, ''), pwd) AS pwd, COUNT(*) AS c FROM sessions
     GROUP BY COALESCE(NULLIF(project_key, ''), pwd)
     ORDER BY c DESC LIMIT ?
  `).all(limit) as Array<{ pwd: string; c: number }>;
  return rows.map((r) => ({ pwd: r.pwd, count: r.c }));
}

export function getTopQueries(limit: number): Array<{ id: string; name: string; memberCount: number }> {
  const rows = getDb().prepare(`
    SELECT q.id, q.name,
           (SELECT COUNT(*) FROM query_matches qm WHERE qm.query_id = q.id) AS member_count
      FROM queries q
     ORDER BY member_count DESC
     LIMIT ?
  `).all(limit) as Array<{ id: string; name: string; member_count: number }>;
  return rows.map((r) => ({ id: r.id, name: r.name, memberCount: r.member_count }));
}

export function listRecentSessions(limit: number): Session[] {
  const rows = getDb().prepare(`
    SELECT * FROM sessions ORDER BY COALESCE(modified_at, 0) DESC LIMIT ?
  `).all(limit) as SessionRow[];
  return rows.map(rowToSession);
}

export function getTopTools(limit: number): Array<{ tool: string; count: number }> {
  const rows = getDb().prepare(`
    SELECT je.key AS tool, SUM(CAST(je.value AS INTEGER)) AS c
      FROM query_enrich qe, json_each(qe.value) je
     WHERE qe.name = 'tool_counts'
     GROUP BY je.key
     ORDER BY c DESC
     LIMIT ?
  `).all(limit) as Array<{ tool: string; c: number }>;
  return rows.map((r) => ({ tool: r.tool, count: r.c }));
}

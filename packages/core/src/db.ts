import Database from 'better-sqlite3';
import { DB_PATH, ensureRoad42Dirs } from './paths.js';
import type { Group, GroupItem, Session } from './types.js';

let dbInstance: Database.Database | null = null;

export function getDb(): Database.Database {
  if (dbInstance) return dbInstance;
  ensureRoad42Dirs();
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  migrate(db);
  dbInstance = db;
  return db;
}

function migrate(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id              TEXT PRIMARY KEY,
      agent           TEXT NOT NULL,
      session_id      TEXT NOT NULL,
      log_path        TEXT NOT NULL,
      pwd             TEXT NOT NULL,
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

    CREATE TABLE IF NOT EXISTS groups (
      id            TEXT PRIMARY KEY,
      name          TEXT NOT NULL,
      plugin_name   TEXT NOT NULL,
      plugin_config TEXT,
      created_at    INTEGER,
      last_run_at   INTEGER
    );

    CREATE TABLE IF NOT EXISTS group_items (
      group_id    TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
      session_id  TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      added_at    INTEGER,
      evidence    TEXT,
      PRIMARY KEY (group_id, session_id)
    );
    CREATE INDEX IF NOT EXISTS idx_group_items_session ON group_items(session_id);

    CREATE TABLE IF NOT EXISTS session_enrichments (
      session_id  TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      name        TEXT NOT NULL,
      version     INTEGER NOT NULL,
      value       TEXT NOT NULL,
      computed_at INTEGER NOT NULL,
      PRIMARY KEY (session_id, name)
    );
    CREATE INDEX IF NOT EXISTS idx_enrich_name ON session_enrichments(name);
  `);
}

interface SessionRow {
  id: string;
  agent: string;
  session_id: string;
  log_path: string;
  pwd: string;
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
      id, agent, session_id, log_path, pwd, first_prompt, summary,
      message_count, git_branch, created_at, modified_at, is_sidechain,
      file_mtime, last_indexed_at
    ) VALUES (
      @id, @agent, @sessionId, @logPath, @pwd, @firstPrompt, @summary,
      @messageCount, @gitBranch, @createdAt, @modifiedAt, @isSidechain,
      @fileMtime, @lastIndexedAt
    )
    ON CONFLICT(id) DO UPDATE SET
      agent=excluded.agent,
      session_id=excluded.session_id,
      log_path=excluded.log_path,
      pwd=excluded.pwd,
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
  return db.prepare(sql).all(params).map((r) => rowToSession(r as SessionRow));
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

// ---- groups

interface GroupRow {
  id: string;
  name: string;
  plugin_name: string;
  plugin_config: string | null;
  created_at: number | null;
  last_run_at: number | null;
}

function rowToGroup(r: GroupRow, memberCount?: number): Group {
  return {
    id: r.id,
    name: r.name,
    pluginName: r.plugin_name,
    pluginConfig: r.plugin_config ? JSON.parse(r.plugin_config) : {},
    createdAt: r.created_at ?? 0,
    lastRunAt: r.last_run_at,
    memberCount,
  };
}

export function createGroup(g: Omit<Group, 'memberCount' | 'lastRunAt'>): void {
  getDb().prepare(`
    INSERT INTO groups (id, name, plugin_name, plugin_config, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(g.id, g.name, g.pluginName, JSON.stringify(g.pluginConfig ?? {}), g.createdAt);
}

export function listGroups(): Group[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT g.*, (SELECT COUNT(*) FROM group_items gi WHERE gi.group_id = g.id) AS member_count
    FROM groups g ORDER BY g.created_at DESC
  `).all() as (GroupRow & { member_count: number })[];
  return rows.map((r) => rowToGroup(r, r.member_count));
}

export function getGroup(id: string): Group | null {
  const db = getDb();
  const row = db.prepare(`
    SELECT g.*, (SELECT COUNT(*) FROM group_items gi WHERE gi.group_id = g.id) AS member_count
    FROM groups g WHERE g.id = ?
  `).get(id) as (GroupRow & { member_count: number }) | undefined;
  return row ? rowToGroup(row, row.member_count) : null;
}

export function deleteGroup(id: string): void {
  getDb().prepare('DELETE FROM groups WHERE id = ?').run(id);
}

export function listGroupMembers(groupId: string): Session[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT s.* FROM sessions s
    INNER JOIN group_items gi ON gi.session_id = s.id
    WHERE gi.group_id = ?
    ORDER BY COALESCE(s.modified_at, 0) DESC
  `).all(groupId) as SessionRow[];
  return rows.map(rowToSession);
}

export function upsertGroupItem(item: GroupItem): void {
  getDb().prepare(`
    INSERT INTO group_items (group_id, session_id, added_at, evidence)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(group_id, session_id) DO UPDATE SET evidence=excluded.evidence
  `).run(item.groupId, item.sessionId, item.addedAt, item.evidence ?? null);
}

export function dropGroupItem(groupId: string, sessionId: string): void {
  getDb().prepare('DELETE FROM group_items WHERE group_id = ? AND session_id = ?').run(groupId, sessionId);
}

export function markGroupRun(groupId: string, now: number): void {
  getDb().prepare('UPDATE groups SET last_run_at = ? WHERE id = ?').run(now, groupId);
}

export function isGroupMember(groupId: string, sessionId: string): boolean {
  const db = getDb();
  const r = db.prepare('SELECT 1 AS x FROM group_items WHERE group_id = ? AND session_id = ?').get(groupId, sessionId);
  return !!r;
}

export function listAllSessionsForBackfill(): Session[] {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM sessions').all() as SessionRow[];
  return rows.map(rowToSession);
}

// ---- enrichments

export interface EnrichmentRow {
  version: number;
  value: unknown;
  computedAt: number;
}

export function upsertEnrichment(
  sessionId: string,
  name: string,
  version: number,
  value: unknown,
  computedAt: number,
): void {
  getDb().prepare(`
    INSERT INTO session_enrichments (session_id, name, version, value, computed_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(session_id, name) DO UPDATE SET
      version=excluded.version,
      value=excluded.value,
      computed_at=excluded.computed_at
  `).run(sessionId, name, version, JSON.stringify(value), computedAt);
}

export function getEnrichment(sessionId: string, name: string): EnrichmentRow | null {
  const row = getDb()
    .prepare('SELECT version, value, computed_at FROM session_enrichments WHERE session_id = ? AND name = ?')
    .get(sessionId, name) as { version: number; value: string; computed_at: number } | undefined;
  if (!row) return null;
  let parsed: unknown = null;
  try { parsed = JSON.parse(row.value); } catch { parsed = null; }
  return { version: row.version, value: parsed, computedAt: row.computed_at };
}

// ---- stats / aggregates

export interface StatsTotals {
  sessions: number;
  sessionsLast7d: number;
  distinctPwds: number;
  distinctAgents: number;
  groups: number;
}

export function getStatsTotals(now: number = Date.now()): StatsTotals {
  const db = getDb();
  const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
  const sessions = (db.prepare('SELECT COUNT(*) AS c FROM sessions').get() as { c: number }).c;
  const sessionsLast7d = (db
    .prepare('SELECT COUNT(*) AS c FROM sessions WHERE modified_at IS NOT NULL AND modified_at >= ?')
    .get(sevenDaysAgo) as { c: number }).c;
  const distinctPwds = (db.prepare('SELECT COUNT(DISTINCT pwd) AS c FROM sessions').get() as { c: number }).c;
  const distinctAgents = (db.prepare('SELECT COUNT(DISTINCT agent) AS c FROM sessions').get() as { c: number }).c;
  const groups = (db.prepare('SELECT COUNT(*) AS c FROM groups').get() as { c: number }).c;
  return { sessions, sessionsLast7d, distinctPwds, distinctAgents, groups };
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
    SELECT pwd, COUNT(*) AS c FROM sessions
     GROUP BY pwd ORDER BY c DESC LIMIT ?
  `).all(limit) as Array<{ pwd: string; c: number }>;
  return rows.map((r) => ({ pwd: r.pwd, count: r.c }));
}

export function getTopGroups(limit: number): Array<{ id: string; name: string; memberCount: number }> {
  const rows = getDb().prepare(`
    SELECT g.id, g.name,
           (SELECT COUNT(*) FROM group_items gi WHERE gi.group_id = g.id) AS member_count
      FROM groups g
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
      FROM session_enrichments se, json_each(se.value) je
     WHERE se.name = 'tool_counts'
     GROUP BY je.key
     ORDER BY c DESC
     LIMIT ?
  `).all(limit) as Array<{ tool: string; c: number }>;
  return rows.map((r) => ({ tool: r.tool, count: r.c }));
}

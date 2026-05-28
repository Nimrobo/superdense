import { SYSTEM_RUN_ID, getDb } from '../db.js';
import { rowToSession, type SessionRow } from '../session-row.js';
import type { Session } from '../types.js';

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
  const sessions = (
    db.prepare('SELECT COUNT(*) AS c FROM sessions WHERE is_subagent = 0').get() as { c: number }
  ).c;
  const sessionsLast7d = (
    db
      .prepare(
        'SELECT COUNT(*) AS c FROM sessions WHERE is_subagent = 0 AND modified_at IS NOT NULL AND modified_at >= ?',
      )
      .get(sevenDaysAgo) as { c: number }
  ).c;
  const distinctPwds = (
    db
      .prepare(
        "SELECT COUNT(DISTINCT COALESCE(NULLIF(project_key, ''), pwd)) AS c FROM sessions WHERE is_subagent = 0",
      )
      .get() as { c: number }
  ).c;
  const distinctAgents = (
    db.prepare('SELECT COUNT(DISTINCT agent) AS c FROM sessions WHERE is_subagent = 0').get() as {
      c: number;
    }
  ).c;
  const queries = (db.prepare('SELECT COUNT(*) AS c FROM queries').get() as { c: number }).c;
  return { sessions, sessionsLast7d, distinctPwds, distinctAgents, queries };
}

export function getMaxLastIndexedAt(): number | null {
  const row = getDb()
    .prepare('SELECT MAX(last_indexed_at) AS m FROM sessions WHERE is_subagent = 0')
    .get() as {
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
     WHERE is_subagent = 0
       AND modified_at IS NOT NULL
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
     WHERE is_subagent = 0
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
    SELECT * FROM sessions
     WHERE is_subagent = 0
     ORDER BY COALESCE(modified_at, 0) DESC LIMIT ?
  `,
    )
    .all(limit) as SessionRow[];
  return rows.map(rowToSession);
}

export function getTopTools(limit: number): Array<{ tool: string; count: number }> {
  const rows = getDb()
    .prepare(
      `
    SELECT je.key AS tool, SUM(CAST(je.value AS INTEGER)) AS c
      FROM session_enrich se
      JOIN sessions s ON s.id = se.session_id,
           json_each(se.value) je
     WHERE se.name = 'tool_counts'
       AND se.query_run_id = ?
       AND s.is_subagent = 0
     GROUP BY je.key
     ORDER BY c DESC
     LIMIT ?
  `,
    )
    .all(SYSTEM_RUN_ID, limit) as Array<{ tool: string; c: number }>;
  return rows.map((r) => ({ tool: r.tool, count: r.c }));
}

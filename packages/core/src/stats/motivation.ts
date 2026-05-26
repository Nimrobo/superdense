import { getDb } from '../db.js';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface HeaderTotals {
  sessions: number;
  distinctPwds: number;
  activeDays: number;
  distinctAgents: number;
}

export interface Streaks {
  current: number;
  longest: number;
  longestRange: { start: string; end: string } | null;
}

export interface ContributionDay {
  date: string;
  count: number;
}

export interface WindowMetrics {
  sessions: number;
  projects: number;
  activeDays: number;
  avgPerActiveDay: number;
  adapterMix: Array<{ agent: string; count: number }>;
  topClis: Array<{ cli: string; count: number }>;
  activeProjects: Array<{ pwd: string; count: number; activeDays: number; lastActiveAt: number }>;
  repeatedReturnProjects: Array<{
    pwd: string;
    activeDays: number;
    sessions: number;
    lastActiveAt: number;
  }>;
}

export interface WindowBundle {
  days: number;
  window: WindowMetrics;
}

function ymd(ms: number): string {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

function localDayStart(ms: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function addDays(ms: number, n: number): number {
  const d = new Date(ms);
  d.setDate(d.getDate() + n);
  return d.getTime();
}

export function getHeaderTotals(): HeaderTotals {
  const db = getDb();
  const sessions = (db.prepare('SELECT COUNT(*) AS c FROM sessions').get() as { c: number }).c;
  const distinctPwds = (
    db
      .prepare("SELECT COUNT(DISTINCT COALESCE(NULLIF(project_key, ''), pwd)) AS c FROM sessions")
      .get() as { c: number }
  ).c;
  const activeDays = (
    db
      .prepare(
        `
    SELECT COUNT(DISTINCT date(modified_at / 1000, 'unixepoch', 'localtime')) AS c
      FROM sessions
     WHERE modified_at IS NOT NULL
  `,
      )
      .get() as { c: number }
  ).c;
  const distinctAgents = (
    db.prepare('SELECT COUNT(DISTINCT agent) AS c FROM sessions').get() as { c: number }
  ).c;
  return { sessions, distinctPwds, activeDays, distinctAgents };
}

/**
 * Compute current + longest streak in consecutive days of activity, using
 * local-time day buckets. Current streak counts a chain ending today OR
 * yesterday (so a day with no activity yet doesn't break the streak until
 * tomorrow).
 */
export function getStreaks(now: number = Date.now()): Streaks {
  const rows = getDb()
    .prepare(
      `
      SELECT DISTINCT date(modified_at / 1000, 'unixepoch', 'localtime') AS d
        FROM sessions
       WHERE modified_at IS NOT NULL
       ORDER BY d ASC
    `,
    )
    .all() as Array<{ d: string }>;
  if (rows.length === 0) return { current: 0, longest: 0, longestRange: null };

  const days = rows.map((r) => r.d);
  // Day strings are stable YYYY-MM-DD identifiers; parse as UTC midnight just
  // to get a comparable timestamp. The +1 day check is in UTC, which works
  // regardless of how the strings were originally bucketed.
  let longest = 1;
  let longestEnd = days[0]!;
  let longestStart = days[0]!;
  let runLen = 1;
  let runStart = days[0]!;
  for (let i = 1; i < days.length; i++) {
    const prev = new Date(`${days[i - 1]}T00:00:00Z`).getTime();
    const cur = new Date(`${days[i]}T00:00:00Z`).getTime();
    if (cur - prev === DAY_MS) {
      runLen++;
    } else {
      runLen = 1;
      runStart = days[i]!;
    }
    if (runLen > longest) {
      longest = runLen;
      longestEnd = days[i]!;
      longestStart = runStart;
    }
  }

  // Current streak: walk back from today (local).
  const today = ymd(now);
  const yesterday = ymd(addDays(now, -1));
  const lastDay = days[days.length - 1]!;
  let current = 0;
  if (lastDay === today || lastDay === yesterday) {
    current = 1;
    const set = new Set(days);
    // Step back one local calendar day at a time (DST-safe via setDate).
    let cursorMs = new Date(`${lastDay}T12:00:00`).getTime(); // noon local avoids DST cliffs
    while (true) {
      cursorMs = addDays(cursorMs, -1);
      if (set.has(ymd(cursorMs))) current++;
      else break;
    }
  }

  return {
    current,
    longest,
    longestRange: { start: longestStart, end: longestEnd },
  };
}

/**
 * Session-count series, zero-filled, ending today (local time).
 */
export function getContributions(now: number = Date.now(), days = 366): ContributionDay[] {
  const clampedDays = Math.max(1, Math.min(366, Math.floor(days)));
  const start = localDayStart(now) - (clampedDays - 1) * DAY_MS;
  const rows = getDb()
    .prepare(
      `
      SELECT date(modified_at / 1000, 'unixepoch', 'localtime') AS d, COUNT(*) AS c
        FROM sessions
       WHERE modified_at IS NOT NULL
         AND modified_at >= ?
       GROUP BY d
    `,
    )
    .all(start - DAY_MS) as Array<{ d: string; c: number }>;
  const map = new Map<string, number>();
  for (const r of rows) map.set(r.d, r.c);

  const out: ContributionDay[] = [];
  // Anchor on today's local day; walk back day-by-day (DST-safe).
  const todayMid = localDayStart(now);
  for (let i = clampedDays - 1; i >= 0; i--) {
    const ms = addDays(todayMid, -i);
    const key = ymd(ms);
    out.push({ date: key, count: map.get(key) ?? 0 });
  }
  return out;
}

function computeWindowMetrics(
  db: ReturnType<typeof getDb>,
  startMs: number,
  endMs: number,
): WindowMetrics {
  const sessions = (
    db
      .prepare(
        `SELECT COUNT(*) AS c FROM sessions WHERE modified_at IS NOT NULL AND modified_at >= ? AND modified_at < ?`,
      )
      .get(startMs, endMs) as { c: number }
  ).c;

  const projects = (
    db
      .prepare(
        `
      SELECT COUNT(DISTINCT COALESCE(NULLIF(project_key, ''), pwd)) AS c
        FROM sessions
       WHERE modified_at IS NOT NULL AND modified_at >= ? AND modified_at < ?
    `,
      )
      .get(startMs, endMs) as { c: number }
  ).c;

  const activeDays = (
    db
      .prepare(
        `
      SELECT COUNT(DISTINCT date(modified_at / 1000, 'unixepoch', 'localtime')) AS c
        FROM sessions
       WHERE modified_at IS NOT NULL AND modified_at >= ? AND modified_at < ?
    `,
      )
      .get(startMs, endMs) as { c: number }
  ).c;

  const adapterMixRows = db
    .prepare(
      `
      SELECT agent, COUNT(*) AS c
        FROM sessions
       WHERE modified_at IS NOT NULL AND modified_at >= ? AND modified_at < ?
       GROUP BY agent
       ORDER BY c DESC
    `,
    )
    .all(startMs, endMs) as Array<{ agent: string; c: number }>;
  const adapterMix = adapterMixRows.map((r) => ({ agent: r.agent, count: r.c }));

  const topCliRows = db
    .prepare(
      `
      SELECT je.key AS cli, SUM(CAST(je.value AS INTEGER)) AS c
        FROM sessions s
        INNER JOIN query_enrich qe
                ON qe.session_id = s.id AND qe.name = 'bash_cli_counts'
        , json_each(qe.value) je
       WHERE s.modified_at IS NOT NULL AND s.modified_at >= ? AND s.modified_at < ?
       GROUP BY je.key
       ORDER BY c DESC, je.key ASC
       LIMIT 10
    `,
    )
    .all(startMs, endMs) as Array<{ cli: string; c: number }>;
  const topClis = topCliRows.map((r) => ({ cli: r.cli, count: r.c }));

  const activeProjectRows = db
    .prepare(
      `
      SELECT COALESCE(NULLIF(project_key, ''), pwd) AS pwd,
             COUNT(*) AS c,
             COUNT(DISTINCT date(modified_at / 1000, 'unixepoch', 'localtime')) AS active_days,
             MAX(modified_at) AS last_active_at
        FROM sessions
       WHERE modified_at IS NOT NULL AND modified_at >= ? AND modified_at < ?
       GROUP BY COALESCE(NULLIF(project_key, ''), pwd)
       ORDER BY c DESC, last_active_at DESC
       LIMIT 6
    `,
    )
    .all(startMs, endMs) as Array<{
    pwd: string;
    c: number;
    active_days: number;
    last_active_at: number;
  }>;
  const activeProjects = activeProjectRows.map((r) => ({
    pwd: r.pwd,
    count: r.c,
    activeDays: r.active_days,
    lastActiveAt: r.last_active_at,
  }));

  const repeatedRows = db
    .prepare(
      `
      SELECT COALESCE(NULLIF(project_key, ''), pwd) AS pwd,
             COUNT(DISTINCT date(modified_at / 1000, 'unixepoch', 'localtime')) AS active_days,
             COUNT(*) AS sessions,
             MAX(modified_at) AS last_active_at
        FROM sessions
       WHERE modified_at IS NOT NULL AND modified_at >= ? AND modified_at < ?
       GROUP BY COALESCE(NULLIF(project_key, ''), pwd)
      HAVING active_days >= 3
       ORDER BY active_days DESC, sessions DESC, last_active_at DESC
       LIMIT 6
    `,
    )
    .all(startMs, endMs) as Array<{
    pwd: string;
    active_days: number;
    sessions: number;
    last_active_at: number;
  }>;
  const repeatedReturnProjects = repeatedRows.map((r) => ({
    pwd: r.pwd,
    activeDays: r.active_days,
    sessions: r.sessions,
    lastActiveAt: r.last_active_at,
  }));

  return {
    sessions,
    projects,
    activeDays,
    avgPerActiveDay: activeDays > 0 ? sessions / activeDays : 0,
    adapterMix,
    topClis,
    activeProjects,
    repeatedReturnProjects,
  };
}

export function getWindowMetrics(days: number, now: number = Date.now()): WindowBundle {
  const db = getDb();
  const todayStart = localDayStart(now);
  const windowStart = addDays(todayStart, -(days - 1));
  return {
    days,
    window: computeWindowMetrics(db, windowStart, now),
  };
}

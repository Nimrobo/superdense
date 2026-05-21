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
  repeatedReturnProjects: Array<{ pwd: string; activeDays: number; sessions: number; lastActiveAt: number }>;
}

export interface WindowBundle {
  days: number;
  window: WindowMetrics;
}

function ymd(ms: number): string {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

function utcDayStart(ms: number): number {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

export function getHeaderTotals(): HeaderTotals {
  const db = getDb();
  const sessions = (db.prepare('SELECT COUNT(*) AS c FROM sessions').get() as { c: number }).c;
  const distinctPwds = (db
    .prepare("SELECT COUNT(DISTINCT COALESCE(NULLIF(project_key, ''), pwd)) AS c FROM sessions")
    .get() as { c: number }).c;
  const activeDays = (db.prepare(`
    SELECT COUNT(DISTINCT date(modified_at / 1000, 'unixepoch')) AS c
      FROM sessions
     WHERE modified_at IS NOT NULL
  `).get() as { c: number }).c;
  const distinctAgents = (db.prepare('SELECT COUNT(DISTINCT agent) AS c FROM sessions').get() as { c: number }).c;
  return { sessions, distinctPwds, activeDays, distinctAgents };
}

/**
 * Compute current + longest streak in consecutive days of activity, using
 * `date(modified_at/1000,'unixepoch')` (UTC) as the day key. Current streak
 * counts a chain ending today OR yesterday (so a day with no activity yet
 * doesn't break the streak until tomorrow).
 */
export function getStreaks(now: number = Date.now()): Streaks {
  const rows = getDb()
    .prepare(`
      SELECT DISTINCT date(modified_at / 1000, 'unixepoch') AS d
        FROM sessions
       WHERE modified_at IS NOT NULL
       ORDER BY d ASC
    `)
    .all() as Array<{ d: string }>;
  if (rows.length === 0) return { current: 0, longest: 0, longestRange: null };

  const days = rows.map((r) => r.d);
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

  // Current streak: walk back from today.
  const today = ymd(now);
  const yesterday = ymd(now - DAY_MS);
  const lastDay = days[days.length - 1]!;
  let current = 0;
  if (lastDay === today || lastDay === yesterday) {
    current = 1;
    let cursor = new Date(`${lastDay}T00:00:00Z`).getTime();
    const set = new Set(days);
    while (true) {
      cursor -= DAY_MS;
      if (set.has(ymd(cursor))) current++;
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
 * Session-count series, zero-filled, ending today (UTC).
 */
export function getContributions(now: number = Date.now(), days = 180): ContributionDay[] {
  const clampedDays = Math.max(1, Math.min(180, Math.floor(days)));
  const start = now - (clampedDays - 1) * DAY_MS;
  const rows = getDb()
    .prepare(`
      SELECT date(modified_at / 1000, 'unixepoch') AS d, COUNT(*) AS c
        FROM sessions
       WHERE modified_at IS NOT NULL
         AND modified_at >= ?
       GROUP BY d
    `)
    .all(start - DAY_MS) as Array<{ d: string; c: number }>;
  const map = new Map<string, number>();
  for (const r of rows) map.set(r.d, r.c);

  const out: ContributionDay[] = [];
  // Anchor on today's UTC day; walk back for a zero-filled fixed range.
  const todayMid = Date.UTC(
    new Date(now).getUTCFullYear(),
    new Date(now).getUTCMonth(),
    new Date(now).getUTCDate(),
  );
  for (let i = clampedDays - 1; i >= 0; i--) {
    const ms = todayMid - i * DAY_MS;
    const key = ymd(ms);
    out.push({ date: key, count: map.get(key) ?? 0 });
  }
  return out;
}

function computeWindowMetrics(db: ReturnType<typeof getDb>, startMs: number, endMs: number): WindowMetrics {
  const sessions = (db
    .prepare(`SELECT COUNT(*) AS c FROM sessions WHERE modified_at IS NOT NULL AND modified_at >= ? AND modified_at < ?`)
    .get(startMs, endMs) as { c: number }).c;

  const projects = (db
    .prepare(`
      SELECT COUNT(DISTINCT COALESCE(NULLIF(project_key, ''), pwd)) AS c
        FROM sessions
       WHERE modified_at IS NOT NULL AND modified_at >= ? AND modified_at < ?
    `)
    .get(startMs, endMs) as { c: number }).c;

  const activeDays = (db
    .prepare(`
      SELECT COUNT(DISTINCT date(modified_at / 1000, 'unixepoch')) AS c
        FROM sessions
       WHERE modified_at IS NOT NULL AND modified_at >= ? AND modified_at < ?
    `)
    .get(startMs, endMs) as { c: number }).c;

  const adapterMixRows = db
    .prepare(`
      SELECT agent, COUNT(*) AS c
        FROM sessions
       WHERE modified_at IS NOT NULL AND modified_at >= ? AND modified_at < ?
       GROUP BY agent
       ORDER BY c DESC
    `)
    .all(startMs, endMs) as Array<{ agent: string; c: number }>;
  const adapterMix = adapterMixRows.map((r) => ({ agent: r.agent, count: r.c }));

  const topCliRows = db
    .prepare(`
      SELECT je.key AS cli, SUM(CAST(je.value AS INTEGER)) AS c
        FROM sessions s
        INNER JOIN query_enrich qe
                ON qe.session_id = s.id AND qe.name = 'bash_cli_counts'
        , json_each(qe.value) je
       WHERE s.modified_at IS NOT NULL AND s.modified_at >= ? AND s.modified_at < ?
       GROUP BY je.key
       ORDER BY c DESC
       LIMIT 5
    `)
    .all(startMs, endMs) as Array<{ cli: string; c: number }>;
  const topClis = topCliRows.map((r) => ({ cli: r.cli, count: r.c }));

  const activeProjectRows = db
    .prepare(`
      SELECT COALESCE(NULLIF(project_key, ''), pwd) AS pwd,
             COUNT(*) AS c,
             COUNT(DISTINCT date(modified_at / 1000, 'unixepoch')) AS active_days,
             MAX(modified_at) AS last_active_at
        FROM sessions
       WHERE modified_at IS NOT NULL AND modified_at >= ? AND modified_at < ?
       GROUP BY COALESCE(NULLIF(project_key, ''), pwd)
       ORDER BY c DESC, last_active_at DESC
       LIMIT 6
    `)
    .all(startMs, endMs) as Array<{ pwd: string; c: number; active_days: number; last_active_at: number }>;
  const activeProjects = activeProjectRows.map((r) => ({
    pwd: r.pwd,
    count: r.c,
    activeDays: r.active_days,
    lastActiveAt: r.last_active_at,
  }));

  const repeatedRows = db
    .prepare(`
      SELECT COALESCE(NULLIF(project_key, ''), pwd) AS pwd,
             COUNT(DISTINCT date(modified_at / 1000, 'unixepoch')) AS active_days,
             COUNT(*) AS sessions,
             MAX(modified_at) AS last_active_at
        FROM sessions
       WHERE modified_at IS NOT NULL AND modified_at >= ? AND modified_at < ?
       GROUP BY COALESCE(NULLIF(project_key, ''), pwd)
      HAVING active_days >= 3
       ORDER BY active_days DESC, sessions DESC, last_active_at DESC
       LIMIT 6
    `)
    .all(startMs, endMs) as Array<{ pwd: string; active_days: number; sessions: number; last_active_at: number }>;
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
  const todayStart = utcDayStart(now);
  const windowStart = todayStart - (days - 1) * DAY_MS;
  return {
    days,
    window: computeWindowMetrics(db, windowStart, now),
  };
}

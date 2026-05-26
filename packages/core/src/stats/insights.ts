import { getDb } from '../db.js';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface HeatmapCell {
  dow: number; // 0=Sunday … 6=Saturday (local time)
  hour: number; // 0..23 (local time)
  count: number;
}

export interface ComebackProject {
  pwd: string;
  dormantDays: number;
  resumedAt: number;
  sessions7d: number;
}

export interface DayKind {
  date: string;
  sessions: number;
  pwds: number;
  kind: 'focus' | 'scatter' | 'normal';
}

export interface WorkRhythm {
  peakHour: { dow: number; hour: number; count: number } | null;
  mostConsistentWeekday: { dow: number; activeWeeks: number } | null;
}

export interface PersonalRecords {
  bestDay: { date: string; sessions: number } | null;
  mostCliInSession: { sessionId: string; total: number } | null;
  longestSession: { sessionId: string; durationMs: number } | null;
}

/** Hour-of-day × day-of-week heatmap (last 90 days), using session created_at. */
export function getHourDowHeatmap(now: number = Date.now()): HeatmapCell[] {
  const since = now - 90 * DAY_MS;
  const rows = getDb()
    .prepare(`SELECT created_at FROM sessions WHERE created_at IS NOT NULL AND created_at >= ?`)
    .all(since) as Array<{ created_at: number }>;
  const grid: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));
  for (const r of rows) {
    const d = new Date(r.created_at);
    grid[d.getDay()]![d.getHours()]++;
  }
  const out: HeatmapCell[] = [];
  for (let dow = 0; dow < 7; dow++) {
    for (let hour = 0; hour < 24; hour++) {
      out.push({ dow, hour, count: grid[dow]![hour]! });
    }
  }
  return out;
}

export function getWorkRhythm(now: number = Date.now()): WorkRhythm {
  const since = now - 180 * DAY_MS;
  const rows = getDb()
    .prepare(
      `
      SELECT created_at
        FROM sessions
       WHERE created_at IS NOT NULL AND created_at >= ?
    `,
    )
    .all(since) as Array<{ created_at: number }>;

  if (rows.length === 0) return { peakHour: null, mostConsistentWeekday: null };

  const hourGrid: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));
  const weekdayWeeks: Array<Set<string>> = Array.from({ length: 7 }, () => new Set<string>());

  for (const r of rows) {
    const d = new Date(r.created_at);
    const dow = d.getDay();
    const hour = d.getHours();
    hourGrid[dow]![hour]++;
    const weekStart = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());
    const wy = weekStart.getFullYear();
    const wm = String(weekStart.getMonth() + 1).padStart(2, '0');
    const wd = String(weekStart.getDate()).padStart(2, '0');
    weekdayWeeks[dow]!.add(`${wy}-${wm}-${wd}`);
  }

  let peakHour: WorkRhythm['peakHour'] = null;
  for (let dow = 0; dow < 7; dow++) {
    for (let hour = 0; hour < 24; hour++) {
      const count = hourGrid[dow]![hour]!;
      if (count > 0 && (!peakHour || count > peakHour.count)) peakHour = { dow, hour, count };
    }
  }

  let mostConsistentWeekday: WorkRhythm['mostConsistentWeekday'] = null;
  for (let dow = 0; dow < 7; dow++) {
    const activeWeeks = weekdayWeeks[dow]!.size;
    if (
      activeWeeks > 0 &&
      (!mostConsistentWeekday || activeWeeks > mostConsistentWeekday.activeWeeks)
    ) {
      mostConsistentWeekday = { dow, activeWeeks };
    }
  }

  return { peakHour, mostConsistentWeekday };
}

/** Projects with ≥14 days of dormancy that had ≥1 session in the last 7 days. */
export function getComebackProjects(now: number = Date.now()): ComebackProject[] {
  const recentStart = now - 7 * DAY_MS;
  const dormancyThreshold = 14 * DAY_MS;
  const rows = getDb()
    .prepare(
      `
      SELECT COALESCE(NULLIF(project_key, ''), pwd) AS pwd,
             MAX(CASE WHEN modified_at >= ? THEN modified_at END) AS recent_max,
             MIN(CASE WHEN modified_at >= ? THEN modified_at END) AS recent_min,
             MAX(CASE WHEN modified_at <  ? THEN modified_at END) AS prior_max,
             SUM(CASE WHEN modified_at >= ? THEN 1 ELSE 0 END)   AS recent_count
        FROM sessions
       WHERE modified_at IS NOT NULL
       GROUP BY COALESCE(NULLIF(project_key, ''), pwd)
      HAVING recent_count > 0 AND prior_max IS NOT NULL
    `,
    )
    .all(recentStart, recentStart, recentStart, recentStart) as Array<{
    pwd: string;
    recent_max: number;
    recent_min: number;
    prior_max: number;
    recent_count: number;
  }>;
  const out: ComebackProject[] = [];
  for (const r of rows) {
    const gap = r.recent_min - r.prior_max;
    if (gap < dormancyThreshold) continue;
    out.push({
      pwd: r.pwd,
      dormantDays: Math.floor(gap / DAY_MS),
      resumedAt: r.recent_min,
      sessions7d: r.recent_count,
    });
  }
  out.sort((a, b) => b.dormantDays - a.dormantDays);
  return out.slice(0, 10);
}

/** Per-day classification: focus (1 project, many sessions) vs scatter (many projects). */
export function getDayKinds(now: number = Date.now(), days = 30): DayKind[] {
  const since = now - days * DAY_MS;
  const rows = getDb()
    .prepare(
      `
      SELECT date(modified_at / 1000, 'unixepoch', 'localtime') AS d,
             COUNT(*) AS sessions,
             COUNT(DISTINCT COALESCE(NULLIF(project_key, ''), pwd)) AS pwds
        FROM sessions
       WHERE modified_at IS NOT NULL AND modified_at >= ?
       GROUP BY d
       ORDER BY d ASC
    `,
    )
    .all(since) as Array<{ d: string; sessions: number; pwds: number }>;
  return rows.map((r) => {
    let kind: DayKind['kind'] = 'normal';
    if (r.sessions >= 3 && r.pwds === 1) kind = 'focus';
    else if (r.sessions >= 3 && r.pwds >= 3) kind = 'scatter';
    return { date: r.d, sessions: r.sessions, pwds: r.pwds, kind };
  });
}

export function getPersonalRecords(): PersonalRecords {
  const db = getDb();
  const bestDay = db
    .prepare(
      `
      SELECT date(modified_at / 1000, 'unixepoch', 'localtime') AS d, COUNT(*) AS c
        FROM sessions
       WHERE modified_at IS NOT NULL
       GROUP BY d
       ORDER BY c DESC
       LIMIT 1
    `,
    )
    .get() as { d: string; c: number } | undefined;

  const mostCli = db
    .prepare(
      `
      SELECT qe.session_id AS sid, (
        SELECT SUM(CAST(je.value AS INTEGER)) FROM json_each(qe.value) je
      ) AS total
        FROM query_enrich qe
       WHERE qe.name = 'bash_cli_counts'
       ORDER BY total DESC
       LIMIT 1
    `,
    )
    .get() as { sid: string; total: number } | undefined;

  // Longest agent runtime: cumulative active conversation time from the
  // active_duration enricher, which excludes idle gaps > 5 min.
  const longest = db
    .prepare(
      `
      SELECT qe.session_id AS id,
             CAST(json_extract(qe.value, '$.activeMs') AS INTEGER) AS dur
        FROM query_enrich qe
       WHERE qe.name = 'active_duration'
         AND dur IS NOT NULL
         AND dur > 0
       ORDER BY dur DESC
       LIMIT 1
    `,
    )
    .get() as { id: string; dur: number } | undefined;

  return {
    bestDay: bestDay ? { date: bestDay.d, sessions: bestDay.c } : null,
    mostCliInSession: mostCli ? { sessionId: mostCli.sid, total: mostCli.total } : null,
    longestSession: longest ? { sessionId: longest.id, durationMs: longest.dur } : null,
  };
}

export interface InsightsBundle {
  hourDowHeatmap: HeatmapCell[];
  workRhythm: WorkRhythm;
  comebackProjects: ComebackProject[];
  dayKinds: DayKind[];
  personalRecords: PersonalRecords;
}

export function getInsightsBundle(now: number = Date.now()): InsightsBundle {
  return {
    hourDowHeatmap: getHourDowHeatmap(now),
    workRhythm: getWorkRhythm(now),
    comebackProjects: getComebackProjects(now),
    dayKinds: getDayKinds(now),
    personalRecords: getPersonalRecords(),
  };
}

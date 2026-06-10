import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../../paths.js', () => ({
  DB_PATH: ':memory:',
  SUPERDENSE_HOME: '/tmp/superdense-test',
  GROUPS_DIR: '/tmp/superdense-test/queries',
  USER_FILTERS_DIR: '/tmp/superdense-test/filters',
  LEGACY_USER_FILTERS_DIR: '/tmp/superdense-test/plugins',
  USER_ENRICHERS_DIR: '/tmp/superdense-test/enrichers',
  ensureSuperdenseDirs: vi.fn(),
}));

import { SYSTEM_RUN_ID, getDb, upsertSession, upsertEnrichment } from '../../db.js';
import type { Session } from '../../types.js';
import { getStreaks, getContributions, getWindowMetrics, getHeaderTotals } from '../motivation.js';

const DAY = 24 * 60 * 60 * 1000;

const BASE: Session = {
  id: 'x',
  agent: 'claude-code',
  sessionId: 'abc',
  logPath: '/tmp/x.jsonl',
  pwd: '/proj/a',
  projectKey: '/proj/a',
};

function clearDb() {
  getDb().exec(
    "DELETE FROM query_matches; DELETE FROM session_enrich; DELETE FROM sessions; DELETE FROM queries; DELETE FROM query_run WHERE id != 'system';",
  );
}

// Anchor "now" to noon UTC for deterministic day-bucket math.
function utcNoon(y: number, m: number, d: number): number {
  return Date.UTC(y, m - 1, d, 12, 0, 0);
}

describe('getHeaderTotals', () => {
  beforeEach(clearDb);
  it('counts sessions, projects, active days, agents', () => {
    const now = utcNoon(2026, 5, 21);
    upsertSession({ ...BASE, id: 's1', pwd: '/a', agent: 'claude-code', modifiedAt: now });
    upsertSession({ ...BASE, id: 's2', pwd: '/a', agent: 'codex', modifiedAt: now });
    upsertSession({ ...BASE, id: 's3', pwd: '/b', agent: 'codex', modifiedAt: now - DAY });
    const t = getHeaderTotals();
    expect(t.sessions).toBe(3);
    expect(t.distinctPwds).toBe(2);
    expect(t.activeDays).toBe(2);
    expect(t.distinctAgents).toBe(2);
  });

  it('counts Conductor sibling workspaces as one header project', () => {
    const now = utcNoon(2026, 5, 21);
    upsertSession({
      ...BASE,
      id: 's1',
      pwd: '/Users/x/conductor/workspaces/superdense/provo-v1',
      modifiedAt: now,
    });
    upsertSession({
      ...BASE,
      id: 's2',
      pwd: '/Users/x/conductor/workspaces/superdense/provo-v2',
      modifiedAt: now,
    });
    upsertSession({
      ...BASE,
      id: 's3',
      pwd: '/Users/x/conductor/workspaces/other/provo-v1',
      modifiedAt: now,
    });

    expect(getHeaderTotals().distinctPwds).toBe(2);
  });
});

describe('getStreaks', () => {
  beforeEach(clearDb);

  it('returns zero streak with no data', () => {
    const s = getStreaks(utcNoon(2026, 5, 21));
    expect(s.current).toBe(0);
    expect(s.longest).toBe(0);
  });

  it('counts consecutive days ending today', () => {
    const now = utcNoon(2026, 5, 21);
    for (let i = 0; i < 4; i++) {
      upsertSession({ ...BASE, id: `s${i}`, modifiedAt: now - i * DAY });
    }
    const s = getStreaks(now);
    expect(s.current).toBe(4);
    expect(s.longest).toBe(4);
  });

  it('still counts a streak ending yesterday (no break)', () => {
    const now = utcNoon(2026, 5, 21);
    upsertSession({ ...BASE, id: 's1', modifiedAt: now - 1 * DAY });
    upsertSession({ ...BASE, id: 's2', modifiedAt: now - 2 * DAY });
    const s = getStreaks(now);
    expect(s.current).toBe(2);
  });

  it('breaks streak if last activity was 2+ days ago', () => {
    const now = utcNoon(2026, 5, 21);
    upsertSession({ ...BASE, id: 's1', modifiedAt: now - 3 * DAY });
    upsertSession({ ...BASE, id: 's2', modifiedAt: now - 4 * DAY });
    const s = getStreaks(now);
    expect(s.current).toBe(0);
    expect(s.longest).toBe(2);
  });

  it('finds the longest streak among multiple', () => {
    const now = utcNoon(2026, 5, 21);
    // Run A: 5 days, ending 30 days ago.
    for (let i = 0; i < 5; i++)
      upsertSession({ ...BASE, id: `a${i}`, modifiedAt: now - (30 + i) * DAY });
    // Run B: 3 days, ending today.
    for (let i = 0; i < 3; i++) upsertSession({ ...BASE, id: `b${i}`, modifiedAt: now - i * DAY });
    const s = getStreaks(now);
    expect(s.longest).toBe(5);
    expect(s.current).toBe(3);
  });
});

describe('getContributions', () => {
  beforeEach(clearDb);
  it('returns 366 zero-filled days by default', () => {
    const now = utcNoon(2026, 5, 21);
    const c = getContributions(now);
    expect(c).toHaveLength(366);
    expect(c[c.length - 1]!.count).toBe(0);
  });

  it('counts sessions on the correct day', () => {
    const now = utcNoon(2026, 5, 21);
    upsertSession({ ...BASE, id: 's1', modifiedAt: now });
    upsertSession({ ...BASE, id: 's2', modifiedAt: now });
    upsertSession({ ...BASE, id: 's3', modifiedAt: now - 5 * DAY });
    const c = getContributions(now);
    const last = c[c.length - 1]!;
    expect(last.count).toBe(2);
    const sixthFromEnd = c[c.length - 6]!;
    expect(sixthFromEnd.count).toBe(1);
  });
});

describe('getWindowMetrics', () => {
  beforeEach(clearDb);

  it('computes sessions, projects, activeDays for window', () => {
    const now = utcNoon(2026, 5, 21);
    // 3 sessions in last 7 days across 2 projects, 2 distinct days
    upsertSession({ ...BASE, id: 's1', pwd: '/a', modifiedAt: now - 1 * DAY });
    upsertSession({ ...BASE, id: 's2', pwd: '/a', modifiedAt: now - 1 * DAY });
    upsertSession({ ...BASE, id: 's3', pwd: '/b', modifiedAt: now - 3 * DAY });
    upsertSession({ ...BASE, id: 's4', pwd: '/a', modifiedAt: now - 10 * DAY });

    const w = getWindowMetrics(7, now);
    expect(w.window.sessions).toBe(3);
    expect(w.window.projects).toBe(2);
    expect(w.window.activeDays).toBe(2);
  });

  it('computes adapterMix and excludes outside-window sessions', () => {
    const now = utcNoon(2026, 5, 21);
    upsertSession({ ...BASE, id: 's1', agent: 'claude-code', modifiedAt: now - 1 * DAY });
    upsertSession({ ...BASE, id: 's2', agent: 'claude-code', modifiedAt: now - 2 * DAY });
    upsertSession({ ...BASE, id: 's3', agent: 'codex', modifiedAt: now - 3 * DAY });
    const w = getWindowMetrics(7, now);
    const mix = Object.fromEntries(w.window.adapterMix.map((m) => [m.agent, m.count]));
    expect(mix['claude-code']).toBe(2);
    expect(mix['codex']).toBe(1);
  });

  it('returns topClis from bash_cli_counts enrichment', () => {
    const now = utcNoon(2026, 5, 21);
    upsertSession({ ...BASE, id: 's1', modifiedAt: now - 1 * DAY });
    upsertSession({ ...BASE, id: 's2', modifiedAt: now - 2 * DAY });
    upsertEnrichment('s1', SYSTEM_RUN_ID, 'bash_cli_counts', 1, { git: 3, gh: 1 }, now);
    upsertEnrichment('s2', SYSTEM_RUN_ID, 'bash_cli_counts', 1, { git: 4, npm: 2 }, now);
    const w = getWindowMetrics(7, now);
    const byCli = Object.fromEntries(w.window.topClis.map((c) => [c.cli, c.count]));
    expect(byCli['git']).toBe(7);
    expect(byCli['gh']).toBe(1);
    expect(byCli['npm']).toBe(2);
    expect(w.window.topClis[0]!.cli).toBe('git');
  });

  it('aggregates turn latency from root sessions in the selected window', () => {
    const now = utcNoon(2026, 5, 21);
    upsertSession({ ...BASE, id: 's1', modifiedAt: now - 1 * DAY });
    upsertSession({ ...BASE, id: 's2', modifiedAt: now - 2 * DAY });
    upsertSession({ ...BASE, id: 'outside', modifiedAt: now - 10 * DAY });
    upsertSession({
      ...BASE,
      id: 'child',
      modifiedAt: now - 1 * DAY,
      isSubagent: true,
      parentSessionId: 's1',
    });
    upsertEnrichment(
      's1',
      SYSTEM_RUN_ID,
      'turn_latency',
      1,
      {
        v: 1,
        count: 2,
        minMs: 1000,
        maxMs: 5000,
        avgMs: 3000,
        medianMs: 1000,
        p90Ms: 5000,
        turns: [
          { startTs: 1, endTs: 1001, durationMs: 1000 },
          { startTs: 2, endTs: 5002, durationMs: 5000 },
        ],
      },
      now,
    );
    upsertEnrichment(
      's2',
      SYSTEM_RUN_ID,
      'turn_latency',
      1,
      {
        v: 1,
        count: 1,
        minMs: 9000,
        maxMs: 9000,
        avgMs: 9000,
        medianMs: 9000,
        p90Ms: 9000,
        turns: [{ startTs: 3, endTs: 9003, durationMs: 9000 }],
      },
      now,
    );
    upsertEnrichment(
      'outside',
      SYSTEM_RUN_ID,
      'turn_latency',
      1,
      {
        v: 1,
        count: 1,
        minMs: 99_000,
        maxMs: 99_000,
        avgMs: 99_000,
        medianMs: 99_000,
        p90Ms: 99_000,
        turns: [{ startTs: 4, endTs: 99004, durationMs: 99_000 }],
      },
      now,
    );
    upsertEnrichment(
      'child',
      SYSTEM_RUN_ID,
      'turn_latency',
      1,
      {
        v: 1,
        count: 1,
        minMs: 77_000,
        maxMs: 77_000,
        avgMs: 77_000,
        medianMs: 77_000,
        p90Ms: 77_000,
        turns: [{ startTs: 5, endTs: 77005, durationMs: 77_000 }],
      },
      now,
    );

    expect(getWindowMetrics(7, now).window.turnLatency).toEqual({
      count: 3,
      minMs: 1000,
      maxMs: 9000,
      avgMs: 5000,
      medianMs: 5000,
      p90Ms: 9000,
    });
  });

  it('returns null turn latency when there are no measured turns', () => {
    const now = utcNoon(2026, 5, 21);
    upsertSession({ ...BASE, id: 's1', modifiedAt: now - 1 * DAY });

    expect(getWindowMetrics(7, now).window.turnLatency).toBeNull();
  });

  it('returns active and repeated-return projects', () => {
    const now = utcNoon(2026, 5, 21);
    upsertSession({ ...BASE, id: 's1', pwd: '/a', modifiedAt: now - 1 * DAY });
    upsertSession({ ...BASE, id: 's2', pwd: '/a', modifiedAt: now - 2 * DAY });
    upsertSession({ ...BASE, id: 's3', pwd: '/a', modifiedAt: now - 3 * DAY });
    upsertSession({ ...BASE, id: 's4', pwd: '/b', modifiedAt: now - 1 * DAY });
    const w = getWindowMetrics(7, now);
    expect(w.window.activeProjects[0]!.pwd).toBe('/a');
    expect(w.window.activeProjects[0]!.count).toBe(3);
    expect(w.window.repeatedReturnProjects.map((p) => p.pwd)).toContain('/a');
  });

  it('groups active projects by Conductor projectKey', () => {
    const now = utcNoon(2026, 5, 21);
    upsertSession({
      ...BASE,
      id: 's1',
      pwd: '/Users/x/conductor/workspaces/superdense/provo-v1',
      modifiedAt: now - 1 * DAY,
    });
    upsertSession({
      ...BASE,
      id: 's2',
      pwd: '/Users/x/conductor/workspaces/superdense/provo-v2',
      modifiedAt: now - 2 * DAY,
    });
    upsertSession({
      ...BASE,
      id: 's3',
      pwd: '/Users/x/conductor/workspaces/other/provo-v1',
      modifiedAt: now - 1 * DAY,
    });

    const w = getWindowMetrics(7, now);

    expect(w.window.projects).toBe(2);
    expect(w.window.activeProjects[0]).toMatchObject({
      pwd: '/Users/x/conductor/workspaces/superdense',
      count: 2,
    });
  });

  it('ignores sub-agent sessions across dashboard motivation metrics', () => {
    const now = utcNoon(2026, 5, 21);
    const rootTime = now - DAY;
    upsertSession({
      ...BASE,
      id: 'root',
      agent: 'root-agent',
      pwd: '/root',
      createdAt: rootTime,
      modifiedAt: rootTime,
    });
    upsertEnrichment('root', SYSTEM_RUN_ID, 'bash_cli_counts', 1, { git: 1 }, now);

    for (let i = 0; i < 3; i++) {
      const childTime = now - i * DAY - 1000;
      upsertSession({
        ...BASE,
        id: `child-${i}`,
        agent: 'child-agent',
        pwd: '/child',
        createdAt: childTime,
        modifiedAt: childTime,
        isSubagent: true,
        parentSessionId: 'root',
      });
      upsertEnrichment(`child-${i}`, SYSTEM_RUN_ID, 'bash_cli_counts', 1, { git: 10, gh: 9 }, now);
    }

    expect(getHeaderTotals()).toEqual({
      sessions: 1,
      distinctPwds: 1,
      activeDays: 1,
      distinctAgents: 1,
    });
    expect(getStreaks(now)).toMatchObject({ current: 1, longest: 1 });

    const contributions = getContributions(now, 3);
    expect(contributions[contributions.length - 1]).toMatchObject({ count: 0 });
    expect(contributions[contributions.length - 2]).toMatchObject({ count: 1 });

    const window = getWindowMetrics(7, now).window;
    expect(window.sessions).toBe(1);
    expect(window.projects).toBe(1);
    expect(window.activeDays).toBe(1);
    expect(window.turnLatency).toBeNull();
    expect(window.adapterMix).toEqual([{ agent: 'root-agent', count: 1 }]);
    expect(window.topClis).toEqual([{ cli: 'git', count: 1 }]);
    expect(window.activeProjects).toEqual([
      { pwd: '/root', count: 1, activeDays: 1, lastActiveAt: rootTime },
    ]);
    expect(window.repeatedReturnProjects).toEqual([]);
  });
});

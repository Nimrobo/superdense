import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../../paths.js', () => ({
  DB_PATH: ':memory:',
  ROAD42_HOME: '/tmp/road42-test',
  GROUPS_DIR: '/tmp/road42-test/queries',
  USER_FILTERS_DIR: '/tmp/road42-test/filters',
  LEGACY_USER_FILTERS_DIR: '/tmp/road42-test/plugins',
  USER_ENRICHERS_DIR: '/tmp/road42-test/enrichers',
  ensureRoad42Dirs: vi.fn(),
}));

import { getDb, upsertSession, upsertEnrichment } from '../../db.js';
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
  getDb().exec('DELETE FROM query_matches; DELETE FROM query_enrich; DELETE FROM sessions; DELETE FROM queries;');
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
    upsertSession({ ...BASE, id: 's1', pwd: '/Users/x/conductor/workspaces/road42/provo-v1', modifiedAt: now });
    upsertSession({ ...BASE, id: 's2', pwd: '/Users/x/conductor/workspaces/road42/provo-v2', modifiedAt: now });
    upsertSession({ ...BASE, id: 's3', pwd: '/Users/x/conductor/workspaces/other/provo-v1', modifiedAt: now });

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
    for (let i = 0; i < 5; i++) upsertSession({ ...BASE, id: `a${i}`, modifiedAt: now - (30 + i) * DAY });
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
    upsertEnrichment('s1', 'bash_cli_counts', 1, { git: 3, gh: 1 }, now);
    upsertEnrichment('s2', 'bash_cli_counts', 1, { git: 4, npm: 2 }, now);
    const w = getWindowMetrics(7, now);
    const byCli = Object.fromEntries(w.window.topClis.map((c) => [c.cli, c.count]));
    expect(byCli['git']).toBe(7);
    expect(byCli['gh']).toBe(1);
    expect(byCli['npm']).toBe(2);
    expect(w.window.topClis[0]!.cli).toBe('git');
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
    upsertSession({ ...BASE, id: 's1', pwd: '/Users/x/conductor/workspaces/road42/provo-v1', modifiedAt: now - 1 * DAY });
    upsertSession({ ...BASE, id: 's2', pwd: '/Users/x/conductor/workspaces/road42/provo-v2', modifiedAt: now - 2 * DAY });
    upsertSession({ ...BASE, id: 's3', pwd: '/Users/x/conductor/workspaces/other/provo-v1', modifiedAt: now - 1 * DAY });

    const w = getWindowMetrics(7, now);

    expect(w.window.projects).toBe(2);
    expect(w.window.activeProjects[0]).toMatchObject({
      pwd: '/Users/x/conductor/workspaces/road42',
      count: 2,
    });
  });
});

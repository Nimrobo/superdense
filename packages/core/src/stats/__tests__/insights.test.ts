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

import { SYSTEM_RUN_ID, getDb, upsertEnrichment, upsertSession } from '../../db.js';
import type { Session } from '../../types.js';
import {
  getComebackProjects,
  getDayKinds,
  getHourDowHeatmap,
  getPersonalRecords,
  getWorkRhythm,
} from '../insights.js';

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
    'DELETE FROM query_matches; DELETE FROM session_enrich; DELETE FROM sessions; DELETE FROM queries;',
  );
}

function utcNoon(y: number, m: number, d: number): number {
  return Date.UTC(y, m - 1, d, 12, 0, 0);
}

describe('getComebackProjects', () => {
  beforeEach(clearDb);
  it('flags projects dormant >=14d with recent activity', () => {
    const now = utcNoon(2026, 5, 21);
    upsertSession({ ...BASE, id: 'old', pwd: '/proj/a', modifiedAt: now - 40 * DAY });
    upsertSession({ ...BASE, id: 'new', pwd: '/proj/a', modifiedAt: now - 2 * DAY });
    const items = getComebackProjects(now);
    expect(items).toHaveLength(1);
    expect(items[0]!.pwd).toBe('/proj/a');
    expect(items[0]!.dormantDays).toBeGreaterThanOrEqual(14);
  });

  it('groups Conductor sibling workspaces for comeback projects', () => {
    const now = utcNoon(2026, 5, 21);
    upsertSession({
      ...BASE,
      id: 'old',
      pwd: '/Users/x/conductor/workspaces/superdense/provo-v1',
      modifiedAt: now - 40 * DAY,
    });
    upsertSession({
      ...BASE,
      id: 'new',
      pwd: '/Users/x/conductor/workspaces/superdense/provo-v2',
      modifiedAt: now - 2 * DAY,
    });

    const items = getComebackProjects(now);

    expect(items).toHaveLength(1);
    expect(items[0]!.pwd).toBe('/Users/x/conductor/workspaces/superdense');
  });

  it('does not flag projects with a recent prior session', () => {
    const now = utcNoon(2026, 5, 21);
    upsertSession({ ...BASE, id: 'a', pwd: '/proj/b', modifiedAt: now - 10 * DAY });
    upsertSession({ ...BASE, id: 'b', pwd: '/proj/b', modifiedAt: now - 1 * DAY });
    expect(getComebackProjects(now)).toHaveLength(0);
  });
});

describe('getWorkRhythm', () => {
  beforeEach(clearDb);

  it('returns peak hour and most consistent weekday', () => {
    const now = utcNoon(2026, 5, 21);
    const mondayTen = Date.UTC(2026, 4, 18, 10, 0, 0);
    upsertSession({ ...BASE, id: 's1', createdAt: mondayTen, modifiedAt: mondayTen });
    upsertSession({ ...BASE, id: 's2', createdAt: mondayTen + 1000, modifiedAt: mondayTen + 1000 });
    upsertSession({ ...BASE, id: 's3', createdAt: now - 10 * DAY, modifiedAt: now - 10 * DAY });
    const rhythm = getWorkRhythm(now);
    expect(rhythm.peakHour).toMatchObject({
      dow: new Date(mondayTen).getDay(),
      hour: new Date(mondayTen).getHours(),
      count: 2,
    });
    expect(rhythm.mostConsistentWeekday).toBeTruthy();
  });
});

describe('getDayKinds', () => {
  beforeEach(clearDb);
  it('classifies a single-project busy day as focus', () => {
    const now = utcNoon(2026, 5, 21);
    for (let i = 0; i < 4; i++) {
      upsertSession({ ...BASE, id: `s${i}`, pwd: '/proj/a', modifiedAt: now - 1 * DAY });
    }
    const kinds = getDayKinds(now, 7);
    expect(kinds.some((k) => k.kind === 'focus')).toBe(true);
  });

  it('classifies a many-project day as scatter', () => {
    const now = utcNoon(2026, 5, 21);
    upsertSession({ ...BASE, id: 's1', pwd: '/proj/a', modifiedAt: now - 1 * DAY });
    upsertSession({ ...BASE, id: 's2', pwd: '/proj/b', modifiedAt: now - 1 * DAY });
    upsertSession({ ...BASE, id: 's3', pwd: '/proj/c', modifiedAt: now - 1 * DAY });
    const kinds = getDayKinds(now, 7);
    expect(kinds.some((k) => k.kind === 'scatter')).toBe(true);
  });

  it('uses projectKey for focus and scatter project counts', () => {
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
      modifiedAt: now - 1 * DAY,
    });
    upsertSession({
      ...BASE,
      id: 's3',
      pwd: '/Users/x/conductor/workspaces/superdense/provo-v3',
      modifiedAt: now - 1 * DAY,
    });

    const kinds = getDayKinds(now, 7);

    expect(kinds.some((k) => k.kind === 'focus' && k.pwds === 1)).toBe(true);
  });
});

describe('root-only insight stats', () => {
  beforeEach(clearDb);

  it('ignores sub-agent sessions across dashboard insight metrics', () => {
    const now = utcNoon(2026, 5, 21);
    const rootOld = now - 40 * DAY;
    const rootNew = now - 2 * DAY;
    const childHour = Date.UTC(2026, 4, 18, 10, 0, 0);

    upsertSession({ ...BASE, id: 'root-old', pwd: '/root', modifiedAt: rootOld });
    upsertSession({
      ...BASE,
      id: 'root-new',
      pwd: '/root',
      createdAt: rootNew,
      modifiedAt: rootNew,
    });
    upsertSession({ ...BASE, id: 'root-new-extra', pwd: '/root', modifiedAt: rootNew + 1000 });
    upsertEnrichment('root-new', SYSTEM_RUN_ID, 'bash_cli_counts', 1, { git: 1 }, now);
    upsertEnrichment('root-new', SYSTEM_RUN_ID, 'active_duration', 1, { activeMs: 100 }, now);

    upsertSession({
      ...BASE,
      id: 'child-old',
      pwd: '/child',
      modifiedAt: now - 40 * DAY,
      isSubagent: true,
      parentSessionId: 'root-new',
    });
    for (let i = 0; i < 4; i++) {
      const childTime = childHour + i * 1000;
      upsertSession({
        ...BASE,
        id: `child-${i}`,
        pwd: '/child',
        createdAt: childTime,
        modifiedAt: now - i * 1000,
        isSubagent: true,
        parentSessionId: 'root-new',
      });
    }
    upsertEnrichment('child-0', SYSTEM_RUN_ID, 'bash_cli_counts', 1, { git: 10 }, now);
    upsertEnrichment('child-0', SYSTEM_RUN_ID, 'active_duration', 1, { activeMs: 999 }, now);

    const rootDate = new Date(rootNew);
    const rootCell = getHourDowHeatmap(now).find(
      (c) => c.dow === rootDate.getDay() && c.hour === rootDate.getHours(),
    );
    const childDate = new Date(childHour);
    const childCell = getHourDowHeatmap(now).find(
      (c) => c.dow === childDate.getDay() && c.hour === childDate.getHours(),
    );
    expect(rootCell?.count).toBe(1);
    expect(childCell?.count).toBe(0);

    expect(getWorkRhythm(now).peakHour).toMatchObject({
      dow: rootDate.getDay(),
      hour: rootDate.getHours(),
      count: 1,
    });
    expect(getComebackProjects(now).map((p) => p.pwd)).toEqual(['/root']);
    expect(getDayKinds(now, 7).map((k) => k.sessions)).toEqual([2]);
    expect(getPersonalRecords()).toEqual({
      bestDay: { date: '2026-05-19', sessions: 2 },
      mostCliInSession: { sessionId: 'root-new', total: 1 },
      longestSession: { sessionId: 'root-new', durationMs: 100 },
    });
  });
});

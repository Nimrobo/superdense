import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../paths.js', () => ({
  DB_PATH: ':memory:',
  SUPERDENSE_HOME: '/tmp/superdense-hypotheses-test',
  GROUPS_DIR: '/tmp/superdense-hypotheses-test/queries',
  USER_FILTERS_DIR: '/tmp/superdense-hypotheses-test/filters',
  LEGACY_USER_FILTERS_DIR: '/tmp/superdense-hypotheses-test/plugins',
  USER_ENRICHERS_DIR: '/tmp/superdense-hypotheses-test/enrichers',
  ensureSuperdenseDirs: vi.fn(),
}));

import { _resetDbForTests, upsertSession } from '../../db.js';
import { listProjectProfiles } from '../../projects/index.js';
import {
  getHypothesis,
  listHypotheses,
  recordHypothesis,
  resolveHypothesis,
  type HypothesisStatement,
} from '../index.js';
import type { Session } from '../../types.js';

const statement: HypothesisStatement = {
  action: 'Ship a sharper onboarding email CTA',
  diagnostic: { metric: 'reply_rate', direction: 'increase', magnitude: 0.05 },
  northStar: { metric: 'qualified_calls', direction: 'increase', magnitude: 3 },
  window: { durationMs: 7 * 24 * 60 * 60 * 1000, label: '7 days' },
  mechanism: 'Clearer next steps should convert more interested readers into calls.',
};

function session(id: string): Session {
  return {
    id,
    agent: 'codex',
    sessionId: id.slice('codex:'.length),
    logPath: `/tmp/${id}.jsonl`,
    pwd: '/repo',
    projectKey: '/repo',
    createdAt: 100,
    modifiedAt: 100,
  };
}

function projectId(): string {
  upsertSession(session('codex:project'));
  return listProjectProfiles()[0]!.id;
}

beforeEach(() => {
  _resetDbForTests();
});

afterEach(() => {
  _resetDbForTests();
});

describe('hypotheses', () => {
  it('records, lists, and reads a structured falsifiable hypothesis', () => {
    const project = projectId();

    const result = recordHypothesis({
      id: 'h1',
      projectId: project,
      leverKey: 'email-cta',
      statement,
      createdAt: 1000,
    });

    expect(result).toMatchObject({
      ok: true,
      hypothesis: {
        id: 'h1',
        projectId: project,
        leverKey: 'email-cta',
        statement,
        status: 'open',
        createdAt: 1000,
        resolvedAt: null,
        verdictEvidence: null,
      },
    });
    expect(getHypothesis('h1')).toMatchObject({ id: 'h1', statement });
    expect(listHypotheses({ projectId: project, status: 'open' }).map((h) => h.id)).toEqual(['h1']);
    expect(listHypotheses({ projectId: project, leverKey: 'missing' })).toEqual([]);
  });

  it('requires direction, magnitude, metric, window, and mechanism', () => {
    const project = projectId();

    expect(() =>
      recordHypothesis({
        projectId: project,
        leverKey: 'email-cta',
        statement: {
          action: 'Try a vague thing',
          diagnostic: { metric: 'reply_rate', direction: 'increase' },
          northStar: { metric: 'qualified_calls', direction: 'increase', magnitude: 3 },
          window: { durationMs: 1000 },
          mechanism: 'Maybe it helps.',
        },
      }),
    ).toThrow('statement.diagnostic.magnitude');
  });

  it('resolves a hypothesis with verdict evidence', () => {
    const project = projectId();
    recordHypothesis({
      id: 'h1',
      projectId: project,
      leverKey: 'email-cta',
      statement,
      createdAt: 1000,
    });

    const result = resolveHypothesis('h1', {
      status: 'refuted',
      resolvedAt: 2000,
      verdictEvidence: { experimentId: 'e1', reason: 'north star missed' },
    });

    expect(result.hypothesis).toMatchObject({
      id: 'h1',
      status: 'refuted',
      resolvedAt: 2000,
      verdictEvidence: { experimentId: 'e1', reason: 'north star missed' },
    });
  });
});

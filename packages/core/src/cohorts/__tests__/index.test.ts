import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../paths.js', () => ({
  DB_PATH: ':memory:',
  SUPERDENSE_HOME: '/tmp/superdense-cohorts-test',
  GROUPS_DIR: '/tmp/superdense-cohorts-test/queries',
  USER_FILTERS_DIR: '/tmp/superdense-cohorts-test/filters',
  LEGACY_USER_FILTERS_DIR: '/tmp/superdense-cohorts-test/plugins',
  USER_ENRICHERS_DIR: '/tmp/superdense-cohorts-test/enrichers',
  ensureSuperdenseDirs: vi.fn(),
}));

import {
  _resetDbForTests,
  SYSTEM_RUN_ID,
  upsertEnrichment,
  upsertSession,
  upsertSessionLink,
} from '../../db.js';
import { listProjectProfiles } from '../../projects/index.js';
import { applyCurationBatch, finalizeArtifact } from '../../curation/index.js';
import { assessExternalization } from '../../externalization/index.js';
import { recordRewardSnapshot } from '../../rewards/index.js';
import { getCohort, getVersionChain, listCohorts, listVersionChains } from '../index.js';
import type { Session } from '../../types.js';

// A monotonic clock so each finalize gets a strictly later artifact_finalized_at,
// making the neutral finalized-desc / chain finalized-asc ordering deterministic.
let clock = 1_000_000;
beforeEach(() => {
  clock = 1_000_000;
  vi.spyOn(Date, 'now').mockImplementation(() => ++clock);
  _resetDbForTests();
});
afterEach(() => {
  vi.restoreAllMocks();
  _resetDbForTests();
});

function session(id: string, pwd: string): Session {
  return {
    id,
    agent: 'codex',
    sessionId: id.slice('codex:'.length),
    logPath: `/tmp/${id}.jsonl`,
    pwd,
    projectKey: pwd,
    createdAt: 100,
    modifiedAt: 100,
  };
}

function tokenTotals(totalTokens: number) {
  return {
    inputTokens: totalTokens,
    cachedInputTokens: 0,
    cacheCreationInputTokens: 0,
    cacheCreation5mInputTokens: 0,
    cacheCreation1hInputTokens: 0,
    outputTokens: 0,
    reasoningOutputTokens: 0,
    totalTokens,
  };
}

function costValue(estimatedCostUsd: number | null, totalTokens: number) {
  return {
    v: 1,
    kind: 'api_equivalent_estimate',
    pricingCatalogVersion: 'test',
    pricingSources: [],
    pricingStatus: estimatedCostUsd == null ? 'token_only' : 'estimated',
    estimatedCostUsd,
    tokenTotals: tokenTotals(totalTokens),
    modelBreakdown: [],
    unpricedModels: [],
    usageEventCount: totalTokens > 0 ? 1 : 0,
  };
}

function recordCost(sessionId: string, estimatedCostUsd: number | null, totalTokens: number): void {
  upsertEnrichment(
    sessionId,
    SYSTEM_RUN_ID,
    'session_cost',
    1,
    costValue(estimatedCostUsd, totalTokens),
    Date.now(),
  );
}

function projectIdForPwd(pwd: string): string {
  return listProjectProfiles().find((profile) => profile.projectKey === pwd)!.id;
}

function createArtifact(
  id: string,
  opts: {
    type?: string;
    pwd?: string;
    predecessorArtifactId?: string;
    evidenceSessionIds?: string[];
  } = {},
): void {
  const { type = 'launch', pwd = '/repo', predecessorArtifactId, evidenceSessionIds = [] } = opts;
  const sessionId = `codex:${id}`;
  upsertSession(session(sessionId, pwd));
  for (const evidenceSessionId of evidenceSessionIds) {
    upsertSession(session(evidenceSessionId, pwd));
  }
  applyCurationBatch({
    actions: [
      {
        type: 'thread.create',
        id,
        projectProfileId: projectIdForPwd(pwd),
        provisionalTitle: `${id} title`,
      },
      { type: 'thread.attach', threadId: id, sessionId, role: 'contributor' },
      ...evidenceSessionIds.map((evidenceSessionId) => ({
        type: 'thread.attach',
        threadId: id,
        sessionId: evidenceSessionId,
        role: 'evidence',
      })),
      { type: 'session.consume', sessionId },
      ...evidenceSessionIds.map((evidenceSessionId) => ({
        type: 'session.consume',
        sessionId: evidenceSessionId,
      })),
      { type: 'thread.mark-ready', threadId: id, rationale: 'ready' },
    ],
  });
  finalizeArtifact({ threadId: id, type, payload: { text: id }, predecessorArtifactId });
}

function link(
  artifactId: string,
  targets: Array<{ connector: string; locator: string }>,
): string[] {
  const built = targets.map((target) => ({
    id: `${artifactId}-${target.connector}`,
    connector: target.connector,
    status: 'linked' as const,
    locator: target.locator,
  }));
  assessExternalization({ artifactId, status: 'external', evidence: 'published', targets: built });
  return built.map((target) => target.id);
}

describe('cohorts (Layer 5)', () => {
  it('groups finalized artifacts by type', () => {
    createArtifact('a1');
    createArtifact('a2');
    createArtifact('b1', { type: 'blogpost' });

    const summaries = listCohorts();
    const launch = summaries.find((s) => s.type === 'launch');
    const blog = summaries.find((s) => s.type === 'blogpost');
    expect(launch).toMatchObject({ connector: null, artifactCount: 2 });
    expect(blog).toMatchObject({ connector: null, artifactCount: 1 });
  });

  it('counts externalized and with-rewards artifacts per type', () => {
    createArtifact('a1');
    createArtifact('a2');
    const [target] = link('a1', [{ connector: 'x', locator: '111' }]);
    recordRewardSnapshot({ targetId: target, metrics: { views: 10 }, primaryDim: 'views' });

    const launch = listCohorts().find((s) => s.type === 'launch')!;
    expect(launch).toMatchObject({
      artifactCount: 2,
      externalizedCount: 1,
      withRewardsCount: 1,
    });
  });

  it('fans a multi-platform artifact out into one connector cohort per platform', () => {
    createArtifact('a1');
    const [x] = link('a1', [
      { connector: 'x', locator: '111' },
      { connector: 'youtube', locator: '222' },
    ]);
    recordRewardSnapshot({ targetId: x, metrics: { views: 10 }, primaryDim: 'views' });

    const byConnector = listCohorts({ by: 'connector' });
    expect(byConnector).toHaveLength(2);
    expect(byConnector.find((s) => s.connector === 'x')).toMatchObject({
      type: 'launch',
      artifactCount: 1,
      externalizedCount: 1,
      withRewardsCount: 1,
    });
    expect(byConnector.find((s) => s.connector === 'youtube')).toMatchObject({
      type: 'launch',
      artifactCount: 1,
      externalizedCount: 1,
      withRewardsCount: 0,
    });
  });

  it('surfaces the full comparable bundle with no rank or score', () => {
    createArtifact('a1');
    createArtifact('a2');
    const [target] = link('a2', [{ connector: 'x', locator: '111' }]);
    recordRewardSnapshot({ targetId: target, metrics: { views: 10 }, primaryDim: 'views' });

    const cohort = getCohort({ type: 'launch' });
    expect(cohort.members.map((m) => m.artifact.id)).toEqual(['a2', 'a1']); // finalized DESC

    const member = cohort.members[0]!;
    expect(Object.keys(member).sort()).toEqual(['artifact', 'cost', 'externalization', 'rewards']);
    expect(member).not.toHaveProperty('score');
    expect(member).not.toHaveProperty('rank');
    expect(Array.isArray(member.artifact.lineageEvents)).toBe(true);
    expect(member.artifact.sessions?.length).toBeGreaterThan(0);
    expect(member.rewards.targets[0]?.snapshots).toHaveLength(1);
  });

  it('surfaces contributor run cost with sub-agent work next to cohort outcomes', () => {
    createArtifact('a1', { evidenceSessionIds: ['codex:evidence-1'] });
    const parentId = 'codex:a1';
    const childId = 'codex:a1-child';
    upsertSession({ ...session(childId, '/repo'), isSubagent: true, parentSessionId: parentId });
    upsertSessionLink(parentId, childId, 'subagent', null, Date.now());
    recordCost(parentId, 0.01, 100);
    recordCost(childId, 0.02, 200);
    recordCost('codex:evidence-1', 0.99, 9900);
    const [target] = link('a1', [{ connector: 'x', locator: '111' }]);
    recordRewardSnapshot({ targetId: target, metrics: { views: 10 }, primaryDim: 'views' });

    const member = getCohort({ type: 'launch' }).members[0]!;

    expect(member.cost).toMatchObject({
      contributorSessionIds: [parentId],
      contributors: [
        {
          sessionId: parentId,
          totalCostingWithSubagents: {
            estimatedCostUsd: 0.03,
            tokenTotals: { totalTokens: 300 },
            sessionCount: 2,
          },
        },
      ],
      totalCostingWithSubagents: {
        estimatedCostUsd: 0.03,
        tokenTotals: { totalTokens: 300 },
        sessionCount: 2,
      },
    });
    expect(member.rewards.targets[0]?.latest?.metrics).toEqual({ views: 10 });
  });

  it('preserves contributor ids when their cost data is missing', () => {
    createArtifact('a1');

    const member = getCohort({ type: 'launch' }).members[0]!;

    expect(member.cost).toEqual({
      contributorSessionIds: ['codex:a1'],
      contributors: [{ sessionId: 'codex:a1', totalCostingWithSubagents: null }],
      totalCostingWithSubagents: null,
    });
  });

  it('filters cohort members to a connector when requested', () => {
    createArtifact('a1');
    createArtifact('a2');
    link('a1', [{ connector: 'x', locator: '111' }]);

    const cohort = getCohort({ type: 'launch', connector: 'x' });
    expect(cohort.members.map((m) => m.artifact.id)).toEqual(['a1']);
  });

  it('filters cohort members to a project when requested', () => {
    createArtifact('a1');
    createArtifact('c1', { pwd: '/other' });

    const cohort = getCohort({ type: 'launch', projectId: projectIdForPwd('/repo') });
    expect(cohort.members.map((m) => m.artifact.id)).toEqual(['a1']);
  });

  it('returns an empty cohort for an unknown type', () => {
    createArtifact('a1');
    expect(getCohort({ type: 'nope' }).members).toEqual([]);
  });

  it('lists only version chains of length >= 2', () => {
    createArtifact('v1');
    createArtifact('v2', { predecessorArtifactId: 'v1' });
    createArtifact('v3', { predecessorArtifactId: 'v2' });
    createArtifact('s1'); // standalone, trivial chain

    const chains = listVersionChains();
    expect(chains).toEqual([{ rootId: 'v1', type: 'launch', length: 3 }]);
  });

  it('surfaces a version chain finalized-ascending from any member', () => {
    createArtifact('v1');
    createArtifact('v2', { predecessorArtifactId: 'v1' });
    createArtifact('v3', { predecessorArtifactId: 'v2' });
    recordCost('codex:v1', 0.01, 100);
    recordCost('codex:v2', 0.02, 200);
    recordCost('codex:v3', 0.03, 300);

    for (const anchor of ['v1', 'v2', 'v3']) {
      const chain = getVersionChain(anchor);
      expect(chain?.rootId).toBe('v1');
      expect(chain?.members.map((m) => m.artifact.id)).toEqual(['v1', 'v2', 'v3']);
      expect(
        chain?.members.map((m) => m.cost?.totalCostingWithSubagents?.estimatedCostUsd),
      ).toEqual([0.01, 0.02, 0.03]);
    }
  });

  it('returns null for a non-artifact id', () => {
    expect(getVersionChain('missing')).toBeNull();
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../paths.js', () => ({
  DB_PATH: ':memory:',
  SUPERDENSE_HOME: '/tmp/superdense-reward-status-test',
  GROUPS_DIR: '/tmp/superdense-reward-status-test/queries',
  USER_FILTERS_DIR: '/tmp/superdense-reward-status-test/filters',
  LEGACY_USER_FILTERS_DIR: '/tmp/superdense-reward-status-test/plugins',
  USER_ENRICHERS_DIR: '/tmp/superdense-reward-status-test/enrichers',
  ensureSuperdenseDirs: vi.fn(),
}));

import { _resetDbForTests, upsertSession } from '../../db.js';
import { applyCurationBatch, finalizeArtifact } from '../../curation/index.js';
import { assessExternalization } from '../../externalization/index.js';
import { applyProjectProfilePatch, listProjectProfiles } from '../../projects/index.js';
import { recordRewardSnapshot } from '../../rewards/index.js';
import { getRewardStatus } from '../index.js';
import type { Session } from '../../types.js';

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

function session(id: string, pwd = '/repo'): Session {
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

function projectIdForPwd(pwd: string): string {
  return listProjectProfiles({ includeCovered: true }).find(
    (profile) => profile.projectKey === pwd,
  )!.id;
}

function profileProject(pwd = '/repo'): string {
  const projectId = projectIdForPwd(pwd);
  applyProjectProfilePatch(projectId, {
    name: `Project ${pwd}`,
    description: 'Test project',
    roots: [pwd],
    artifactShapes: [{ type: 'launch', detector: { kind: 'branch' } }],
    evidenceSummary: ['Test fixture'],
    needsHumanAttention: false,
    attentionReasons: [],
  });
  return projectId;
}

function createReadyThread(id: string, opts: { pwd?: string } = {}): string {
  const pwd = opts.pwd ?? '/repo';
  const sessionId = `codex:${id}`;
  upsertSession(session(sessionId, pwd));
  const projectId = profileProject(pwd);
  applyCurationBatch({
    actions: [
      {
        type: 'thread.create',
        id,
        projectProfileId: projectId,
        provisionalTitle: `${id} title`,
      },
      { type: 'thread.attach', threadId: id, sessionId, role: 'contributor' },
      { type: 'session.consume', sessionId },
      { type: 'thread.mark-ready', threadId: id, rationale: 'ready' },
    ],
  });
  return projectId;
}

function createArtifact(
  id: string,
  opts: { pwd?: string; predecessorArtifactId?: string } = {},
): string {
  const projectId = createReadyThread(id, opts);
  finalizeArtifact({
    threadId: id,
    type: 'launch',
    title: `${id} launch`,
    payload: { text: id },
    predecessorArtifactId: opts.predecessorArtifactId,
  });
  return projectId;
}

function linkArtifact(artifactId: string, connector = 'x'): string {
  const targetId = `${artifactId}-${connector}`;
  assessExternalization({
    artifactId,
    status: 'external',
    evidence: 'published',
    targets: [{ id: targetId, connector, status: 'linked', locator: `${connector}-${artifactId}` }],
  });
  return targetId;
}

function actionable(status: ReturnType<typeof getRewardStatus>, key: string): number {
  return status.stages.find((stage) => stage.key === key)!.actionable;
}

describe('reward status', () => {
  it('returns an empty read-only punch list for an empty database', () => {
    const status = getRewardStatus();

    expect(status.projectId).toBeNull();
    expect(status.stages.map((stage) => [stage.key, stage.actionable])).toEqual([
      ['profile', 0],
      ['curate', 0],
      ['finalize', 0],
      ['reconcile', 0],
      ['collect', 0],
      ['compare', 0],
    ]);
    expect(status.nextAction).toBeNull();
  });

  it('chooses profile as the leftmost action when projects need profiling', () => {
    upsertSession(session('codex:a'));

    const status = getRewardStatus();

    expect(actionable(status, 'profile')).toBe(1);
    expect(status.nextAction).toMatchObject({
      stage: 'profile',
      skill: 'superdense/reward/profile.md',
    });
  });

  it('chooses curate after the project profile is complete', () => {
    upsertSession(session('codex:a'));
    const projectId = profileProject();

    const status = getRewardStatus({ projectId });

    expect(actionable(status, 'profile')).toBe(0);
    expect(actionable(status, 'curate')).toBe(1);
    expect(status.nextAction).toMatchObject({
      stage: 'curate',
      command: `Read superdense/reward/curate.md for project ${projectId}`,
    });
  });

  it('chooses finalize for ready threads that are not artifacts yet', () => {
    createReadyThread('t1');

    const status = getRewardStatus();

    expect(actionable(status, 'finalize')).toBe(1);
    expect(status.nextAction).toMatchObject({ stage: 'finalize' });
  });

  it('chooses reconcile for finalized artifacts without completed externalization', () => {
    createArtifact('t1');

    const status = getRewardStatus();

    expect(actionable(status, 'reconcile')).toBe(1);
    expect(status.nextAction).toMatchObject({ stage: 'reconcile' });
  });

  it('chooses collect for linked targets without snapshots', () => {
    createArtifact('t1');
    linkArtifact('t1');

    const status = getRewardStatus();

    expect(actionable(status, 'collect')).toBe(1);
    expect(status.nextAction).toMatchObject({ stage: 'collect' });
  });

  it('unlocks compare when at least two cohort members have reward snapshots', () => {
    createArtifact('a1');
    createArtifact('a2');
    const t1 = linkArtifact('a1');
    const t2 = linkArtifact('a2');
    recordRewardSnapshot({ targetId: t1, metrics: { views: 10 }, primaryDim: 'views' });
    recordRewardSnapshot({ targetId: t2, metrics: { views: 20 }, primaryDim: 'views' });

    const status = getRewardStatus();

    expect(actionable(status, 'collect')).toBe(0);
    expect(actionable(status, 'compare')).toBe(2);
    expect(status.nextAction).toMatchObject({
      stage: 'compare',
      skill: 'superdense/reward/compare.md',
    });
  });

  it('scopes project-sensitive stages to a requested project', () => {
    createArtifact('a1', { pwd: '/repo/a' });
    createArtifact('b1', { pwd: '/repo/b' });
    linkArtifact('a1');
    linkArtifact('b1');
    const projectA = projectIdForPwd('/repo/a');

    const status = getRewardStatus({ projectId: projectA });

    expect(status.projectId).toBe(projectA);
    expect(actionable(status, 'collect')).toBe(1);
  });

  it('scopes finalize and reconcile counts to a requested project', () => {
    const projectA = createReadyThread('ready-a', { pwd: '/repo/a' });
    createReadyThread('ready-b', { pwd: '/repo/b' });
    createArtifact('artifact-a', { pwd: '/repo/a' });
    createArtifact('artifact-b', { pwd: '/repo/b' });

    const status = getRewardStatus({ projectId: projectA });

    expect(actionable(status, 'finalize')).toBe(1);
    expect(actionable(status, 'reconcile')).toBe(1);
  });
});

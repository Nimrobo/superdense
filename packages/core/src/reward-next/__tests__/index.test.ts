import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../paths.js', () => ({
  DB_PATH: ':memory:',
  SUPERDENSE_HOME: '/tmp/superdense-reward-next-test',
  GROUPS_DIR: '/tmp/superdense-reward-next-test/queries',
  USER_FILTERS_DIR: '/tmp/superdense-reward-next-test/filters',
  LEGACY_USER_FILTERS_DIR: '/tmp/superdense-reward-next-test/plugins',
  USER_ENRICHERS_DIR: '/tmp/superdense-reward-next-test/enrichers',
  ensureSuperdenseDirs: vi.fn(),
}));

import { _resetDbForTests, upsertSession } from '../../db.js';
import { applyCurationBatch, finalizeArtifact } from '../../curation/index.js';
import { assessExternalization } from '../../externalization/index.js';
import { applyProjectProfilePatch, listProjectProfiles } from '../../projects/index.js';
import { getRewardNext } from '../index.js';
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

function projectIdForPwd(pwd = '/repo'): string {
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

function createArtifact(id: string): string {
  const sessionId = `codex:${id}`;
  upsertSession(session(sessionId));
  const projectId = profileProject();
  applyCurationBatch({
    actions: [
      { type: 'thread.create', id, projectProfileId: projectId, provisionalTitle: `${id} title` },
      { type: 'thread.attach', threadId: id, sessionId, role: 'contributor' },
      { type: 'session.consume', sessionId },
      { type: 'thread.mark-ready', threadId: id, rationale: 'ready' },
    ],
  });
  finalizeArtifact({ threadId: id, type: 'launch', title: `${id} launch`, payload: { text: id } });
  return projectId;
}

function linkArtifact(artifactId: string): string {
  const targetId = `${artifactId}-x`;
  assessExternalization({
    artifactId,
    status: 'external',
    evidence: 'published',
    targets: [{ id: targetId, connector: 'x', status: 'linked', locator: `x-${artifactId}` }],
  });
  return targetId;
}

describe('reward next', () => {
  it('plans only actionable maintenance stages and never includes compare', () => {
    // A finalized-but-unreconciled artifact makes reconcile the actionable stage.
    const projectId = createArtifact('t1');

    const next = getRewardNext({ projectId, items: 10 });

    expect(next.projectId).toBe(projectId);
    expect(next.steps.map((step) => step.stage)).toEqual(['reconcile']);
    expect(next.steps.every((step) => step.stage !== 'compare')).toBe(true);
    expect(next.steps[0]).toMatchObject({
      stage: 'reconcile',
      actionable: 1,
      take: 1,
      command: expect.stringContaining('Read superdense/reward/reconcile.md'),
    });
  });

  it('returns the project name and roots', () => {
    const projectId = createArtifact('t1');

    const next = getRewardNext({ projectId, items: 10 });

    expect(next.projectName).toBe('Project /repo');
    expect(next.projectRoots).toEqual(['/repo']);
  });

  it('defaults the item budget to 10', () => {
    const projectId = createArtifact('t1');

    const next = getRewardNext({ projectId });
    expect(next.steps).toEqual([expect.objectContaining({ stage: 'reconcile', take: 1 })]);
  });

  it('budgets actionable items across stages, splitting take by remaining budget', () => {
    const projectId = createArtifact('t1');
    createArtifact('t2');
    createArtifact('t3');
    linkArtifact('t1'); // t1 leaves reconcile and becomes a collectable target
    // reconcile: t2, t3 (2 actionable). collect: t1 (1 actionable).

    const budgeted = getRewardNext({ projectId, items: 2 });
    expect(budgeted.steps).toEqual([
      expect.objectContaining({ stage: 'reconcile', actionable: 2, take: 2 }),
    ]);

    const more = getRewardNext({ projectId, items: 3 });
    expect(more.steps).toEqual([
      expect.objectContaining({ stage: 'reconcile', actionable: 2, take: 2 }),
      expect.objectContaining({ stage: 'collect', actionable: 1, take: 1 }),
    ]);
  });

  it('retires non-located targets past the window before counting reconcile', () => {
    const projectId = createArtifact('t1');
    assessExternalization({
      artifactId: 't1',
      status: 'external',
      evidence: 'assessed but unlocatable',
      targets: [{ id: 't1-x', connector: 'x', status: 'needs_connector' }],
    });

    const before = getRewardNext({ projectId, items: 10 });
    expect(before.steps.map((step) => step.stage)).toContain('reconcile');

    // Advance past the 7-day retirement window; the next plan retires it first.
    clock += 604_800_000;
    const after = getRewardNext({ projectId, items: 10 });
    expect(after.steps.map((step) => step.stage)).not.toContain('reconcile');
  });

  it('memoizes the last run: null first, prior timestamp afterwards', () => {
    const projectId = createArtifact('t1');

    const first = getRewardNext({ projectId, items: 10 });
    expect(first.lastRunAt).toBeNull();

    const second = getRewardNext({ projectId, items: 10 });
    expect(second.lastRunAt).toBeGreaterThan(0);
  });

  it('requires a project id', () => {
    expect(() => getRewardNext({ projectId: '' })).toThrow(/project/i);
  });
});

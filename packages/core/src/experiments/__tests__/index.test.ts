import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../paths.js', () => ({
  DB_PATH: ':memory:',
  SUPERDENSE_HOME: '/tmp/superdense-experiments-test',
  GROUPS_DIR: '/tmp/superdense-experiments-test/queries',
  USER_FILTERS_DIR: '/tmp/superdense-experiments-test/filters',
  LEGACY_USER_FILTERS_DIR: '/tmp/superdense-experiments-test/plugins',
  USER_ENRICHERS_DIR: '/tmp/superdense-experiments-test/enrichers',
  ensureSuperdenseDirs: vi.fn(),
}));

import { _resetDbForTests, upsertSession } from '../../db.js';
import { applyCurationBatch, finalizeArtifact } from '../../curation/index.js';
import { assessExternalization } from '../../externalization/index.js';
import { listProjectProfiles } from '../../projects/index.js';
import { recordRewardSnapshot } from '../../rewards/index.js';
import { recordHypothesis, type HypothesisStatement } from '../../hypotheses/index.js';
import {
  addExperimentMember,
  getExperiment,
  openExperiment,
  renderExperimentVerdict,
} from '../index.js';
import type { Session } from '../../types.js';

const statement: HypothesisStatement = {
  action: 'Publish two concrete operator pain posts',
  diagnostic: { metric: 'bookmark_rate', direction: 'increase', magnitude: 10 },
  northStar: { metric: 'qualified_follows', direction: 'increase', magnitude: 5 },
  window: { durationMs: 1000, label: 'same day' },
  mechanism: 'More specific pain should attract operators who save and follow.',
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

function projectIdForKey(projectKey: string): string {
  upsertSession({
    ...session(`codex:project-${projectKey.replace(/[^a-z0-9]+/gi, '-')}`),
    pwd: projectKey,
    projectKey,
  });
  return listProjectProfiles().find((profile) => profile.projectKey === projectKey)!.id;
}

function createArtifact(id: string, projectProfileId = listProjectProfiles()[0]!.id): void {
  const sessionId = `codex:${id}`;
  upsertSession(session(sessionId));
  applyCurationBatch({
    actions: [
      {
        type: 'thread.create',
        id,
        projectProfileId,
        provisionalTitle: `${id} title`,
      },
      { type: 'thread.attach', threadId: id, sessionId, role: 'contributor' },
      { type: 'session.consume', sessionId },
      { type: 'thread.finalize', threadId: id },
    ],
  });
  finalizeArtifact({ threadId: id, type: 'post', payload: { text: id } });
}

function linkArtifact(
  id: string,
  targetId = `${id}-target`,
  projectProfileId?: string,
): string {
  createArtifact(id, projectProfileId);
  assessExternalization({
    artifactId: id,
    status: 'external',
    evidence: 'Published post',
    targets: [{ id: targetId, connector: 'x', status: 'linked', locator: `post-${id}` }],
  });
  return targetId;
}

function hypothesisId(): string {
  const project = projectId();
  return recordHypothesis({
    id: 'h1',
    projectId: project,
    leverKey: 'topic-specificity',
    statement,
    createdAt: 100,
  }).hypothesis.id;
}

beforeEach(() => {
  _resetDbForTests();
});

afterEach(() => {
  _resetDbForTests();
});

describe('experiments', () => {
  it('opens an experiment and records artifact members', () => {
    const hypothesis = hypothesisId();
    const experiment = openExperiment({
      id: 'e1',
      hypothesisId: hypothesis,
      targetReps: 2,
      rewardWindow: { startAt: 0, endAt: 500, label: 'seeded window' },
      createdAt: 100,
    }).experiment;
    linkArtifact('a1');

    const result = addExperimentMember({
      experimentId: experiment.id,
      runId: '2026-06-19-topic-a1',
      artifactId: 'a1',
      role: 'rep',
      addedAt: 200,
    });

    expect(result.experiment).toMatchObject({
      id: 'e1',
      hypothesisId: hypothesis,
      status: 'open',
      members: [{ runId: '2026-06-19-topic-a1', artifactId: 'a1', role: 'rep' }],
    });
  });

  it('rejects artifact members from a different project than the hypothesis', () => {
    const firstProject = projectIdForKey('/repo-a');
    const secondProject = projectIdForKey('/repo-b');
    const hypothesis = recordHypothesis({
      id: 'h1',
      projectId: firstProject,
      leverKey: 'topic-specificity',
      statement,
      createdAt: 100,
    }).hypothesis.id;
    const experiment = openExperiment({
      id: 'e1',
      hypothesisId: hypothesis,
      targetReps: 1,
      rewardWindow: { startAt: 0, endAt: 500 },
      createdAt: 100,
    }).experiment;
    linkArtifact('other-project-artifact', 'other-project-target', secondProject);

    expect(() =>
      addExperimentMember({
        experimentId: experiment.id,
        runId: 'run-other-project',
        artifactId: 'other-project-artifact',
      }),
    ).toThrow('artifact not found: other-project-artifact');
  });

  it('supports a hypothesis when enough mature member rewards meet the prediction', () => {
    const hypothesis = hypothesisId();
    openExperiment({
      id: 'e1',
      hypothesisId: hypothesis,
      targetReps: 2,
      rewardWindow: { startAt: 0, endAt: 500 },
      createdAt: 100,
    });
    const first = linkArtifact('a1');
    const second = linkArtifact('a2');
    recordRewardSnapshot({
      targetId: first,
      capturedAt: 300,
      metrics: { bookmark_rate: 12, qualified_follows: 6 },
    });
    recordRewardSnapshot({
      targetId: second,
      capturedAt: 350,
      metrics: { bookmark_rate: 14, qualified_follows: 8 },
    });
    addExperimentMember({ experimentId: 'e1', runId: 'run-a1', artifactId: 'a1' });
    addExperimentMember({ experimentId: 'e1', runId: 'run-a2', artifactId: 'a2' });

    const result = renderExperimentVerdict('e1', { now: 600 });

    expect(result).toMatchObject({
      verdict: 'supported',
      resolved: true,
      experiment: { status: 'complete', verdict: 'supported', resolvedAt: 600 },
      hypothesis: { status: 'supported', resolvedAt: 600 },
    });
    expect(result.observedSummary).toMatchObject({
      memberCount: 2,
      targetReps: 2,
      windowMature: true,
      checks: {
        diagnostic: { pass: true },
        northStar: { pass: true },
      },
    });
  });

  it('does not prematurely resolve before target reps or reward-window maturity', () => {
    const hypothesis = hypothesisId();
    openExperiment({
      id: 'e1',
      hypothesisId: hypothesis,
      targetReps: 2,
      rewardWindow: { startAt: 0, endAt: 1000 },
      createdAt: 100,
    });
    const first = linkArtifact('a1');
    recordRewardSnapshot({
      targetId: first,
      capturedAt: 300,
      metrics: { bookmark_rate: 12, qualified_follows: 6 },
    });
    addExperimentMember({ experimentId: 'e1', runId: 'run-a1', artifactId: 'a1' });

    const result = renderExperimentVerdict('e1', { now: 600 });

    expect(result).toMatchObject({
      verdict: 'inconclusive',
      resolved: false,
      experiment: { status: 'open', verdict: null, resolvedAt: null },
      hypothesis: { status: 'open', resolvedAt: null },
    });
    expect(getExperiment('e1')!.observedSummary).toMatchObject({
      memberCount: 1,
      windowMature: false,
    });
  });

  it('uses rewardWindow.startAt when deriving duration-based maturity', () => {
    const hypothesis = hypothesisId();
    openExperiment({
      id: 'e1',
      hypothesisId: hypothesis,
      targetReps: 1,
      rewardWindow: { startAt: 1000, durationMs: 500 },
      createdAt: 100,
    });
    const targetId = linkArtifact('a1');
    recordRewardSnapshot({
      targetId,
      capturedAt: 1200,
      metrics: { bookmark_rate: 12, qualified_follows: 6 },
    });
    addExperimentMember({ experimentId: 'e1', runId: 'run-a1', artifactId: 'a1' });

    const early = renderExperimentVerdict('e1', { now: 600 });
    expect(early).toMatchObject({
      verdict: 'inconclusive',
      resolved: false,
      experiment: { status: 'open', verdict: null, resolvedAt: null },
      hypothesis: { status: 'open', resolvedAt: null },
    });
    expect(early.observedSummary).toMatchObject({
      windowMature: false,
      windowEndAt: 1500,
      matureAt: 1500,
    });

    const mature = renderExperimentVerdict('e1', { now: 1500 });
    expect(mature).toMatchObject({
      verdict: 'supported',
      resolved: true,
      experiment: { status: 'complete', verdict: 'supported', resolvedAt: 1500 },
      hypothesis: { status: 'supported', resolvedAt: 1500 },
    });
    expect(mature.observedSummary).toMatchObject({
      windowMature: true,
      windowStartAt: 1000,
      windowEndAt: 1500,
      matureAt: 1500,
    });
  });

  it('refutes a mature experiment when predictions miss', () => {
    const hypothesis = hypothesisId();
    openExperiment({
      id: 'e1',
      hypothesisId: hypothesis,
      targetReps: 1,
      rewardWindow: { startAt: 0, endAt: 500 },
      createdAt: 100,
    });
    const targetId = linkArtifact('a1');
    recordRewardSnapshot({
      targetId,
      capturedAt: 300,
      metrics: { bookmark_rate: 4, qualified_follows: 1 },
    });
    addExperimentMember({ experimentId: 'e1', runId: 'run-a1', artifactId: 'a1' });

    const result = renderExperimentVerdict('e1', { now: 600 });

    expect(result).toMatchObject({
      verdict: 'refuted',
      resolved: true,
      experiment: { status: 'complete', verdict: 'refuted' },
      hypothesis: { status: 'refuted' },
    });
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { RewardView } from './RewardView.js';
import * as apiModule from '../api.js';

vi.mock('../api.js', () => ({
  api: {
    rewardOverview: vi.fn(),
    listThreads: vi.fn(),
    listHypotheses: vi.fn(),
    listExperiments: vi.fn(),
    getArtifact: vi.fn(),
    getCohort: vi.fn(),
    listProjects: vi.fn(),
  },
}));

const artifactThread = {
  id: 'a1',
  projectProfileId: 'p1',
  provisionalTitle: 'Launch post',
  summary: 'Published launch copy',
  status: 'ready',
  createdAt: 1,
  updatedAt: 2,
  artifactType: 'launch',
  payload: { text: 'hello world' },
  artifactFinalizedAt: 2,
  readyAt: 1,
  readinessRationale: null,
  predecessorArtifactId: null,
  humanOnly: false,
  externalizationStatus: 'external',
  externalizationEvidence: null,
  externalizationUpdatedAt: 2,
  lifecycle: 'artifact',
} as apiModule.WorkThread;

const openThread = {
  ...artifactThread,
  id: 't-open',
  provisionalTitle: 'Draft grouping',
  summary: 'Still being grouped',
  artifactType: null,
  payload: null,
  artifactFinalizedAt: null,
  externalizationStatus: null,
  externalizationUpdatedAt: null,
  lifecycle: 'open',
} as apiModule.WorkThread;

const uncostedArtifactThread = {
  ...artifactThread,
  id: 'a2',
  provisionalTitle: 'Uncosted launch',
  payload: { text: 'no cost yet' },
} as apiModule.WorkThread;

const overview: apiModule.RewardOverview = {
  status: {
    projectId: null,
    stages: [
      { key: 'profile', label: 'Profile', unit: 'projects', actionable: 1, skill: 'profile.md' },
      { key: 'curate', label: 'Curate', unit: 'sessions', actionable: 3, skill: 'curate.md' },
      { key: 'finalize', label: 'Finalize', unit: 'threads', actionable: 1, skill: 'finalize.md' },
      {
        key: 'reconcile',
        label: 'Reconcile',
        unit: 'artifacts',
        actionable: 0,
        skill: 'reconcile.md',
      },
      { key: 'collect', label: 'Collect', unit: 'targets', actionable: 0, skill: 'collect.md' },
      { key: 'compare', label: 'Compare', unit: 'cohorts', actionable: 2, skill: 'compare.md' },
    ],
    nextAction: null,
  },
  actionQueue: [
    {
      stage: 'profile',
      label: 'Profile',
      unit: 'projects',
      actionable: 1,
      skill: 'profile.md',
      command: 'Read profile.md for project p2',
      why: '1 projects at Profile',
      projectId: 'p2',
    },
    {
      stage: 'compare',
      label: 'Compare',
      unit: 'cohorts',
      actionable: 2,
      skill: 'compare.md',
      command: 'Read compare.md for ready cohorts',
      why: '2 cohorts ready to compare',
      projectId: null,
    },
  ],
  projects: [
    {
      project: {
        id: 'p2',
        projectKey: '/new',
        status: 'unprofiled',
        coveredBy: null,
        name: null,
        description: null,
        roots: [],
        artifactShapes: [],
        evidenceSummary: [],
        notes: null,
        needsHumanAttention: false,
        attentionReasons: [],
        firstSeenAt: 1,
        lastSeenAt: 2,
        profiledAt: null,
        updatedAt: 2,
      },
      curation: {
        pending: 1,
        deferred: 0,
        consumed: 0,
        skipped: 0,
        remaining: 1,
        attachedConsumed: 0,
      },
      threads: { open: 0, ready: 0, artifact: 0, total: 0 },
      status: { projectId: 'p2', stages: [], nextAction: null },
      nextAction: null,
    },
    {
      project: {
        id: 'p1',
        projectKey: '/repo',
        status: 'profiled',
        coveredBy: null,
        name: 'Repo',
        description: 'A test repo',
        roots: ['/repo'],
        artifactShapes: [],
        evidenceSummary: ['Uses launch artifacts'],
        notes: null,
        needsHumanAttention: false,
        attentionReasons: [],
        firstSeenAt: 1,
        lastSeenAt: 2,
        profiledAt: 2,
        updatedAt: 2,
      },
      curation: {
        pending: 3,
        deferred: 1,
        consumed: 4,
        skipped: 2,
        remaining: 4,
        attachedConsumed: 3,
      },
      threads: { open: 1, ready: 0, artifact: 1, total: 2 },
      status: {
        projectId: 'p1',
        stages: [
          { key: 'profile', label: 'Profile', unit: 'projects', actionable: 0, skill: 'profile.md' },
          { key: 'curate', label: 'Curate', unit: 'sessions', actionable: 3, skill: 'curate.md' },
          { key: 'finalize', label: 'Finalize', unit: 'threads', actionable: 1, skill: 'finalize.md' },
          {
            key: 'reconcile',
            label: 'Reconcile',
            unit: 'artifacts',
            actionable: 0,
            skill: 'reconcile.md',
          },
          { key: 'collect', label: 'Collect', unit: 'targets', actionable: 0, skill: 'collect.md' },
          { key: 'compare', label: 'Compare', unit: 'cohorts', actionable: 0, skill: 'compare.md' },
        ],
        nextAction: {
          stage: 'curate',
          skill: 'curate.md',
          command: 'Read curate.md for project p1',
          why: '3 sessions at Curate',
        },
      },
      nextAction: {
        stage: 'curate',
        skill: 'curate.md',
        command: 'Read curate.md for project p1',
        why: '3 sessions at Curate',
      },
    },
  ],
  typeSummaries: [
    {
      type: 'launch',
      connector: null,
      artifactCount: 2,
      externalizedCount: 1,
      withRewardsCount: 1,
    },
  ],
};

const hypothesis: apiModule.Hypothesis = {
  id: 'h1',
  projectId: 'p1',
  leverKey: 'launch-copy',
  statement: {
    action: 'Clarify launch CTA',
    diagnostic: { metric: 'clicks', direction: 'increase', magnitude: 10 },
    northStar: { metric: 'signups', direction: 'increase', magnitude: 2 },
    window: { durationMs: 604800000, label: '7 days' },
    mechanism: 'A clearer CTA should move more readers into signup.',
  },
  status: 'open',
  createdAt: 1,
  resolvedAt: null,
  verdictEvidence: null,
};

const experiment: apiModule.Experiment = {
  id: 'e1',
  hypothesisId: 'h1',
  status: 'complete',
  targetReps: 2,
  rewardWindow: { startAt: 1, endAt: 10, durationMs: null, label: '7 days' },
  predictedSummary: 'Clicks and signups should increase.',
  observedSummary: {
    reason: 'all predictions passed',
    checks: { diagnostic: { pass: true }, northStar: { pass: true } },
  },
  verdict: 'supported',
  createdAt: 1,
  resolvedAt: 10,
  members: [
    { experimentId: 'e1', runId: 'run-1', artifactId: 'a1', role: 'rep', addedAt: 2 },
  ],
};

const artifactDetail: {
  artifact: apiModule.WorkThread;
  externalization: apiModule.ArtifactExternalization;
  rewards: apiModule.ArtifactRewards;
} = {
  artifact: artifactThread,
  externalization: {
    artifactId: 'a1',
    status: 'linked',
    conclusion: 'external',
    evidence: 'published',
    updatedAt: 2,
    targets: [
      {
        id: 'target-1',
        artifactId: 'a1',
        connector: 'x',
        status: 'linked',
        locator: 'https://example.com/post',
        evidence: null,
        createdAt: 2,
        updatedAt: 2,
      },
    ],
  },
  rewards: {
    artifactId: 'a1',
    targets: [
      {
        targetId: 'target-1',
        connector: 'x',
        locator: 'https://example.com/post',
        latest: null,
        snapshots: [],
      },
    ],
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
  vi.mocked(apiModule.api.rewardOverview).mockResolvedValue(overview);
  vi.mocked(apiModule.api.listThreads).mockResolvedValue({ items: [artifactThread, openThread] });
  vi.mocked(apiModule.api.listHypotheses).mockResolvedValue({ items: [hypothesis] });
  vi.mocked(apiModule.api.listExperiments).mockResolvedValue({ items: [experiment] });
  vi.mocked(apiModule.api.getArtifact).mockResolvedValue(artifactDetail);
  vi.mocked(apiModule.api.getCohort).mockResolvedValue({
    cohort: {
      type: 'launch',
      connector: null,
      projectId: null,
      members: [
        {
          artifact: artifactThread,
          externalization: artifactDetail.externalization,
          rewards: artifactDetail.rewards,
          cost: {
            contributorSessionIds: ['codex:a1'],
            contributors: [
              {
                sessionId: 'codex:a1',
                totalCostingWithSubagents: {
                  estimatedCostUsd: 0.012345,
                  pricingStatus: 'partial',
                  tokenTotals: {
                    inputTokens: 1000,
                    cachedInputTokens: 0,
                    cacheCreationInputTokens: 0,
                    cacheCreation5mInputTokens: 0,
                    cacheCreation1hInputTokens: 0,
                    outputTokens: 100,
                    reasoningOutputTokens: 0,
                    totalTokens: 1100,
                  },
                  unpricedModels: ['openai:unknown'],
                  sessionCount: 1,
                  pricedSessionCount: 1,
                },
              },
            ],
            totalCostingWithSubagents: {
              estimatedCostUsd: 0.012345,
              pricingStatus: 'partial',
              tokenTotals: {
                inputTokens: 1000,
                cachedInputTokens: 0,
                cacheCreationInputTokens: 0,
                cacheCreation5mInputTokens: 0,
                cacheCreation1hInputTokens: 0,
                outputTokens: 100,
                reasoningOutputTokens: 0,
                totalTokens: 1100,
              },
              unpricedModels: ['openai:unknown'],
              sessionCount: 1,
              pricedSessionCount: 1,
            },
          },
        },
        {
          artifact: uncostedArtifactThread,
          externalization: null,
          rewards: { artifactId: 'a2', targets: [] },
          cost: null,
        },
      ],
    },
  });
  vi.mocked(apiModule.api.listProjects).mockResolvedValue({
    items: overview.projects.map((project) => project.project),
  });
});

afterEach(cleanup);

describe('RewardView', () => {
  it('renders concepts first, then the pending pipeline with hidden copyable prompts', async () => {
    const { container } = render(<RewardView onOpenSession={vi.fn()} />);

    await waitFor(() => screen.getByText('Concepts'));
    const concepts = screen.getByText('Concepts');
    const pipeline = screen.getByText('Pending Pipeline');
    expect(
      concepts.compareDocumentPosition(pipeline) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.queryByText(/Read profile.md/)).toBeNull();
    expect(screen.queryByText(/Read compare.md/)).toBeNull();
    expect(screen.getByText('1 project profile pending')).toBeDefined();
    expect(screen.getByText('3 session curation pending')).toBeDefined();
    expect(container.querySelector('.pending-pipeline-count')).toBeNull();
    expect(screen.queryByText('1 projects at Profile')).toBeNull();
    expect(screen.queryByText('Compare')).toBeNull();
    expect(screen.queryByText(/cohorts ready/)).toBeNull();
    fireEvent.click(screen.getAllByText('Copy Prompt')[0]);
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('Read profile.md for project p2');
    expect(screen.getByText('Projects')).toBeDefined();
    expect(screen.getByText('Rewards by Type')).toBeDefined();
    expect(screen.getByText('launch')).toBeDefined();
    expect(screen.queryByText('Repo')).toBeNull();
    expect(container.querySelector('.type-list')).toBeTruthy();
  });

  it('opens a separate projects page, then a project detail with folded artifacts', async () => {
    render(<RewardView onOpenSession={vi.fn()} />);

    await waitFor(() => screen.getByText('Project progress'));
    fireEvent.click(screen.getByText('Project progress'));

    await waitFor(() => screen.getByText('Repo'));
    fireEvent.click(screen.getByText('Repo'));

    await waitFor(() => screen.getByText('Reward Pipeline'));
    expect(apiModule.api.listThreads).not.toHaveBeenCalledWith({ projectId: 'p1' });
    expect(apiModule.api.listHypotheses).toHaveBeenCalledWith({ projectId: 'p1' });
    expect(apiModule.api.listExperiments).toHaveBeenCalledWith({ projectId: 'p1' });
    expect(screen.getByText('Curate')).toBeDefined();
    expect(screen.getByRole('button', { name: /Clarify launch CTA/ })).toBeDefined();
    expect(screen.getByText('Select a hypothesis to view its experiments.')).toBeDefined();
    expect(screen.queryByText('Clicks and signups should increase.')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /Clarify launch CTA/ }));

    expect(screen.getAllByText('Clarify launch CTA')).toHaveLength(2);
    expect(screen.getByText('Clicks and signups should increase.')).toBeDefined();
    expect(screen.getByText(/run-1/)).toBeDefined();
    expect(screen.getByText(/all predictions passed/)).toBeDefined();
    expect(screen.queryByText('Profile and Review Progress')).toBeNull();
    expect(screen.queryByText('Open Workthreads')).toBeNull();
    expect(screen.queryByText('Artifacts')).toBeNull();
    expect(screen.queryByText('Folded artifact')).toBeNull();
  });

  it('opens a reward type detail focused on reward comparison', async () => {
    render(<RewardView onOpenSession={vi.fn()} />);

    await waitFor(() => screen.getByText('launch'));
    fireEvent.click(screen.getByText('launch'));

    await waitFor(() => screen.getByText('Comparison Readiness'));
    expect(apiModule.api.getCohort).toHaveBeenCalledWith('launch');
    expect(screen.getByText('not compare ready')).toBeDefined();
    expect(screen.getByText('https://example.com/post')).toBeDefined();
    expect(screen.getByText('$0.012 partial')).toBeDefined();
    expect(screen.queryByText('Cost $0.012 partial | 1.1K tokens | 1 contributor')).toBeNull();
    expect(screen.getByText('Uncosted launch')).toBeDefined();
  });
});

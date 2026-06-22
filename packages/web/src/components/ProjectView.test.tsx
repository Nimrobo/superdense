import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ProjectView } from './ProjectView.js';
import * as apiModule from '../api.js';

vi.mock('../api.js', () => ({
  api: {
    getProject: vi.fn(),
    getProjectRewardOverview: vi.fn(),
    listHypotheses: vi.fn(),
    listExperiments: vi.fn(),
    setProjectAttention: vi.fn(),
  },
}));

const project: apiModule.Project = {
  id: 'p1',
  projectKey: '/repo/video',
  status: 'profiled',
  coveredBy: null,
  name: 'Videos',
  description: 'Rendered launch videos',
  roots: ['/repo/video'],
  artifactShapes: [
    {
      type: 'video',
      detector: { kind: 'folder-leaf', include: ['showcase/*'] },
      outputHint: { globs: ['finals/*.mp4'] },
    },
  ],
  evidenceSummary: ['Scene folders and rendered MP4 files'],
  notes: null,
  needsHumanAttention: true,
  attentionReasons: ['Confirm launch folder coverage'],
  firstSeenAt: 1,
  lastSeenAt: 2,
  profiledAt: 2,
  updatedAt: 2,
  coveredProjects: [],
};

const rewardOverview: apiModule.RewardProjectOverview = {
  project,
  curation: {
    pending: 1,
    consumed: 2,
    skipped: 1,
    deferred: 0,
    remaining: 1,
    attachedConsumed: 2,
  },
  threads: { open: 1, ready: 1, artifact: 2, total: 4 },
  status: {
    projectId: 'p1',
    stages: [
      {
        key: 'profile',
        label: 'Profile',
        unit: 'projects',
        actionable: 0,
        skill: 'profile.md',
      },
      { key: 'curate', label: 'Curate', unit: 'sessions', actionable: 1, skill: 'curate.md' },
      {
        key: 'finalize',
        label: 'Finalize',
        unit: 'threads',
        actionable: 1,
        skill: 'finalize.md',
      },
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
      why: '1 session at Curate',
    },
  },
  nextAction: {
    stage: 'curate',
    skill: 'curate.md',
    command: 'Read curate.md for project p1',
    why: '1 session at Curate',
  },
};

const hypothesis: apiModule.Hypothesis = {
  id: 'h1',
  projectId: 'p1',
  leverKey: 'onboarding',
  statement: {
    action: 'Clarify onboarding copy',
    diagnostic: { metric: 'activation', direction: 'increase', magnitude: 0.1 },
    northStar: { metric: 'retention', direction: 'increase', magnitude: 0.05 },
    window: { durationMs: 604800000, label: '7 days' },
    mechanism: 'Clearer first-run guidance should reduce confusion.',
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
  predictedSummary: 'Activation and retention should increase.',
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

const writeText = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText },
  });
  vi.mocked(apiModule.api.getProject).mockResolvedValue({
    project,
    redirectedFrom: 'alias',
  });
  vi.mocked(apiModule.api.getProjectRewardOverview).mockResolvedValue({ item: rewardOverview });
  vi.mocked(apiModule.api.listHypotheses).mockResolvedValue({ items: [hypothesis] });
  vi.mocked(apiModule.api.listExperiments).mockResolvedValue({ items: [experiment] });
  vi.mocked(apiModule.api.setProjectAttention).mockResolvedValue({
    project: { ...project, needsHumanAttention: false, attentionReasons: [] },
  });
});

afterEach(cleanup);

describe('ProjectView', () => {
  it('renders profile details, redirects aliases, copies the skill instruction, and resolves attention', async () => {
    render(<ProjectView id="alias" onBack={vi.fn()} />);
    await waitFor(() => screen.getByText('Videos'));
    expect(screen.getByText(/redirects to its canonical profile/)).toBeDefined();
    expect(screen.getByText('video')).toBeDefined();
    expect(screen.getByText(/finals\/\*\.mp4/)).toBeDefined();
    await waitFor(() => screen.getByText('Reward Pipeline'));
    expect(apiModule.api.getProjectRewardOverview).toHaveBeenCalledWith('p1');
    expect(apiModule.api.listHypotheses).toHaveBeenCalledWith({ projectId: 'p1' });
    expect(apiModule.api.listExperiments).toHaveBeenCalledWith({ projectId: 'p1' });
    expect(screen.getByRole('button', { name: /Clarify onboarding copy/ })).toBeDefined();
    expect(screen.getByText('Select a hypothesis to view its experiments.')).toBeDefined();
    expect(screen.queryByText('Activation and retention should increase.')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /Clarify onboarding copy/ }));
    expect(screen.getAllByText('Clarify onboarding copy')).toHaveLength(2);
    expect(screen.getByText('Activation and retention should increase.')).toBeDefined();
    expect(screen.getByText(/run-1/)).toBeDefined();
    expect(screen.getByText(/all predictions passed/)).toBeDefined();

    fireEvent.click(screen.getByText('Copy profiling instruction'));
    expect(writeText).toHaveBeenCalledWith('Read superdense/reward/profile.md for project p1');

    fireEvent.click(screen.getByText('Copy next action'));
    expect(writeText).toHaveBeenCalledWith('Read curate.md for project p1');

    fireEvent.click(screen.getByText('Resolve attention'));
    await waitFor(() =>
      expect(apiModule.api.setProjectAttention).toHaveBeenCalledWith('p1', false, undefined),
    );
  });

  it('renders empty states for projects without hypotheses or experiments', async () => {
    vi.mocked(apiModule.api.listHypotheses).mockResolvedValue({ items: [] });
    vi.mocked(apiModule.api.listExperiments).mockResolvedValue({ items: [] });

    render(<ProjectView id="p1" onBack={vi.fn()} />);

    await waitFor(() => screen.getByText('No hypotheses recorded for this project.'));
    expect(screen.getByText('Select a hypothesis to view its experiments.')).toBeDefined();
  });

  it('shows a detail fetch error without hiding the project profile', async () => {
    vi.mocked(apiModule.api.listExperiments).mockRejectedValue(new Error('boom'));

    render(<ProjectView id="p1" onBack={vi.fn()} />);

    await waitFor(() => screen.getByText('Videos'));
    await waitFor(() => screen.getByText(/Failed to load project reward data: boom/));
    expect(screen.getByText('Profile status')).toBeDefined();
  });
});

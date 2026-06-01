import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ProjectView } from './ProjectView.js';
import * as apiModule from '../api.js';

vi.mock('../api.js', () => ({
  api: {
    getProject: vi.fn(),
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
  vi.mocked(apiModule.api.setProjectAttention).mockResolvedValue({
    project: { ...project, needsHumanAttention: false, attentionReasons: [] },
  });
});

afterEach(cleanup);

describe('ProjectView', () => {
  it('renders profile details, redirects aliases, copies the skill command, and resolves attention', async () => {
    render(<ProjectView id="alias" onBack={vi.fn()} />);
    await waitFor(() => screen.getByText('Videos'));
    expect(screen.getByText(/redirects to its canonical profile/)).toBeDefined();
    expect(screen.getByText('video')).toBeDefined();
    expect(screen.getByText(/finals\/\*\.mp4/)).toBeDefined();

    fireEvent.click(screen.getByText('Copy profiling command'));
    expect(writeText).toHaveBeenCalledWith('/superdense-project-profile p1');

    fireEvent.click(screen.getByText('Resolve attention'));
    await waitFor(() =>
      expect(apiModule.api.setProjectAttention).toHaveBeenCalledWith('p1', false, undefined),
    );
  });
});

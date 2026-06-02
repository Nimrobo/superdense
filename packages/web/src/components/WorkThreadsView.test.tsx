import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { WorkThreadsView } from './WorkThreadsView.js';
import * as apiModule from '../api.js';

vi.mock('../api.js', () => ({
  api: {
    listProjects: vi.fn(),
    listThreads: vi.fn(),
  },
}));

const project: apiModule.ProjectSummary = {
  id: 'p1',
  projectKey: '/repo/videos',
  status: 'profiled',
  coveredBy: null,
  name: 'Videos',
  description: null,
  roots: ['/repo/videos'],
  artifactShapes: [],
  evidenceSummary: [],
  notes: null,
  needsHumanAttention: false,
  attentionReasons: [],
  firstSeenAt: 1,
  lastSeenAt: 2,
  profiledAt: 2,
  updatedAt: 2,
};

const thread = (
  id: string,
  lifecycle: apiModule.ThreadLifecycle,
  title: string,
): apiModule.WorkThread => ({
  id,
  projectProfileId: 'p1',
  provisionalTitle: title,
  summary: `${title} summary`,
  status: lifecycle === 'open' ? 'open' : 'ready',
  createdAt: 1,
  updatedAt: 2,
  artifactType: lifecycle === 'artifact' ? 'video' : null,
  payload: lifecycle === 'artifact' ? { files: ['final.mp4'] } : null,
  artifactFinalizedAt: lifecycle === 'artifact' ? 3 : null,
  readyAt: lifecycle === 'ready' ? 3 : null,
  readinessRationale: lifecycle === 'ready' ? 'output is clear' : null,
  predecessorArtifactId: null,
  lifecycle,
});

const threads = [
  thread('draft-1', 'open', 'Draft thread'),
  thread('ready-1', 'ready', 'Ready thread'),
  thread('artifact-1', 'artifact', 'Artifact thread'),
];

const writeText = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText },
  });
  vi.mocked(apiModule.api.listProjects).mockResolvedValue({ items: [project] });
  vi.mocked(apiModule.api.listThreads).mockResolvedValue({ items: threads });
});

afterEach(cleanup);

function Harness({ onOpen = vi.fn() }: { onOpen?: (id: string) => void }) {
  const [projectId, setProjectId] = useState<string | undefined>();
  return <WorkThreadsView projectId={projectId} onProjectChange={setProjectId} onOpen={onOpen} />;
}

describe('WorkThreadsView', () => {
  it('groups lifecycle states, filters by project, opens threads, and copies finalize commands', async () => {
    const onOpen = vi.fn();
    render(<Harness onOpen={onOpen} />);

    await waitFor(() => screen.getByText('Draft thread'));
    expect(screen.getByText('Drafts')).toBeDefined();
    expect(screen.getByText('Ready to create artifacts')).toBeDefined();
    expect(screen.getByText('Artifacts')).toBeDefined();
    expect(screen.getAllByText('Videos').length).toBeGreaterThan(0);

    fireEvent.click(screen.getByText('Draft thread'));
    expect(onOpen).toHaveBeenCalledWith('draft-1');

    fireEvent.click(screen.getByText('Copy artifact queue command'));
    expect(writeText).toHaveBeenCalledWith('/superdense-artifact-finalize');

    fireEvent.change(screen.getByLabelText('Project'), { target: { value: 'p1' } });
    await waitFor(() =>
      expect(apiModule.api.listThreads).toHaveBeenLastCalledWith({ projectId: 'p1' }),
    );
  });
});

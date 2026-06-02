import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { WorkThreadView } from './WorkThreadView.js';
import * as apiModule from '../api.js';

vi.mock('../api.js', () => ({
  api: {
    getThread: vi.fn(),
    listProjects: vi.fn(),
  },
}));

const artifactThread: apiModule.WorkThread = {
  id: 't1',
  projectProfileId: 'p1',
  provisionalTitle: 'Launch video',
  summary: 'Rendered launch asset',
  status: 'finalized',
  createdAt: 1,
  updatedAt: 2,
  artifactType: 'video',
  payload: { files: ['final.mp4'] },
  artifactFinalizedAt: 3,
  lifecycle: 'artifact',
  headSessionId: 'codex:two',
  sessions: [
    { sessionId: 'codex:one', role: 'evidence', rationale: 'initial research' },
    { sessionId: 'codex:two', role: 'contributor', rationale: 'rendered final asset' },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(apiModule.api.getThread).mockResolvedValue({ thread: artifactThread });
  vi.mocked(apiModule.api.listProjects).mockResolvedValue({
    items: [
      {
        id: 'p1',
        projectKey: '/repo/videos',
        status: 'profiled',
        coveredBy: null,
        name: 'Videos',
        description: null,
        roots: [],
        artifactShapes: [],
        evidenceSummary: [],
        notes: null,
        needsHumanAttention: false,
        attentionReasons: [],
        firstSeenAt: 1,
        lastSeenAt: 2,
        profiledAt: 2,
        updatedAt: 2,
      },
    ],
  });
});

afterEach(cleanup);

describe('WorkThreadView', () => {
  it('renders artifact payload and linked lineage sessions', async () => {
    const onOpenSession = vi.fn();
    render(<WorkThreadView id="t1" onBack={vi.fn()} onOpenSession={onOpenSession} />);

    await waitFor(() => screen.getByText('Launch video'));
    expect(screen.getByText('Videos')).toBeDefined();
    expect(screen.getByText('Frozen lineage')).toBeDefined();
    expect(screen.getByText(/final\.mp4/)).toBeDefined();
    expect(screen.getByText(/rendered final asset/)).toBeDefined();

    fireEvent.click(screen.getByText('codex:two'));
    expect(onOpenSession).toHaveBeenCalledWith('codex:two');
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { ArtifactsView } from './ArtifactsView.js';
import * as apiModule from '../api.js';

vi.mock('../api.js', () => ({
  api: {
    listArtifacts: vi.fn(),
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(apiModule.api.listArtifacts).mockResolvedValue({
    items: [
      {
        id: 'a1',
        projectProfileId: 'p1',
        provisionalTitle: 'Extracted artifact',
        summary: null,
        status: 'finalized',
        createdAt: 1,
        updatedAt: 2,
        artifactType: 'video',
        payload: { files: ['final.mp4'] },
        artifactFinalizedAt: 3,
        lifecycle: 'artifact',
      },
    ],
  });
});

afterEach(cleanup);

describe('ArtifactsView', () => {
  it('lists extracted artifacts without a ready-to-extract queue', async () => {
    render(<ArtifactsView onOpen={vi.fn()} />);
    await waitFor(() => screen.getByText('Extracted artifact'));
    expect(apiModule.api.listArtifacts).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Ready to extract')).toBeNull();
  });
});

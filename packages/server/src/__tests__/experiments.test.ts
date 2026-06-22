import { beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';

vi.mock('@nimrobo/superdense-core', () => ({
  getExperiment: vi.fn(),
  listExperiments: vi.fn(),
}));

import * as core from '@nimrobo/superdense-core';
import type { Experiment } from '@nimrobo/superdense-core';
import { registerExperimentsRoutes } from '../routes/experiments.js';

const experiment: Experiment = {
  id: 'e1',
  hypothesisId: 'h1',
  status: 'open',
  targetReps: 2,
  rewardWindow: { startAt: 1, endAt: 10, durationMs: null, label: 'window' },
  predictedSummary: 'Activation should increase.',
  observedSummary: null,
  verdict: null,
  createdAt: 1,
  resolvedAt: null,
  members: [
    {
      experimentId: 'e1',
      runId: 'run-1',
      artifactId: 'a1',
      role: 'rep',
      addedAt: 2,
    },
  ],
};

async function buildApp() {
  const app = Fastify();
  await registerExperimentsRoutes(app);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(core.listExperiments).mockReturnValue([experiment]);
  vi.mocked(core.getExperiment).mockReturnValue(experiment);
});

describe('experiment routes', () => {
  it('lists experiments with project, hypothesis, status, and limit filters', async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/api/experiments?projectId=p1&hypothesisId=h1&status=open&limit=10',
    });

    expect(response.statusCode).toBe(200);
    expect(core.listExperiments).toHaveBeenCalledWith({
      projectId: 'p1',
      hypothesisId: 'h1',
      status: 'open',
      limit: 10,
    });
    expect(response.json()).toEqual({ items: [experiment] });
  });

  it('rejects invalid list filters', async () => {
    const app = await buildApp();
    const badStatus = await app.inject({ method: 'GET', url: '/api/experiments?status=done' });
    const badLimit = await app.inject({ method: 'GET', url: '/api/experiments?limit=-1' });

    expect(badStatus.statusCode).toBe(400);
    expect(badStatus.json()).toEqual({ error: 'status must be open, complete, or inconclusive' });
    expect(badLimit.statusCode).toBe(400);
    expect(badLimit.json()).toEqual({ error: 'limit must be a non-negative integer' });
  });

  it('shows one experiment and returns 404 for missing ids', async () => {
    const app = await buildApp();
    const response = await app.inject({ method: 'GET', url: '/api/experiments/e1' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ experiment });

    vi.mocked(core.getExperiment).mockReturnValue(null);
    const missing = await app.inject({ method: 'GET', url: '/api/experiments/missing' });
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toEqual({ error: 'not found' });
  });
});

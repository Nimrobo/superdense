import { beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';

vi.mock('@nimrobo/superdense-core', () => ({
  getHypothesis: vi.fn(),
  listHypotheses: vi.fn(),
}));

import * as core from '@nimrobo/superdense-core';
import type { Hypothesis } from '@nimrobo/superdense-core';
import { registerHypothesesRoutes } from '../routes/hypotheses.js';

const hypothesis: Hypothesis = {
  id: 'h1',
  projectId: 'p1',
  leverKey: 'activation',
  statement: {
    action: 'Ship clearer onboarding',
    diagnostic: { metric: 'activation_rate', direction: 'increase', magnitude: 0.1 },
    northStar: { metric: 'retention', direction: 'increase', magnitude: 0.05 },
    window: { durationMs: 604800000, label: '7 days' },
    mechanism: 'Clearer onboarding should reduce first-run confusion.',
  },
  status: 'open',
  createdAt: 1,
  resolvedAt: null,
  verdictEvidence: null,
};

async function buildApp() {
  const app = Fastify();
  await registerHypothesesRoutes(app);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(core.listHypotheses).mockReturnValue([hypothesis]);
  vi.mocked(core.getHypothesis).mockReturnValue(hypothesis);
});

describe('hypothesis routes', () => {
  it('lists hypotheses with project, status, lever, and limit filters', async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/api/hypotheses?projectId=p1&status=open&leverKey=activation&limit=25',
    });

    expect(response.statusCode).toBe(200);
    expect(core.listHypotheses).toHaveBeenCalledWith({
      projectId: 'p1',
      status: 'open',
      leverKey: 'activation',
      limit: 25,
    });
    expect(response.json()).toEqual({ items: [hypothesis] });
  });

  it('rejects invalid list filters', async () => {
    const app = await buildApp();
    const badStatus = await app.inject({ method: 'GET', url: '/api/hypotheses?status=done' });
    const badLimit = await app.inject({ method: 'GET', url: '/api/hypotheses?limit=half' });

    expect(badStatus.statusCode).toBe(400);
    expect(badStatus.json()).toEqual({
      error: 'status must be open, supported, refuted, or inconclusive',
    });
    expect(badLimit.statusCode).toBe(400);
    expect(badLimit.json()).toEqual({ error: 'limit must be a non-negative integer' });
  });

  it('shows one hypothesis and returns 404 for missing ids', async () => {
    const app = await buildApp();
    const response = await app.inject({ method: 'GET', url: '/api/hypotheses/h1' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ hypothesis });

    vi.mocked(core.getHypothesis).mockReturnValue(null);
    const missing = await app.inject({ method: 'GET', url: '/api/hypotheses/missing' });
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toEqual({ error: 'not found' });
  });
});

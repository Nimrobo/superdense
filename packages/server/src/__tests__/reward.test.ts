import { beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';

vi.mock('@nimrobo/superdense-core', () => ({
  getRewardOverview: vi.fn(),
  getRewardStatus: vi.fn(),
}));

import * as core from '@nimrobo/superdense-core';
import { registerRewardRoutes } from '../routes/reward.js';

async function buildApp() {
  const app = Fastify();
  await registerRewardRoutes(app);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('reward routes', () => {
  it('exposes the reward overview', async () => {
    const overview = {
      status: { projectId: null, stages: [], nextAction: null },
      actionQueue: [],
      projects: [],
      typeSummaries: [],
    };
    vi.mocked(core.getRewardOverview).mockReturnValue(overview as never);

    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/reward/overview' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(overview);
    expect(core.getRewardOverview).toHaveBeenCalledWith();
  });

  it('exposes the reward-status punch list and forwards the projectId filter', async () => {
    const status = {
      projectId: 'p1',
      stages: [{ key: 'finalize', label: 'Finalize', unit: 'threads', actionable: 2, skill: 's' }],
      nextAction: null,
    };
    vi.mocked(core.getRewardStatus).mockReturnValue(status as never);

    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/reward/status?projectId=p1' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(status);
    expect(core.getRewardStatus).toHaveBeenCalledWith({ projectId: 'p1' });
  });

  it('returns 400 when the status computation throws', async () => {
    vi.mocked(core.getRewardStatus).mockImplementation(() => {
      throw new Error('project not found: bad');
    });
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/reward/status?projectId=bad' });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'project not found: bad' });
  });
});

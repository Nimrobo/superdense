import { vi, describe, it, expect, beforeEach } from 'vitest';
import Fastify from 'fastify';

vi.mock('@road42/core', () => ({
  getStatsTotals: vi.fn(),
  getMaxLastIndexedAt: vi.fn(),
  getSessionsPerDay: vi.fn(),
  getTopPwds: vi.fn(),
  getTopQueries: vi.fn(),
  getTopTools: vi.fn(),
  listRecentSessions: vi.fn(),
}));

import * as core from '@road42/core';
import { registerStatsRoutes } from '../routes/stats.js';

const mockTotals = {
  sessions: 10,
  sessionsLast7d: 3,
  distinctPwds: 4,
  distinctAgents: 2,
  queries: 1,
};

beforeEach(() => {
  vi.mocked(core.getStatsTotals).mockReturnValue(mockTotals);
  vi.mocked(core.getMaxLastIndexedAt).mockReturnValue(12345);
  vi.mocked(core.getSessionsPerDay).mockReturnValue([{ date: '2025-01-01', count: 5 }]);
  vi.mocked(core.getTopPwds).mockReturnValue([{ pwd: '/home/user', count: 3 }]);
  vi.mocked(core.getTopQueries).mockReturnValue([{ id: 'q1', name: 'Test', memberCount: 2 }]);
  vi.mocked(core.getTopTools).mockReturnValue([{ tool: 'bash', count: 10 }]);
  vi.mocked(core.listRecentSessions).mockReturnValue([]);
});

async function buildApp() {
  const app = Fastify();
  await registerStatsRoutes(app);
  return app;
}

describe('GET /api/stats', () => {
  it('returns 200 with all expected fields', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/stats' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.totals).toEqual(mockTotals);
    expect(body.lastIndexedAt).toBe(12345);
    expect(body.perDay).toHaveLength(1);
    expect(body.topPwds).toHaveLength(1);
    expect(body.topQueries).toHaveLength(1);
    expect(body.topTools).toHaveLength(1);
    expect(Array.isArray(body.recentSessions)).toBe(true);
  });

  it('calls db functions with correct arguments', async () => {
    const app = await buildApp();
    await app.inject({ method: 'GET', url: '/api/stats' });
    expect(core.getSessionsPerDay).toHaveBeenCalledWith(30);
    expect(core.getTopPwds).toHaveBeenCalledWith(5);
    expect(core.getTopQueries).toHaveBeenCalledWith(5);
    expect(core.getTopTools).toHaveBeenCalledWith(10);
    expect(core.listRecentSessions).toHaveBeenCalledWith(8);
  });

  it('returns null lastIndexedAt when nothing has been indexed', async () => {
    vi.mocked(core.getMaxLastIndexedAt).mockReturnValue(null);
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/stats' });
    expect(res.json().lastIndexedAt).toBeNull();
  });

  it('returns empty arrays when there is no data', async () => {
    vi.mocked(core.getSessionsPerDay).mockReturnValue([]);
    vi.mocked(core.getTopPwds).mockReturnValue([]);
    vi.mocked(core.getTopQueries).mockReturnValue([]);
    vi.mocked(core.getTopTools).mockReturnValue([]);
    vi.mocked(core.listRecentSessions).mockReturnValue([]);
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/stats' });
    const body = res.json();
    expect(body.perDay).toEqual([]);
    expect(body.topPwds).toEqual([]);
    expect(body.topQueries).toEqual([]);
    expect(body.topTools).toEqual([]);
    expect(body.recentSessions).toEqual([]);
  });

  it('returns 404 for unknown routes', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/other' });
    expect(res.statusCode).toBe(404);
  });
});

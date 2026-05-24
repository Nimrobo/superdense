import { beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';

vi.mock('@nimrobo/superdense-core', () => ({
  compactSession: vi.fn(),
  countSessions: vi.fn(),
  getCompactor: vi.fn(),
  getSession: vi.fn(),
  iterSessionEvents: vi.fn(),
  listSessions: vi.fn(),
}));

import * as core from '@nimrobo/superdense-core';
import type { Compactor } from '@nimrobo/superdense-core';
import { registerSessionsRoutes } from '../routes/sessions.js';

const session = {
  id: 'unknown:session-1',
  agent: 'unknown',
  sessionId: 'session-1',
  logPath: 'unknown-source',
  pwd: '/repo',
  projectKey: '/repo',
};

const traceCompactor: Compactor = {
  name: 'trace',
  kind: 'structural',
  targetBytes: 10000,
  description: 'Trace timeline',
  run: async () => ({}),
};

const salienceCompactor: Compactor = {
  name: 'salience',
  kind: 'semantic',
  targetBytes: 4000,
  description: 'Session salience',
  run: async () => ({}),
};

async function* emptyEvents() {
  // empty generator
}

async function buildApp() {
  const app = Fastify();
  await registerSessionsRoutes(app);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(core.countSessions).mockReturnValue(0);
  vi.mocked(core.listSessions).mockReturnValue([]);
  vi.mocked(core.getSession).mockReturnValue(session);
  vi.mocked(core.iterSessionEvents).mockReturnValue(emptyEvents());
  vi.mocked(core.getCompactor).mockImplementation((name) => {
    if (name === 'trace') return traceCompactor;
    if (name === 'salience') return salienceCompactor;
    return undefined;
  });
  vi.mocked(core.compactSession).mockImplementation(async (name) => ({ v: 1, name }));
});

describe('sessions routes', () => {
  it('streams transcripts through session-aware adapter dispatch', async () => {
    const app = await buildApp();

    const res = await app.inject({ method: 'GET', url: '/api/sessions/unknown%3Asession-1/transcript' });

    expect(res.statusCode).toBe(200);
    expect(core.iterSessionEvents).toHaveBeenCalledWith(session);
    expect(res.json()).toMatchObject({ items: [], missing: true });
  });

  it('runs the trace compactor for a session', async () => {
    const app = await buildApp();

    const res = await app.inject({ method: 'GET', url: '/api/sessions/unknown%3Asession-1/compactors/trace' });

    expect(res.statusCode).toBe(200);
    expect(core.compactSession).toHaveBeenCalledWith('trace', session);
    expect(res.json()).toMatchObject({
      session,
      compactor: { name: 'trace', kind: 'structural', targetBytes: 10000, description: 'Trace timeline' },
      result: { v: 1, name: 'trace' },
    });
  });

  it('runs the salience compactor for a session', async () => {
    const app = await buildApp();

    const res = await app.inject({ method: 'GET', url: '/api/sessions/unknown%3Asession-1/compactors/salience' });

    expect(res.statusCode).toBe(200);
    expect(core.compactSession).toHaveBeenCalledWith('salience', session);
    expect(res.json()).toMatchObject({
      compactor: { name: 'salience', kind: 'semantic', targetBytes: 4000, description: 'Session salience' },
      result: { v: 1, name: 'salience' },
    });
  });

  it('returns 404 for a missing compactor session', async () => {
    vi.mocked(core.getSession).mockReturnValue(null);
    const app = await buildApp();

    const res = await app.inject({ method: 'GET', url: '/api/sessions/missing/compactors/trace' });

    expect(res.statusCode).toBe(404);
    expect(core.compactSession).not.toHaveBeenCalled();
  });

  it('returns 404 for unsupported compactors', async () => {
    const app = await buildApp();

    const res = await app.inject({ method: 'GET', url: '/api/sessions/unknown%3Asession-1/compactors/other' });

    expect(res.statusCode).toBe(404);
    expect(core.compactSession).not.toHaveBeenCalled();
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';

vi.mock('@road42/core', () => ({
  countSessions: vi.fn(),
  getSession: vi.fn(),
  iterSessionEvents: vi.fn(),
  listSessions: vi.fn(),
}));

import * as core from '@road42/core';
import { registerSessionsRoutes } from '../routes/sessions.js';

const session = {
  id: 'unknown:session-1',
  agent: 'unknown',
  sessionId: 'session-1',
  logPath: 'unknown-source',
  pwd: '/repo',
  projectKey: '/repo',
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
  vi.mocked(core.countSessions).mockReturnValue(0);
  vi.mocked(core.listSessions).mockReturnValue([]);
  vi.mocked(core.getSession).mockReturnValue(session);
  vi.mocked(core.iterSessionEvents).mockReturnValue(emptyEvents());
});

describe('sessions routes', () => {
  it('streams transcripts through session-aware adapter dispatch', async () => {
    const app = await buildApp();

    const res = await app.inject({ method: 'GET', url: '/api/sessions/unknown%3Asession-1/transcript' });

    expect(res.statusCode).toBe(200);
    expect(core.iterSessionEvents).toHaveBeenCalledWith(session);
    expect(res.json()).toMatchObject({ items: [], missing: true });
  });
});

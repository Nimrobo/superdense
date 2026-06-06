import { beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';

vi.mock('@nimrobo/superdense-core', () => ({
  compactSession: vi.fn(),
  countSessions: vi.fn(),
  getCompactor: vi.fn(),
  getEnrichment: vi.fn(),
  getSession: vi.fn(),
  getSessionCost: vi.fn(),
  getSessionCostValue: vi.fn(),
  iterSessionEvents: vi.fn(),
  listSessions: vi.fn(),
  SYSTEM_RUN_ID: 'system',
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
  vi.mocked(core.getEnrichment).mockReturnValue(null);
  vi.mocked(core.getSessionCostValue).mockReturnValue(null);
  vi.mocked(core.getSessionCost).mockReturnValue({
    sessionId: session.id,
    self: null,
    directSubagents: [],
    totalWithSubagents: {
      estimatedCostUsd: null,
      pricingStatus: 'token_only',
      tokenTotals: {
        inputTokens: 0,
        cachedInputTokens: 0,
        cacheCreationInputTokens: 0,
        cacheCreation5mInputTokens: 0,
        cacheCreation1hInputTokens: 0,
        outputTokens: 0,
        reasoningOutputTokens: 0,
        totalTokens: 0,
      },
      unpricedModels: [],
      sessionCount: 0,
      pricedSessionCount: 0,
    },
  });
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

    const res = await app.inject({
      method: 'GET',
      url: '/api/sessions/unknown%3Asession-1/transcript',
    });

    expect(res.statusCode).toBe(200);
    expect(core.iterSessionEvents).toHaveBeenCalledWith(session);
    expect(res.json()).toMatchObject({ items: [], missing: true });
  });

  it('returns session cost with tree aggregation options', async () => {
    const app = await buildApp();

    const res = await app.inject({
      method: 'GET',
      url: '/api/sessions/unknown%3Asession-1/cost?tree=true&depth=3',
    });

    expect(res.statusCode).toBe(200);
    expect(core.getSessionCost).toHaveBeenCalledWith('unknown:session-1', {
      tree: true,
      depth: 3,
    });
    expect(res.json()).toMatchObject({ sessionId: 'unknown:session-1' });
  });

  it('decorates session responses with total cost including sub-agents when available', async () => {
    vi.mocked(core.getSessionCost).mockReturnValue({
      sessionId: session.id,
      self: null,
      directSubagents: [],
      totalWithSubagents: {
        estimatedCostUsd: 0.05,
        pricingStatus: 'estimated',
        tokenTotals: {
          inputTokens: 1000,
          cachedInputTokens: 0,
          cacheCreationInputTokens: 0,
          cacheCreation5mInputTokens: 0,
          cacheCreation1hInputTokens: 0,
          outputTokens: 200,
          reasoningOutputTokens: 0,
          totalTokens: 1200,
        },
        unpricedModels: [],
        sessionCount: 3,
        pricedSessionCount: 3,
      },
    });
    const app = await buildApp();

    const res = await app.inject({
      method: 'GET',
      url: '/api/sessions/unknown%3Asession-1',
    });

    expect(res.statusCode).toBe(200);
    expect(core.getSessionCost).toHaveBeenCalledWith(session.id, { tree: true });
    expect(res.json()).toMatchObject({ sessionCost: { estimatedCostUsd: 0.05, sessionCount: 3 } });
  });

  it('decorates session responses with workflow summary when available', async () => {
    vi.mocked(core.getEnrichment).mockReturnValue({
      version: 1,
      computedAt: 1,
      value: {
        v: 1,
        hasWorkflow: true,
        workflowRunCount: 1,
        workflowToolCallCount: 1,
        workflowEnabled: true,
        effort: 'ultracode',
        ultraEffort: true,
        totalAgents: 11,
        totalTokens: 356922,
        totalToolCalls: 83,
        runs: [],
      },
    });
    const app = await buildApp();

    const res = await app.inject({
      method: 'GET',
      url: '/api/sessions/unknown%3Asession-1',
    });

    expect(res.statusCode).toBe(200);
    expect(core.getEnrichment).toHaveBeenCalledWith(
      'unknown:session-1',
      'system',
      'workflow_summary',
    );
    expect(res.json()).toMatchObject({
      workflowSummary: { hasWorkflow: true, totalAgents: 11, effort: 'ultracode' },
    });
  });

  it('returns a null workflow summary when the enrichment has no workflow', async () => {
    vi.mocked(core.getEnrichment).mockReturnValue({
      version: 1,
      computedAt: 1,
      value: { v: 1, hasWorkflow: false, workflowRunCount: 0, runs: [] },
    });
    const app = await buildApp();

    const res = await app.inject({
      method: 'GET',
      url: '/api/sessions/unknown%3Asession-1',
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ workflowSummary: null });
  });

  it('runs the trace compactor for a session', async () => {
    const app = await buildApp();

    const res = await app.inject({
      method: 'GET',
      url: '/api/sessions/unknown%3Asession-1/compactors/trace',
    });

    expect(res.statusCode).toBe(200);
    expect(core.compactSession).toHaveBeenCalledWith('trace', session);
    expect(res.json()).toMatchObject({
      session,
      compactor: {
        name: 'trace',
        kind: 'structural',
        targetBytes: 10000,
        description: 'Trace timeline',
      },
      result: { v: 1, name: 'trace' },
    });
  });

  it('runs the salience compactor for a session', async () => {
    const app = await buildApp();

    const res = await app.inject({
      method: 'GET',
      url: '/api/sessions/unknown%3Asession-1/compactors/salience',
    });

    expect(res.statusCode).toBe(200);
    expect(core.compactSession).toHaveBeenCalledWith('salience', session);
    expect(res.json()).toMatchObject({
      compactor: {
        name: 'salience',
        kind: 'semantic',
        targetBytes: 4000,
        description: 'Session salience',
      },
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

    const res = await app.inject({
      method: 'GET',
      url: '/api/sessions/unknown%3Asession-1/compactors/other',
    });

    expect(res.statusCode).toBe(404);
    expect(core.compactSession).not.toHaveBeenCalled();
  });
});

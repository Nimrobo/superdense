import { beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';

vi.mock('@nimrobo/superdense-core', () => ({
  getArtifact: vi.fn(),
  getArtifactRewards: vi.fn(),
  getExternalization: vi.fn(),
  listArtifacts: vi.fn(),
  listExternalizations: vi.fn(),
}));

import * as core from '@nimrobo/superdense-core';
import { registerArtifactsRoutes } from '../routes/artifacts.js';

async function buildApp() {
  const app = Fastify();
  await registerArtifactsRoutes(app);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(core.listArtifacts).mockReturnValue([]);
  vi.mocked(core.listExternalizations).mockReturnValue([]);
  vi.mocked(core.getArtifact).mockReturnValue(null);
  vi.mocked(core.getExternalization).mockReturnValue(null);
  vi.mocked(core.getArtifactRewards).mockReturnValue(null);
});

describe('artifact routes', () => {
  it('annotates each list item with a derived externalization status', async () => {
    vi.mocked(core.listArtifacts).mockReturnValue([{ id: 'a1' }, { id: 'a2' }] as never);
    vi.mocked(core.listExternalizations).mockReturnValue([
      { artifactId: 'a1', status: 'linked' },
    ] as never);
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/artifacts' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      items: [
        { id: 'a1', externalizationStatus: 'linked' },
        { id: 'a2', externalizationStatus: 'unprocessed' },
      ],
    });
  });

  it('folds externalization and rewards into the artifact detail', async () => {
    vi.mocked(core.getArtifact).mockReturnValue({ id: 'a1' } as never);
    vi.mocked(core.getExternalization).mockReturnValue({
      artifactId: 'a1',
      status: 'linked',
      targets: [{ connector: 'x', locator: 'https://x.com/u/status/1' }],
    } as never);
    vi.mocked(core.getArtifactRewards).mockReturnValue({ artifactId: 'a1', targets: [] } as never);

    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/artifacts/a1' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.artifact).toEqual({ id: 'a1' });
    expect(body.externalization.status).toBe('linked');
    expect(body.externalization.targets[0].locator).toBe('https://x.com/u/status/1');
    expect(body.rewards).toEqual({ artifactId: 'a1', targets: [] });
  });

  it('returns 404 for a missing artifact', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/artifacts/missing' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'not found' });
  });
});

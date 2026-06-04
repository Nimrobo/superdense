import { beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';

vi.mock('@nimrobo/superdense-core', () => ({
  getProjectProfileResolution: vi.fn(),
  listProjectProfiles: vi.fn(),
  setProjectAttention: vi.fn(),
}));

import * as core from '@nimrobo/superdense-core';
import type { ProjectProfile } from '@nimrobo/superdense-core';
import { registerProjectsRoutes } from '../routes/projects.js';

const project: ProjectProfile = {
  id: 'p1',
  projectKey: '/repo',
  status: 'profiled',
  coveredBy: null,
  name: 'Repo',
  description: null,
  roots: ['/repo'],
  artifactShapes: [],
  evidenceSummary: [],
  notes: null,
  needsHumanAttention: false,
  attentionReasons: [],
  firstSeenAt: 1,
  lastSeenAt: 2,
  profiledAt: 2,
  updatedAt: 2,
  coveredProjects: [],
};

async function buildApp() {
  const app = Fastify();
  await registerProjectsRoutes(app);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(core.listProjectProfiles).mockReturnValue([project]);
  vi.mocked(core.getProjectProfileResolution).mockReturnValue({ project, redirectedFrom: null });
  vi.mocked(core.setProjectAttention).mockReturnValue(project);
});

describe('project routes', () => {
  it('lists action-needed projects', async () => {
    const app = await buildApp();
    const response = await app.inject({ method: 'GET', url: '/api/projects?needsAction=true' });
    expect(response.statusCode).toBe(200);
    expect(core.listProjectProfiles).toHaveBeenCalledWith({ needsAction: true });
    expect(response.json().items).toHaveLength(1);
  });

  it('returns covered-id resolution metadata', async () => {
    vi.mocked(core.getProjectProfileResolution).mockReturnValue({
      project,
      redirectedFrom: 'alias',
    });
    const app = await buildApp();
    const response = await app.inject({ method: 'GET', url: '/api/projects/alias' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ project: { id: 'p1' }, redirectedFrom: 'alias' });
  });

  it('updates and validates human attention', async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: 'PATCH',
      url: '/api/projects/p1/attention',
      payload: { needed: true, reasons: ['review roots'] },
    });
    expect(response.statusCode).toBe(200);
    expect(core.setProjectAttention).toHaveBeenCalledWith('p1', {
      needed: true,
      reasons: ['review roots'],
    });

    const invalid = await app.inject({
      method: 'PATCH',
      url: '/api/projects/p1/attention',
      payload: { needed: 'yes' },
    });
    expect(invalid.statusCode).toBe(400);

    const missing = await app.inject({
      method: 'PATCH',
      url: '/api/projects/p1/attention',
    });
    expect(missing.statusCode).toBe(400);

    const nullBody = await app.inject({
      method: 'PATCH',
      url: '/api/projects/p1/attention',
      headers: { 'content-type': 'application/json' },
      payload: 'null',
    });
    expect(nullBody.statusCode).toBe(400);
  });
});

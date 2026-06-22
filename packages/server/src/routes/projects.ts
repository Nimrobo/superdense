import type { FastifyInstance } from 'fastify';
import {
  getProjectProfileResolution,
  getRewardProjectOverview,
  listProjectProfiles,
  setProjectAttention,
} from '@nimrobo/superdense-core';

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function registerProjectsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/projects', async (req) => {
    const q = req.query as Record<string, string | undefined>;
    return {
      items: listProjectProfiles({
        needsAction: q.needsAction === 'true' || q.needsAction === '1',
      }),
    };
  });

  app.get('/api/projects/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const resolution = getProjectProfileResolution(id);
    if (!resolution) {
      reply.status(404);
      return { error: 'not found' };
    }
    return resolution;
  });

  app.get('/api/projects/:id/reward-overview', async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      return { item: getRewardProjectOverview(id) };
    } catch (err) {
      reply.status(errorMessage(err).startsWith('project not found:') ? 404 : 400);
      return { error: errorMessage(err) };
    }
  });

  app.patch('/api/projects/:id/attention', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
      reply.status(400);
      return { error: 'needed must be a boolean' };
    }
    const body = req.body as { needed?: unknown; reasons?: unknown };
    if (typeof body.needed !== 'boolean') {
      reply.status(400);
      return { error: 'needed must be a boolean' };
    }
    try {
      const reasons =
        body.reasons === undefined
          ? undefined
          : Array.isArray(body.reasons) &&
              body.reasons.every((reason) => typeof reason === 'string')
            ? body.reasons
            : null;
      if (reasons === null) {
        reply.status(400);
        return { error: 'reasons must be an array of strings' };
      }
      return { project: setProjectAttention(id, { needed: body.needed, reasons }) };
    } catch (err) {
      reply.status(errorMessage(err).startsWith('project not found:') ? 404 : 400);
      return { error: errorMessage(err) };
    }
  });
}

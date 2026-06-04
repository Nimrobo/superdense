import type { FastifyInstance } from 'fastify';
import {
  getCohort,
  getVersionChain,
  listCohorts,
  listVersionChains,
  type CohortAxis,
} from '@nimrobo/superdense-core';

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function registerCohortsRoutes(app: FastifyInstance): Promise<void> {
  // Static `chains` segments are declared first so they win over `/:type`.
  app.get('/api/cohorts/chains', async (req, reply) => {
    const q = req.query as Record<string, string | undefined>;
    try {
      return { items: listVersionChains({ projectId: q.projectId }) };
    } catch (err) {
      reply.status(400);
      return { error: errorMessage(err) };
    }
  });

  app.get('/api/cohorts/chains/:artifactId', async (req, reply) => {
    const { artifactId } = req.params as { artifactId: string };
    const chain = getVersionChain(artifactId);
    if (!chain) {
      reply.status(404);
      return { error: 'not found' };
    }
    return { chain };
  });

  app.get('/api/cohorts', async (req, reply) => {
    const q = req.query as Record<string, string | undefined>;
    try {
      const by = (q.by as CohortAxis | undefined) ?? 'type';
      return { items: listCohorts({ projectId: q.projectId, by }) };
    } catch (err) {
      reply.status(400);
      return { error: errorMessage(err) };
    }
  });

  app.get('/api/cohorts/:type', async (req, reply) => {
    const { type } = req.params as { type: string };
    const q = req.query as Record<string, string | undefined>;
    try {
      return { cohort: getCohort({ type, connector: q.connector, projectId: q.projectId }) };
    } catch (err) {
      reply.status(400);
      return { error: errorMessage(err) };
    }
  });
}

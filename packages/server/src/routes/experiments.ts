import type { FastifyInstance } from 'fastify';
import { getExperiment, listExperiments, type ExperimentStatus } from '@nimrobo/superdense-core';

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function statusParam(value: string | undefined): ExperimentStatus | undefined {
  if (value === undefined) return undefined;
  if (value === 'open' || value === 'complete' || value === 'inconclusive') return value;
  throw new Error('status must be open, complete, or inconclusive');
}

function limitParam(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const limit = Number(value);
  if (!Number.isSafeInteger(limit) || limit < 0) {
    throw new Error('limit must be a non-negative integer');
  }
  return limit;
}

export async function registerExperimentsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/experiments', async (req, reply) => {
    const q = req.query as Record<string, string | undefined>;
    try {
      return {
        items: listExperiments({
          projectId: q.projectId,
          hypothesisId: q.hypothesisId,
          status: statusParam(q.status),
          limit: limitParam(q.limit),
        }),
      };
    } catch (err) {
      reply.status(400);
      return { error: errorMessage(err) };
    }
  });

  app.get('/api/experiments/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const experiment = getExperiment(id);
    if (!experiment) {
      reply.status(404);
      return { error: 'not found' };
    }
    return { experiment };
  });
}

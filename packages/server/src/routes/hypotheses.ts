import type { FastifyInstance } from 'fastify';
import {
  getHypothesis,
  listHypotheses,
  type HypothesisStatus,
} from '@nimrobo/superdense-core';

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function statusParam(value: string | undefined): HypothesisStatus | undefined {
  if (value === undefined) return undefined;
  if (
    value === 'open' ||
    value === 'supported' ||
    value === 'refuted' ||
    value === 'inconclusive'
  ) {
    return value;
  }
  throw new Error('status must be open, supported, refuted, or inconclusive');
}

function limitParam(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const limit = Number(value);
  if (!Number.isSafeInteger(limit) || limit < 0) {
    throw new Error('limit must be a non-negative integer');
  }
  return limit;
}

export async function registerHypothesesRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/hypotheses', async (req, reply) => {
    const q = req.query as Record<string, string | undefined>;
    try {
      return {
        items: listHypotheses({
          projectId: q.projectId,
          status: statusParam(q.status),
          leverKey: q.leverKey,
          limit: limitParam(q.limit),
        }),
      };
    } catch (err) {
      reply.status(400);
      return { error: errorMessage(err) };
    }
  });

  app.get('/api/hypotheses/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const hypothesis = getHypothesis(id);
    if (!hypothesis) {
      reply.status(404);
      return { error: 'not found' };
    }
    return { hypothesis };
  });
}

import type { FastifyInstance } from 'fastify';
import { getRewardOverview, getRewardStatus } from '@nimrobo/superdense-core';

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function registerRewardRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/reward/overview', async (_req, reply) => {
    try {
      return getRewardOverview();
    } catch (err) {
      reply.status(400);
      return { error: errorMessage(err) };
    }
  });

  // The reward-layer punch list (profile → curate → finalize → reconcile → collect →
  // compare) with per-stage actionable counts and the suggested next action. The studio's
  // single Reward page folds its status strip over this — the same signal the CLI prints
  // as `superdense reward status`.
  app.get('/api/reward/status', async (req, reply) => {
    const q = req.query as Record<string, string | undefined>;
    try {
      return getRewardStatus({ projectId: q.projectId });
    } catch (err) {
      reply.status(400);
      return { error: errorMessage(err) };
    }
  });
}

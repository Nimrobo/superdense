import type { FastifyInstance } from 'fastify';
import { getArtifact, listArtifacts, listWorkThreads } from '@nimrobo/superdense-core';

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function registerArtifactsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/artifacts', async (req, reply) => {
    const q = req.query as Record<string, string | undefined>;
    try {
      return { items: listArtifacts({ projectId: q.projectId, type: q.type }) };
    } catch (err) {
      reply.status(400);
      return { error: errorMessage(err) };
    }
  });

  app.get('/api/artifacts/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const artifact = getArtifact(id);
    if (!artifact) {
      reply.status(404);
      return { error: 'not found' };
    }
    return { artifact };
  });

  // Threads that are finalized but not yet extracted — the Studio "ready to
  // extract" queue. Layer 3A exposed no thread route, so this lives here.
  app.get('/api/threads', async (req, reply) => {
    const q = req.query as Record<string, string | undefined>;
    try {
      return {
        items: listWorkThreads({
          projectId: q.projectId,
          lifecycle: q.lifecycle === 'finalized' ? 'finalized' : undefined,
        }),
      };
    } catch (err) {
      reply.status(400);
      return { error: errorMessage(err) };
    }
  });
}

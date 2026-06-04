import type { FastifyInstance } from 'fastify';
import {
  getArtifact,
  getArtifactRewards,
  getExternalization,
  listArtifacts,
  listExternalizations,
} from '@nimrobo/superdense-core';

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function registerArtifactsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/artifacts', async (req, reply) => {
    const q = req.query as Record<string, string | undefined>;
    try {
      // Derived linkage badge for the list view (linked | blocked | not_external
      // | unprocessed). One batched pass — listExternalizations folds all targets in
      // via a single query — instead of a getExternalization call per row. Artifacts
      // absent from the set fall back to 'unprocessed'. The detail view carries full targets.
      const statusByArtifact = new Map(listExternalizations().map((e) => [e.artifactId, e.status]));
      const items = listArtifacts({ projectId: q.projectId, type: q.type }).map((artifact) => ({
        ...artifact,
        externalizationStatus: statusByArtifact.get(artifact.id) ?? 'unprocessed',
      }));
      return { items };
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
    // Fold in where the artifact went (externalization targets/locators) and how
    // it performed (reward series) so the detail view shows the full chain, not
    // just payload + lineage. Both reuse the same reads Layer 5 cohorts use.
    return {
      artifact,
      externalization: getExternalization(id),
      rewards: getArtifactRewards(id),
    };
  });
}

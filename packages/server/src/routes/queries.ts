import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import {
  backfillQuery,
  createQuery,
  deleteQuery,
  getQuery,
  listEnrichers,
  listFilterCatalog,
  listFilters,
  listQueryMatches,
  listQueries,
  loadUserEnrichers,
  previewQuery,
  validateQueryDefinition,
  type QueryDefinition,
  type ValidationError,
} from '@road42/core';

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function validateForRequest(definition: QueryDefinition): Promise<void> {
  await loadUserEnrichers();
  validateQueryDefinition(definition, { filters: await listFilters(), enrichers: listEnrichers() });
}

export async function registerQueriesRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/queries', async () => ({ items: listQueries() }));

  app.get('/api/filters', async () => ({ items: await listFilterCatalog() }));

  app.get('/api/queries/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const q = getQuery(id);
    if (!q) { reply.status(404); return { error: 'not found' }; }
    const members = listQueryMatches(id);
    return { ...q, members };
  });

  app.post('/api/queries', async (req, reply) => {
    const body = req.body as { name?: string } & Partial<QueryDefinition>;
    if (!body.name || !body.filters) {
      reply.status(400);
      return { error: 'name and filters are required' };
    }
    const definition: QueryDefinition = { filters: body.filters, enrichers: body.enrichers ?? [] };
    try {
      await validateForRequest(definition);
      const id = randomUUID();
      createQuery({
        id,
        name: body.name,
        filters: definition.filters,
        enrichers: definition.enrichers ?? [],
        createdAt: Date.now(),
      });
      await backfillQuery(id);
      return getQuery(id);
    } catch (err) {
      reply.status(400);
      return { error: errorMessage(err), code: (err as ValidationError).name ?? 'Error' };
    }
  });

  app.post('/api/queries/preview', async (req, reply) => {
    const body = req.body as Partial<QueryDefinition> & { limit?: number };
    if (!body.filters) {
      reply.status(400);
      return { error: 'filters are required' };
    }
    const definition: QueryDefinition = { filters: body.filters, enrichers: body.enrichers ?? [] };
    try {
      await validateForRequest(definition);
      const result = await previewQuery(definition, { limit: body.limit });
      return { ...result, total: result.items.length };
    } catch (err) {
      reply.status(400);
      return { error: errorMessage(err), code: (err as ValidationError).name ?? 'Error' };
    }
  });

  app.post('/api/queries/:id/run', async (req, reply) => {
    const { id } = req.params as { id: string };
    const result = await backfillQuery(id);
    if (!result) { reply.status(404); return { error: 'not found' }; }
    return result;
  });

  app.delete('/api/queries/:id', async (req) => {
    const { id } = req.params as { id: string };
    deleteQuery(id);
    return { ok: true };
  });

  app.get('/api/enrichers', async () => {
    await loadUserEnrichers();
    return {
      items: listEnrichers().map((e) => ({
        name: e.name,
        version: e.version,
        returns: e.returns,
        jsonSchema: e.jsonSchema,
        description: e.description,
      })),
    };
  });
}

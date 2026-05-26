import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import {
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
  runAdHocQuery,
  runSavedQuery,
  validateQueryDefinition,
  type QueryDefinition,
  type ValidationError,
} from '@nimrobo/superdense-core';

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function validateForRequest(definition: QueryDefinition): Promise<void> {
  await loadUserEnrichers();
  validateQueryDefinition(definition, { filters: await listFilters(), enrichers: listEnrichers() });
}

async function runAdHocRequest(req: { body: unknown }, reply: { status: (code: number) => void }) {
  const body = req.body as Partial<QueryDefinition> & { limit?: number; offset?: number };
  if (!body.filters) {
    reply.status(400);
    return { error: 'filters are required' };
  }
  const definition: QueryDefinition = { filters: body.filters, enrichers: body.enrichers ?? [] };
  try {
    await validateForRequest(definition);
    return await runAdHocQuery(definition, { limit: body.limit, offset: body.offset });
  } catch (err) {
    reply.status(400);
    return { error: errorMessage(err), code: (err as ValidationError).name ?? 'Error' };
  }
}

async function saveQueryRequest(req: { body: unknown }, reply: { status: (code: number) => void }) {
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
    return getQuery(id);
  } catch (err) {
    reply.status(400);
    return { error: errorMessage(err), code: (err as ValidationError).name ?? 'Error' };
  }
}

async function runSavedQueryRequest(
  req: { params: unknown },
  reply: { status: (code: number) => void },
) {
  const { id } = req.params as { id: string };
  const result = await runSavedQuery(id);
  if (!result) {
    reply.status(404);
    return { error: 'not found' };
  }
  return result;
}

export async function registerQueriesRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/queries', async () => ({ items: listQueries() }));
  app.get('/api/saved-queries', async () => ({ items: listQueries() }));

  app.get('/api/filters', async () => ({ items: await listFilterCatalog() }));

  app.get('/api/queries/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const q = getQuery(id);
    if (!q) {
      reply.status(404);
      return { error: 'not found' };
    }
    const members = listQueryMatches(id);
    return { ...q, members };
  });

  app.get('/api/saved-queries/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const q = getQuery(id);
    if (!q) {
      reply.status(404);
      return { error: 'not found' };
    }
    const members = listQueryMatches(id);
    return { ...q, members };
  });

  app.post('/api/query', runAdHocRequest);

  app.post('/api/queries', saveQueryRequest);
  app.post('/api/saved-queries', saveQueryRequest);

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

  app.post('/api/queries/:id/run', runSavedQueryRequest);
  app.post('/api/saved-queries/:id/run', runSavedQueryRequest);

  app.delete('/api/queries/:id', async (req) => {
    const { id } = req.params as { id: string };
    deleteQuery(id);
    return { ok: true };
  });

  app.delete('/api/saved-queries/:id', async (req) => {
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

import type { FastifyInstance } from 'fastify';
import {
  compactSession,
  countSessions,
  getCompactor,
  getSession,
  iterSessionEvents,
  listSessions,
  type Compactor,
} from '@nimrobo/superdense-core';

function serializeCompactor(compactor: Compactor): Record<string, unknown> {
  return {
    name: compactor.name,
    kind: compactor.kind,
    targetBytes: compactor.targetBytes ?? null,
    description: compactor.description ?? null,
  };
}

function isAllowedCompactorName(name: string): name is 'trace' | 'salience' {
  return name === 'trace' || name === 'salience';
}

export async function registerSessionsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/sessions', async (req) => {
    const q = req.query as Record<string, string | undefined>;
    const limit = q.limit ? Math.min(parseInt(q.limit, 10) || 200, 1000) : 200;
    const offset = q.offset ? parseInt(q.offset, 10) || 0 : 0;
    const filter = { agent: q.agent, pwd: q.pwd, q: q.q, limit, offset };
    const items = listSessions(filter);
    const total = countSessions(filter);
    return { items, total, limit, offset };
  });

  app.get('/api/sessions/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const s = getSession(id);
    if (!s) { reply.status(404); return { error: 'not found' }; }
    return s;
  });

  app.get('/api/sessions/:id/transcript', async (req, reply) => {
    const { id } = req.params as { id: string };
    const q = req.query as Record<string, string | undefined>;
    const limit = q.limit ? Math.min(parseInt(q.limit, 10) || 500, 5000) : 500;
    const offset = q.offset ? parseInt(q.offset, 10) || 0 : 0;
    const s = getSession(id);
    if (!s) { reply.status(404); return { error: 'not found' }; }
    const events: unknown[] = [];
    let i = 0;
    try {
      for await (const ev of iterSessionEvents(s)) {
        if (i >= offset && events.length < limit) events.push(ev);
        i++;
        if (events.length >= limit) break;
      }
    } catch (err: any) {
      if (err?.code !== 'ENOENT') throw err;
    }
    return { items: events, offset, limit, missing: events.length === 0 && i === 0 };
  });

  app.get('/api/sessions/:id/compactors/:name', async (req, reply) => {
    const { id, name } = req.params as { id: string; name: string };
    if (!isAllowedCompactorName(name)) { reply.status(404); return { error: 'not found' }; }
    const s = getSession(id);
    if (!s) { reply.status(404); return { error: 'not found' }; }
    const compactor = getCompactor(name);
    if (!compactor) { reply.status(404); return { error: 'not found' }; }
    const result = await compactSession(name, s);
    return {
      session: s,
      compactor: serializeCompactor(compactor),
      result,
    };
  });
}

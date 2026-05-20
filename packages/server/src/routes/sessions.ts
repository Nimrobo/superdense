import type { FastifyInstance } from 'fastify';
import { claudeCodeAdapter, countSessions, getAdapter, getSession, listSessions } from '@road42/core';

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
    const adapter = getAdapter(s.agent) ?? claudeCodeAdapter;
    const events: unknown[] = [];
    let i = 0;
    try {
      for await (const ev of adapter.iterEvents(s.logPath)) {
        if (i >= offset && events.length < limit) events.push(ev);
        i++;
        if (events.length >= limit) break;
      }
    } catch (err: any) {
      if (err?.code !== 'ENOENT') throw err;
    }
    return { items: events, offset, limit, missing: events.length === 0 && i === 0 };
  });
}

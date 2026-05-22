import type { FastifyInstance } from 'fastify';
import { getDb } from '@road42/core';

export async function registerFacetsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/facets', async () => {
    const db = getDb();
    const pwd = db
      .prepare("SELECT DISTINCT pwd FROM sessions WHERE pwd IS NOT NULL AND pwd != '' ORDER BY pwd")
      .all()
      .map((r) => (r as { pwd: string }).pwd);
    const agent = db
      .prepare("SELECT DISTINCT agent FROM sessions WHERE agent IS NOT NULL AND agent != '' ORDER BY agent")
      .all()
      .map((r) => (r as { agent: string }).agent);
    return { pwd, agent };
  });
}

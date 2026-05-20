import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import {
  backfillGroup,
  createGroup,
  deleteGroup,
  getGroup,
  listGroupMembers,
  listGroups,
} from '@road42/core';

export async function registerGroupsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/groups', async () => ({ items: listGroups() }));

  app.get('/api/groups/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const g = getGroup(id);
    if (!g) { reply.status(404); return { error: 'not found' }; }
    const members = listGroupMembers(id);
    return { ...g, members };
  });

  app.post('/api/groups', async (req, reply) => {
    const body = req.body as { name?: string; pluginName?: string; pluginConfig?: Record<string, unknown> };
    if (!body.name || !body.pluginName) {
      reply.status(400);
      return { error: 'name and pluginName are required' };
    }
    const id = randomUUID();
    createGroup({
      id,
      name: body.name,
      pluginName: body.pluginName,
      pluginConfig: body.pluginConfig ?? {},
      createdAt: Date.now(),
    });
    await backfillGroup(id);
    return getGroup(id);
  });

  app.delete('/api/groups/:id', async (req) => {
    const { id } = req.params as { id: string };
    deleteGroup(id);
    return { ok: true };
  });
}

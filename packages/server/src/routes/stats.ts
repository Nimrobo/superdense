import type { FastifyInstance } from 'fastify';
import {
  getMaxLastIndexedAt,
  getSessionsPerDay,
  getStatsTotals,
  getTopQueries,
  getTopPwds,
  getTopTools,
  listRecentSessions,
} from '@road42/core';

export async function registerStatsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/stats', async () => {
    return {
      totals: getStatsTotals(),
      lastIndexedAt: getMaxLastIndexedAt(),
      perDay: getSessionsPerDay(30),
      topPwds: getTopPwds(5),
      topQueries: getTopQueries(5),
      topTools: getTopTools(10),
      recentSessions: listRecentSessions(8),
    };
  });
}

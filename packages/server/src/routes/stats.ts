import type { FastifyInstance } from 'fastify';
import {
  getContributions,
  getHeaderTotals,
  getInsightsBundle,
  getMaxLastIndexedAt,
  getSessionsPerDay,
  getStatsTotals,
  getStreaks,
  getTopQueries,
  getTopPwds,
  getTopTools,
  getWindowMetrics,
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

  app.get('/api/stats/header', async () => ({
    totals: getHeaderTotals(),
    streaks: getStreaks(),
    contributions: getContributions(),
    lastIndexedAt: getMaxLastIndexedAt(),
    recentSessions: listRecentSessions(8),
    topPwds: getTopPwds(5),
  }));

  app.get<{ Querystring: { days?: string } }>('/api/stats/window', async (req) => {
    const raw = Number(req.query.days ?? 7);
    const days = [7, 14, 30].includes(raw) ? raw : 7;
    return getWindowMetrics(days);
  });

  app.get('/api/stats/insights', async () => getInsightsBundle());
}

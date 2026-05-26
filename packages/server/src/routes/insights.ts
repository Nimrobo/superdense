import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import {
  assembleInsightPrompt,
  getInsightRecipe,
  listInsightRecipes,
  listInsightRuns,
} from '@nimrobo/superdense-core';

export async function registerInsightsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/insights/recipes', async () => ({ items: listInsightRecipes() }));

  app.get<{ Params: { name: string } }>(
    '/api/insights/recipes/:name/prompt',
    async (req, reply) => {
      const { name } = req.params;
      const recipe = getInsightRecipe(name);
      if (!recipe) {
        reply.status(404);
        return { error: 'insight not found' };
      }
      const runId = randomUUID();
      const body = assembleInsightPrompt(name, runId);
      reply.header('content-type', 'text/markdown; charset=utf-8');
      reply.header('x-superdense-run-id', runId);
      reply.header('x-superdense-insight', name);
      return body;
    },
  );

  app.get('/api/insights/runs', async () => {
    const runs = listInsightRuns(200);
    const recipes = new Map(listInsightRecipes().map((r) => [r.name, r] as const));
    const items = runs.map((run) => {
      const recipe = recipes.get(run.insightName);
      return {
        sessionId: run.sessionId,
        insightName: run.insightName,
        insightTitle: recipe?.title ?? run.insightName,
        runId: run.runId,
        timestamp: run.session.modifiedAt ?? run.session.createdAt ?? run.computedAt,
        project: run.session.projectKey || run.session.pwd,
        agent: run.session.agent,
        answerExcerpt: run.answer ? run.answer.slice(0, 280) : null,
        hasAnswer: !!run.answer,
      };
    });
    return { items };
  });
}

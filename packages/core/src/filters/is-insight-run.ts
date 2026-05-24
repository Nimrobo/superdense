import type { Filter } from './types.js';

export const isInsightRunFilter: Filter = {
  name: 'is_insight_run',
  title: 'Is insight run',
  description: 'Matches sessions whose first user message contains a Superdense insight marker. Optionally restrict to a specific recipe name.',
  usesSystemData: true,
  paramsSchema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Optional recipe name to require.' },
    },
    additionalProperties: false,
  },
  examples: [
    { filter: { name: 'is_insight_run', params: {} } },
    { filter: { name: 'is_insight_run', params: { name: 'context-files-to-reduce-fetches' } } },
  ],
  async run(ctx, params) {
    const value = ctx.getSystemEnrichment('insight_run')?.value;
    if (!value || typeof value !== 'object') return false;
    const record = value as { name?: unknown };
    if (typeof record.name !== 'string' || !record.name) return false;
    if (typeof params.name === 'string' && params.name && record.name !== params.name) return false;
    return { match: true, evidence: `insight=${record.name}` };
  },
};

import type { Filter } from './types.js';

export const userPromptContainsFilter: Filter = {
  name: 'user_prompt_contains',
  title: 'User Prompt Contains',
  description: 'Matches sessions where any user-role transcript message contains the given keyword.',
  readsLog: true,
  paramsSchema: {
    type: 'object',
    required: ['keyword'],
    properties: {
      keyword: { type: 'string', description: 'Substring to search for in user prompts.' },
    },
    additionalProperties: false,
  },
  examples: [
    { filter: { name: 'user_prompt_contains', params: { keyword: 'billing' } } },
  ],
  async run(ctx, params) {
    const keyword = String(params.keyword ?? '');
    if (!keyword) return false;
    for await (const ev of ctx.iterEvents(ctx.logPath)) {
      if (ev.role !== 'user') continue;
      if (ev.text && ev.text.includes(keyword)) {
        return { match: true, evidence: ev.text.slice(0, 200) };
      }
    }
    return false;
  },
};

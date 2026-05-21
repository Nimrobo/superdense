import type { Enricher } from './types.js';

export const toolCountsEnricher: Enricher = {
  name: 'tool_counts',
  version: 1,
  returns: 'json',
  alwaysRun: true,
  description: 'Map from tool name to invocation count across the session.',
  async run(ctx) {
    const counts: Record<string, number> = {};
    for await (const ev of ctx.iterEvents(ctx.logPath)) {
      if (ev.toolName) counts[ev.toolName] = (counts[ev.toolName] ?? 0) + 1;
    }
    return counts;
  },
};

import type { Enricher } from './types.js';

export const eventCountEnricher: Enricher = {
  name: 'event_count',
  version: 1,
  async run(ctx) {
    let n = 0;
    for await (const _ev of ctx.iterEvents(ctx.logPath)) n++;
    return n;
  },
};

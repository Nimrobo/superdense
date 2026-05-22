import type { Enricher } from './types.js';

export const eventCountEnricher: Enricher = {
  name: 'event_count',
  version: 1,
  returns: 'int',
  alwaysRun: true,
  description: 'Total number of transcript events in the session.',
  async run(ctx) {
    let n = 0;
    for await (const _ev of ctx.iterEvents(ctx.logPath)) n++;
    return n;
  },
};

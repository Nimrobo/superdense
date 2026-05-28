import { getSessionSubagentSummary } from '../db.js';
import type { Enricher } from './types.js';

export const subagentSummaryEnricher: Enricher = {
  name: 'subagent_summary',
  version: 1,
  returns: 'json',
  alwaysRun: true,
  description:
    'Sub-agent relationship summary for this session: direct children, recursive descendant count, depth, root session, and ancestors.',
  async run(ctx) {
    return getSessionSubagentSummary(ctx.session.id);
  },
};

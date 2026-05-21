export * from './types.js';
export * from './db.js';
export * from './paths.js';
export * from './indexer.js';
export { adapters, getAdapter, claudeCodeAdapter } from './adapters/index.js';
export { loadPlugins, getPlugin, clearPluginCache } from './plugins/index.js';
export {
  listEnrichers,
  registerEnricher,
  runEnrichersForSession,
  getActiveEnricherNames,
  refreshActiveEnricherNames,
  loadUserEnrichers,
  clearEnricherCache,
} from './enrichers/index.js';
export type { Enricher, EnricherContext } from './enrichers/types.js';
export { compilePredicate } from './query/compile.js';
export { validatePredicate, ValidationError } from './query/validate.js';
export type {
  Predicate,
  PredicateLeaf,
  FieldLeaf,
  PluginLeaf,
  Operator,
  IntOp,
  EnrichReturn,
} from './query/types.js';
export { runQueryEvaluation, backfillQuery, previewPredicate, evaluateQuery } from './queryeval.js';

export * from './types.js';
export * from './db.js';
export * from './paths.js';
export * from './indexer.js';
export {
  adapters,
  getAdapter,
  iterSessionEvents,
  claudeCodeAdapter,
  codexAdapter,
  openCodeAdapter,
} from './adapters/index.js';
export {
  loadFilters,
  getFilter,
  listFilters,
  listFilterCatalog,
  clearFilterCache,
} from './filters/index.js';
export type { Filter, FilterCatalogItem, FilterContext, FilterResult } from './filters/types.js';
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
export {
  listCompactors,
  registerCompactor,
  getCompactor,
  compactSession,
  traceCompactor,
  salienceCompactor,
} from './compactors/index.js';
export type { Compactor, CompactorContext } from './compactors/types.js';
export { validateQueryDefinition, ValidationError } from './query/validate.js';
export type {
  QueryDefinition,
  QueryFilter,
  FilterLeaf,
  IntOp,
  EnrichReturn,
} from './query/types.js';
export {
  runQueryEvaluation,
  backfillQuery,
  runSavedQuery,
  runAdHocQuery,
  previewQuery,
  evaluateQuery,
} from './queryeval.js';
export type { AdHocQueryResult, EvaluateResult, QueryResultItem } from './queryeval.js';
export {
  getHeaderTotals,
  getStreaks,
  getContributions,
  getWindowMetrics,
} from './stats/motivation.js';
export type {
  HeaderTotals,
  Streaks,
  ContributionDay,
  WindowMetrics,
  WindowBundle,
} from './stats/motivation.js';
export {
  getHourDowHeatmap,
  getWorkRhythm,
  getComebackProjects,
  getDayKinds,
  getPersonalRecords,
  getInsightsBundle,
} from './stats/insights.js';
export type {
  HeatmapCell,
  ComebackProject,
  WorkRhythm,
  DayKind,
  PersonalRecords,
  InsightsBundle,
} from './stats/insights.js';
export {
  listInsightRecipes,
  getInsightRecipe,
  loadInsightPromptBody,
  assembleInsightPrompt,
  parseInsightMarker,
  extractAnswerSection,
  clearInsightCache,
  INSIGHT_MARKER_VERSION,
} from './insights/index.js';
export type { InsightRecipe, InsightMarker } from './insights/index.js';

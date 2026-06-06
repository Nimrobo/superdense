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
export { getSessionCost, getSessionCostValue } from './session-cost.js';
export type {
  SessionCostAggregate,
  SessionCostResult,
  SessionCostTreeChild,
} from './session-cost.js';
export type {
  CostPricingStatus,
  SessionCostModelBreakdown,
  SessionCostValue,
  TokenTotals,
} from './enrichers/session-cost.js';
export type {
  WorkflowSummaryAgent,
  WorkflowSummaryRun,
  WorkflowSummaryValue,
} from './enrichers/workflow-summary.js';
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
  getStatsTotals,
  getMaxLastIndexedAt,
  getSessionsPerDay,
  getTopPwds,
  getTopQueries,
  getTopTools,
  listRecentSessions,
} from './stats/dashboard.js';
export type { StatsTotals } from './stats/dashboard.js';
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
export {
  applyProjectProfilePatch,
  getProjectContext,
  getProjectProfile,
  getProjectProfileResolution,
  listProjectProfiles,
  setProjectAttention,
} from './projects/index.js';
export {
  applyCurationBatch,
  finalizeArtifact,
  getArtifact,
  getCurationContext,
  getWorkThread,
  listArtifactInbox,
  listArtifacts,
  listCurationInbox,
  listWorkThreads,
  markSessionForCuration,
  reconcileIndexedSession,
  resolveRootSessionId,
  sessionRevision,
} from './curation/index.js';
export type {
  CurationStatus,
  ThreadExternalizationStatus,
  ThreadLifecycle,
  WorkThread,
  WorkThreadLineageEvent,
  WorkThreadLineageEventType,
  WorkThreadRole,
  WorkThreadSession,
} from './curation/index.js';
export {
  assessExternalization,
  getExternalization,
  listExternalizationInbox,
  listExternalizations,
} from './externalization/index.js';
export type {
  ArtifactExternalization,
  ExternalizationConclusion,
  ExternalizationStatus,
  ExternalizationTarget,
  ExternalizationTargetStatus,
} from './externalization/index.js';
export { getArtifactRewards, listRewardSnapshots, recordRewardSnapshot } from './rewards/index.js';
export type { ArtifactRewards, RewardSnapshot, RewardTargetSeries } from './rewards/index.js';
export { getCohort, getVersionChain, listCohorts, listVersionChains } from './cohorts/index.js';
export type {
  Cohort,
  CohortAxis,
  CohortMember,
  CohortSummary,
  VersionChain,
  VersionChainSummary,
} from './cohorts/index.js';
export { getRewardStatus } from './reward-status/index.js';
export type {
  RewardStatus,
  RewardStatusNextAction,
  RewardStatusStage,
  RewardStatusStageKey,
} from './reward-status/index.js';
export { getRewardOverview } from './reward-overview/index.js';
export type {
  RewardOverview,
  RewardOverviewAction,
  RewardProjectCurationCounts,
  RewardProjectOverview,
  RewardProjectThreadCounts,
} from './reward-overview/index.js';
export type {
  ArtifactDetector,
  ArtifactShape,
  ProjectContext,
  ProjectProfile,
  ProjectProfileResolution,
  ProjectProfileStatus,
  ProjectProfileSummary,
} from './projects/index.js';

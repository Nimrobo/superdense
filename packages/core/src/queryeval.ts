import { iterSessionEvents } from './adapters/index.js';
import {
  clearQueryMatches,
  getDb,
  getEnrichment,
  getQuery,
  listAllSessionsForBackfill,
  listSessionEnrichments,
  listQueries,
  markQueryRun,
} from './db.js';
import {
  listEnrichers,
  loadUserEnrichers,
  refreshActiveEnricherNames,
  runEnricherByNameForSession,
  runEnrichersForSession,
} from './enrichers/index.js';
import { loadFilters } from './filters/index.js';
import type { Filter, FilterResult } from './filters/types.js';
import {
  type QueryDefinition,
  type QueryFilter,
  isAnd,
  isFilterLeaf,
  isNot,
  isOr,
} from './query/types.js';
import { validateQueryDefinition } from './query/validate.js';
import type { Query, Session } from './types.js';

async function runPostFilterEnrichers(names: string[], sessions: Session[]): Promise<void> {
  for (const name of names) {
    for (const session of sessions) {
      await runEnricherByNameForSession(name, session);
    }
  }
}

function requestedEnrichments(sessionId: string, names: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (names.length === 0) return out;
  const all = listSessionEnrichments(sessionId);
  const wanted = new Set(names);
  for (const item of all) {
    if (wanted.has(item.name)) out[item.name] = item.value;
  }
  return out;
}

export interface QueryResultItem {
  sessionId: string;
  evidence?: string | null;
  enrichments?: Record<string, unknown>;
}

export interface EvaluateResult {
  matched: number;
  items: QueryResultItem[];
}

export async function evaluateQuery(query: Query): Promise<EvaluateResult> {
  await loadUserEnrichers();
  const filters = await loadFilters();
  const enrichers = listEnrichers();
  const systemEnrichers = new Set(enrichers.filter((e) => e.alwaysRun).map((e) => e.name));
  validateQueryDefinition({ filters: query.filters, enrichers: query.enrichers }, { filters, enrichers });

  const now = Date.now();
  clearQueryMatches(query.id);

  const matchedSessions: Array<{ session: Session; evidence?: string | null }> = [];
  const filterByName = new Map(filters.map((f) => [f.name, f] as const));
  const sessions = listAllSessionsForBackfill();
  const insert = getDb().prepare(
    'INSERT OR REPLACE INTO query_matches (query_id, session_id, added_at, evidence) VALUES (?, ?, ?, ?)',
  );

  for (const session of sessions) {
    await runEnrichersForSession(session);
    const r = await evalQueryFilter(query.filters, session, filterByName, systemEnrichers);
    if (r.match) {
      insert.run(query.id, session.id, now, r.evidence ?? null);
      matchedSessions.push({ session, evidence: r.evidence ?? null });
    }
  }

  await runPostFilterEnrichers(query.enrichers, matchedSessions.map((m) => m.session));

  markQueryRun(query.id, now);
  refreshActiveEnricherNames();
  return {
    matched: matchedSessions.length,
    items: matchedSessions.map(({ session, evidence }) => ({
      sessionId: session.id,
      evidence: evidence ?? null,
      enrichments: requestedEnrichments(session.id, query.enrichers),
    })),
  };
}

export async function backfillQuery(queryId: string): Promise<EvaluateResult | null> {
  const q = getQuery(queryId);
  if (!q) return null;
  return evaluateQuery(q);
}

export async function runQueryEvaluation(_opts: { full?: boolean } = {}): Promise<{ evaluated: number }> {
  const queries = listQueries();
  for (const q of queries) {
    await evaluateQuery(q);
  }
  refreshActiveEnricherNames();
  return { evaluated: queries.length };
}

export async function previewQuery(
  definition: QueryDefinition,
  opts: { limit?: number } = {},
): Promise<{
  items: QueryResultItem[];
  enrichers: string[];
}> {
  await loadUserEnrichers();
  const filters = await loadFilters();
  const enrichers = listEnrichers();
  const systemEnrichers = new Set(enrichers.filter((e) => e.alwaysRun).map((e) => e.name));
  validateQueryDefinition(definition, { filters, enrichers });

  const filterByName = new Map(filters.map((f) => [f.name, f] as const));
  const limit = opts.limit ?? 500;
  const items: QueryResultItem[] = [];
  const matchedSessions: Session[] = [];

  for (const session of listAllSessionsForBackfill()) {
    await runEnrichersForSession(session);
    const r = await evalQueryFilter(definition.filters, session, filterByName, systemEnrichers);
    if (r.match) {
      matchedSessions.push(session);
      items.push({ sessionId: session.id, evidence: r.evidence ?? null });
      if (items.length >= limit) break;
    }
  }

  const names = definition.enrichers ?? [];
  await runPostFilterEnrichers(names, matchedSessions);
  for (const item of items) item.enrichments = requestedEnrichments(item.sessionId, names);

  return { items, enrichers: names };
}

async function evalQueryFilter(
  p: QueryFilter,
  session: Session,
  filterByName: Map<string, Filter>,
  systemEnrichers: Set<string>,
): Promise<{ match: boolean; evidence?: string | null }> {
  if (isAnd(p)) {
    let evidence: string | null | undefined;
    for (const c of p.and) {
      const r = await evalQueryFilter(c, session, filterByName, systemEnrichers);
      if (!r.match) return { match: false };
      if (r.evidence) evidence = r.evidence;
    }
    return { match: true, evidence };
  }
  if (isOr(p)) {
    for (const c of p.or) {
      const r = await evalQueryFilter(c, session, filterByName, systemEnrichers);
      if (r.match) return r;
    }
    return { match: false };
  }
  if (isNot(p)) {
    const r = await evalQueryFilter(p.not, session, filterByName, systemEnrichers);
    return { match: !r.match };
  }
  if (isFilterLeaf(p)) {
    const filter = filterByName.get(p.filter.name);
    if (!filter) return { match: false };
    try {
      const result = await filter.run({
        session,
        logPath: session.logPath,
        iterEvents: () => iterSessionEvents(session),
        getSystemEnrichment: (name) => systemEnrichers.has(name) ? getEnrichment(session.id, name) : null,
      }, p.filter.params);
      return normalizeFilterResult(result);
    } catch {
      return { match: false };
    }
  }
  return { match: false };
}

function normalizeFilterResult(result: FilterResult): { match: boolean; evidence?: string | null } {
  if (typeof result === 'boolean') return { match: result };
  return { match: result.match === true, evidence: result.evidence ?? null };
}

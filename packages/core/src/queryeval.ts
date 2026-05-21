import { iterSessionEvents } from './adapters/index.js';
import {
  clearQueryMatches,
  getDb,
  getEnrichment,
  getQuery,
  listAllSessionsForBackfill,
  listQueries,
  markQueryRun,
} from './db.js';
import { refreshActiveEnricherNames, runEnricherByNameForSession } from './enrichers/index.js';
import { loadPlugins } from './plugins/index.js';
import { compilePredicate } from './query/compile.js';
import {
  type FieldLeaf,
  type Predicate,
  isAnd,
  isFieldLeaf,
  isNot,
  isOr,
  isPluginLeaf,
} from './query/types.js';
import { collectReferencedEnrichers } from './query/validate.js';
import type { GroupingPlugin, Query, Session } from './types.js';

async function backfillEnricher(name: string): Promise<void> {
  const sessions = listAllSessionsForBackfill();
  for (const s of sessions) {
    await runEnricherByNameForSession(name, s);
  }
}

export interface EvaluateResult {
  matched: number;
}

export async function evaluateQuery(query: Query): Promise<EvaluateResult> {
  for (const name of collectReferencedEnrichers(query.predicate)) {
    await backfillEnricher(name);
  }

  const compiled = compilePredicate(query.predicate);
  const now = Date.now();
  clearQueryMatches(query.id);

  let matched = 0;
  if (compiled.containsPluginLeaf) {
    const plugins = await loadPlugins();
    const pluginByName = new Map(plugins.map((p) => [p.name, p] as const));
    const sessions = listAllSessionsForBackfill();
    const insert = getDb().prepare(
      'INSERT OR REPLACE INTO query_matches (query_id, session_id, added_at, evidence) VALUES (?, ?, ?, ?)',
    );
    for (const s of sessions) {
      const r = await evalPredicateJs(query.predicate, s, pluginByName);
      if (r.match) {
        insert.run(query.id, s.id, now, r.evidence ?? null);
        matched++;
      }
    }
  } else {
    const rows = getDb().prepare(compiled.sql).all(compiled.params) as Array<{ id: string }>;
    const insert = getDb().prepare(
      'INSERT OR REPLACE INTO query_matches (query_id, session_id, added_at, evidence) VALUES (?, ?, ?, ?)',
    );
    const tx = getDb().transaction((items: Array<{ id: string }>) => {
      for (const r of items) insert.run(query.id, r.id, now, null);
    });
    tx(rows);
    matched = rows.length;
  }

  markQueryRun(query.id, now);
  refreshActiveEnricherNames();
  return { matched };
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

export async function previewPredicate(
  predicate: Predicate,
  opts: { limit?: number } = {},
): Promise<{
  items: Array<{ sessionId: string; evidence?: string | null }>;
  referencedEnrichers: string[];
  missingEnrichments: string[];
}> {
  const refs = collectReferencedEnrichers(predicate);
  const db = getDb();
  const missing: string[] = [];
  for (const name of refs) {
    const row = db.prepare('SELECT 1 AS x FROM query_enrich WHERE name = ? LIMIT 1').get(name) as { x: number } | undefined;
    if (!row) missing.push(name);
  }

  const compiled = compilePredicate(predicate);
  const limit = opts.limit ?? 500;
  let items: Array<{ sessionId: string; evidence?: string | null }> = [];

  if (compiled.containsPluginLeaf) {
    const plugins = await loadPlugins();
    const pluginByName = new Map(plugins.map((p) => [p.name, p] as const));
    const sessions = listAllSessionsForBackfill();
    for (const s of sessions) {
      const r = await evalPredicateJs(predicate, s, pluginByName);
      if (r.match) {
        items.push({ sessionId: s.id, evidence: r.evidence ?? null });
        if (items.length >= limit) break;
      }
    }
  } else {
    const sql = `${compiled.sql} LIMIT ${Math.max(0, Math.floor(limit))}`;
    const rows = db.prepare(sql).all(compiled.params) as Array<{ id: string }>;
    items = rows.map((r) => ({ sessionId: r.id, evidence: null }));
  }

  return { items, referencedEnrichers: Array.from(refs), missingEnrichments: missing };
}

// ---- JS evaluator (used when predicate contains a plugin leaf)

async function evalPredicateJs(
  p: Predicate,
  s: Session,
  pluginByName: Map<string, GroupingPlugin>,
): Promise<{ match: boolean; evidence?: string | null }> {
  if (isAnd(p)) {
    let evidence: string | null | undefined;
    for (const c of p.and) {
      const r = await evalPredicateJs(c, s, pluginByName);
      if (!r.match) return { match: false };
      if (r.evidence) evidence = r.evidence;
    }
    return { match: true, evidence };
  }
  if (isOr(p)) {
    for (const c of p.or) {
      const r = await evalPredicateJs(c, s, pluginByName);
      if (r.match) return r;
    }
    return { match: false };
  }
  if (isNot(p)) {
    const r = await evalPredicateJs(p.not, s, pluginByName);
    return { match: !r.match };
  }
  if (isPluginLeaf(p)) {
    const plugin = pluginByName.get(p.plugin.name);
    if (!plugin) return { match: false };
    try {
      if (plugin.prefilter && !plugin.prefilter(s, p.plugin.config)) return { match: false };
      const helpers = { iterEvents: () => iterSessionEvents(s) };
      const r = await plugin.matches(s, s.logPath, p.plugin.config, helpers);
      const matched = r === true || (typeof r === 'object' && r.match === true);
      const evidence = typeof r === 'object' && r !== null ? r.evidence ?? null : null;
      return { match: matched, evidence };
    } catch {
      return { match: false };
    }
  }
  if (isFieldLeaf(p)) {
    return { match: evalFieldJs(p, s) };
  }
  return { match: false };
}

function evalFieldJs(leaf: FieldLeaf, s: Session): boolean {
  let lhs: unknown;
  if (leaf.field.startsWith('session.')) {
    const col = leaf.field.slice('session.'.length);
    lhs = (s as unknown as Record<string, unknown>)[col];
  } else if (leaf.field.startsWith('enr.')) {
    const name = leaf.field.slice('enr.'.length);
    const e = getEnrichment(s.id, name);
    lhs = e?.value ?? null;
    if (leaf.path && leaf.path !== '$') lhs = resolveJsonPath(lhs, leaf.path);
  } else {
    return false;
  }
  return compareJs(lhs, leaf);
}

function resolveJsonPath(value: unknown, path: string): unknown {
  if (!path.startsWith('$')) return undefined;
  let cur: unknown = value;
  let i = 1;
  while (i < path.length && cur != null) {
    const ch = path[i]!;
    if (ch === '.') { i++; continue; }
    if (ch === '[') {
      const end = path.indexOf(']', i);
      if (end < 0) return undefined;
      const idx = Number(path.slice(i + 1, end));
      cur = Array.isArray(cur) ? cur[idx] : undefined;
      i = end + 1;
    } else {
      let j = i;
      while (j < path.length && path[j] !== '.' && path[j] !== '[') j++;
      const key = path.slice(i, j);
      cur = typeof cur === 'object' && cur !== null ? (cur as Record<string, unknown>)[key] : undefined;
      i = j;
    }
  }
  return cur;
}

function compareJs(lhs: unknown, leaf: FieldLeaf): boolean {
  const v = leaf.value;
  switch (leaf.op) {
    case '=': return lhs == v;
    case '!=': return lhs != v;
    case '<': return (lhs as number) < (v as number);
    case '<=': return (lhs as number) <= (v as number);
    case '>': return (lhs as number) > (v as number);
    case '>=': return (lhs as number) >= (v as number);
    case 'startsWith': return typeof lhs === 'string' && lhs.startsWith(String(v));
    case 'endsWith': return typeof lhs === 'string' && lhs.endsWith(String(v));
    case 'contains': return typeof lhs === 'string' && lhs.includes(String(v));
    case 'matches': return typeof lhs === 'string' && new RegExp(String(v)).test(lhs);
    case 'in': return Array.isArray(v) && (v as unknown[]).includes(lhs);
    case 'between':
      if (!Array.isArray(v) || v.length !== 2) return false;
      return (lhs as number) >= (v[0] as number) && (lhs as number) <= (v[1] as number);
    case 'isNull': return lhs == null;
    case 'jsonEq': return lhs === v;
    case 'jsonContains':
      return typeof lhs === 'string' ? lhs.includes(String(v)) : false;
    case 'jsonAny': {
      if (!Array.isArray(lhs)) return false;
      const intOp = leaf.intOp ?? '=';
      return lhs.some((x) => cmpInt(x, v, intOp));
    }
    case 'jsonLength': {
      const len = Array.isArray(lhs) ? lhs.length : 0;
      return cmpInt(len, v, leaf.intOp ?? '=');
    }
    default: return false;
  }
}

function cmpInt(a: unknown, b: unknown, op: string): boolean {
  const x = Number(a);
  const y = Number(b);
  switch (op) {
    case '=': return x === y;
    case '!=': return x !== y;
    case '<': return x < y;
    case '<=': return x <= y;
    case '>': return x > y;
    case '>=': return x >= y;
    default: return false;
  }
}

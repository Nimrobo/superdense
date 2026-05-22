export type EnrichReturn = 'string' | 'int' | 'bool' | 'json';

export type IntOp = '=' | '!=' | '<' | '<=' | '>' | '>=';

export interface FilterLeaf {
  filter: {
    name: string;
    params: Record<string, unknown>;
  };
}

export type QueryFilter =
  | { and: QueryFilter[] }
  | { or: QueryFilter[] }
  | { not: QueryFilter }
  | FilterLeaf;

export interface QueryDefinition {
  filters: QueryFilter;
  enrichers?: string[];
}

export function isAnd(p: QueryFilter): p is { and: QueryFilter[] } {
  return typeof p === 'object' && p !== null && 'and' in p;
}

export function isOr(p: QueryFilter): p is { or: QueryFilter[] } {
  return typeof p === 'object' && p !== null && 'or' in p;
}

export function isNot(p: QueryFilter): p is { not: QueryFilter } {
  return typeof p === 'object' && p !== null && 'not' in p;
}

export function isFilterLeaf(p: QueryFilter): p is FilterLeaf {
  return typeof p === 'object' && p !== null && 'filter' in p;
}

export function normalizeQueryDefinition(input: unknown): QueryDefinition {
  if (input == null || typeof input !== 'object') {
    throw new Error(`query definition must be an object, got ${typeof input}`);
  }
  const q = input as Partial<QueryDefinition>;
  if (!q.filters) throw new Error('query definition: filters required');
  return {
    filters: q.filters,
    enrichers: Array.isArray(q.enrichers) ? q.enrichers : [],
  };
}

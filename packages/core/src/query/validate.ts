import type { Enricher } from '../enrichers/types.js';
import type { Filter } from '../filters/types.js';
import {
  type QueryDefinition,
  type QueryFilter,
  isAnd,
  isFilterLeaf,
  isNot,
  isOr,
} from './types.js';

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

export interface ValidateOptions {
  filters: Filter[];
  enrichers: Enricher[];
}

export function validateQueryDefinition(q: QueryDefinition, opts: ValidateOptions): void {
  if (q == null || typeof q !== 'object') {
    throw new ValidationError(`query definition must be an object, got ${typeof q}`);
  }
  if (!q.filters) throw new ValidationError('query definition: filters required');
  const filterMap = new Map(opts.filters.map((f) => [f.name, f]));
  walkValidate(q.filters, filterMap);

  if (q.enrichers !== undefined && !Array.isArray(q.enrichers)) {
    throw new ValidationError('query definition: enrichers must be an array');
  }
  const enricherMap = new Map(opts.enrichers.map((e) => [e.name, e]));
  for (const name of q.enrichers ?? []) {
    if (typeof name !== 'string' || !name.trim()) {
      throw new ValidationError('query definition: enricher names must be non-empty strings');
    }
    if (!enricherMap.has(name)) throw new ValidationError(`unknown enricher: ${name}`);
  }
}

export function collectQueryEnrichers(q: QueryDefinition): Set<string> {
  return new Set(q.enrichers ?? []);
}

function walkValidate(p: QueryFilter, filters: Map<string, Filter>): void {
  if (p == null || typeof p !== 'object') {
    throw new ValidationError(`filter expression must be an object, got ${typeof p}`);
  }

  if ('field' in p) {
    throw new ValidationError('field leaves are no longer supported; use a named filter');
  }
  if ('plugin' in p) {
    throw new ValidationError('plugin leaves are no longer supported; use a named filter');
  }

  if (isAnd(p)) {
    if (!Array.isArray(p.and)) throw new ValidationError('and: expected array');
    for (const c of p.and) walkValidate(c, filters);
    return;
  }
  if (isOr(p)) {
    if (!Array.isArray(p.or)) throw new ValidationError('or: expected array');
    for (const c of p.or) walkValidate(c, filters);
    return;
  }
  if (isNot(p)) {
    walkValidate(p.not, filters);
    return;
  }
  if (isFilterLeaf(p)) {
    if (!p.filter || typeof p.filter.name !== 'string') {
      throw new ValidationError('filter leaf: name required');
    }
    if (p.filter.params == null || typeof p.filter.params !== 'object' || Array.isArray(p.filter.params)) {
      throw new ValidationError(`filter "${p.filter.name}": params must be an object`);
    }
    const filter = filters.get(p.filter.name);
    if (!filter) throw new ValidationError(`unknown filter: ${p.filter.name}`);
    validateParamsAgainstSchema(p.filter.name, p.filter.params, filter.paramsSchema);
    return;
  }

  throw new ValidationError('filter expression must be and/or/not/filter-leaf');
}

type ParamsSchema = {
  additionalProperties?: unknown;
  required?: unknown;
  properties?: Record<string, ParamsSchema>;
  type?: string | string[];
};

function validateParamsAgainstSchema(name: string, params: Record<string, unknown>, schema: object): void {
  validateObjectParams(name, undefined, params, schema as ParamsSchema);
}

function validateObjectParams(
  filterName: string,
  parent: string | undefined,
  params: Record<string, unknown>,
  schema: ParamsSchema,
): void {
  const required = Array.isArray(schema.required) ? schema.required : [];
  for (const key of required) {
    if (typeof key === 'string' && params[key] === undefined) {
      const paramName = parent ? `${parent}.${key}` : key;
      throw new ValidationError(`filter "${filterName}": param "${paramName}" required`);
    }
  }

  for (const [key, value] of Object.entries(params)) {
    const paramName = parent ? `${parent}.${key}` : key;
    const prop = schema.properties?.[key];
    if (!prop) {
      if (schema.additionalProperties === false) {
        throw new ValidationError(`filter "${filterName}": unknown param "${paramName}"`);
      }
      continue;
    }
    if (value == null) continue;
    if (prop.type && !matchesType(value, prop.type)) {
      const expected = Array.isArray(prop.type) ? prop.type.join('|') : prop.type;
      throw new ValidationError(`filter "${filterName}": param "${paramName}" must be ${expected}`);
    }
    if (
      typeof value === 'object'
      && value !== null
      && !Array.isArray(value)
      && (prop.properties || prop.required || prop.additionalProperties === false)
    ) {
      validateObjectParams(filterName, paramName, value as Record<string, unknown>, prop);
    }
  }
}

function matchesType(value: unknown, type: string | string[]): boolean {
  const types = Array.isArray(type) ? type : [type];
  return types.some((t) => {
    if (t === 'string') return typeof value === 'string';
    if (t === 'number' || t === 'integer') return typeof value === 'number' && Number.isFinite(value);
    if (t === 'boolean') return typeof value === 'boolean';
    if (t === 'object') return typeof value === 'object' && value !== null && !Array.isArray(value);
    if (t === 'array') return Array.isArray(value);
    return true;
  });
}

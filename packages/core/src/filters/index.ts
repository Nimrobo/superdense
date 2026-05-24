import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { LEGACY_USER_FILTERS_DIR, USER_FILTERS_DIR } from '../paths.js';
import type { FilterHelpers, JsonSchemaField, MatchResult, Session } from '../types.js';
import type { Filter, FilterContext, FilterResult } from './types.js';
import { serializeFilter } from './types.js';
import { isInsightRunFilter } from './is-insight-run.js';
import { sessionFilter } from './session.js';
import { userPromptContainsFilter } from './user-prompt-contains.js';

type LegacyMatcher = {
  name: string;
  title?: string;
  description?: string;
  configSchema?: JsonSchemaField[];
  prefilter?(session: Session, config: Record<string, unknown>): boolean;
  matches(
    session: Session,
    jsonlPath: string,
    config: Record<string, unknown>,
    helpers: FilterHelpers,
  ): Promise<MatchResult>;
};

const BUILTINS: Filter[] = [
  sessionFilter,
  userPromptContainsFilter,
  isInsightRunFilter,
];

let cache: Filter[] | null = null;

function isFilter(x: unknown): x is Filter {
  const f = x as Partial<Filter> | undefined;
  return !!f
    && typeof f.name === 'string'
    && typeof f.title === 'string'
    && typeof f.paramsSchema === 'object'
    && typeof f.run === 'function';
}

function isLegacyMatcher(x: unknown): x is LegacyMatcher {
  const f = x as Partial<LegacyMatcher> | undefined;
  return !!f
    && typeof f.name === 'string'
    && typeof f.matches === 'function';
}

function legacySchemaToJsonSchema(fields: JsonSchemaField[] | undefined): object {
  const properties: Record<string, object> = {};
  const required: string[] = [];
  for (const field of fields ?? []) {
    properties[field.name] = {
      type: field.type,
      description: field.description,
      default: field.default,
    };
    if (field.required) required.push(field.name);
  }
  return {
    type: 'object',
    properties,
    required,
    additionalProperties: true,
  };
}

function normalizeLegacyResult(result: MatchResult): FilterResult {
  if (typeof result === 'boolean') return result;
  return { match: result.match === true, evidence: result.evidence ?? null };
}

function legacyMatcherToFilter(matcher: LegacyMatcher): Filter {
  return {
    name: matcher.name === 'by-user-prompt-keyword' ? 'user_prompt_contains' : matcher.name,
    title: matcher.title ?? matcher.name,
    description: matcher.description,
    paramsSchema: legacySchemaToJsonSchema(matcher.configSchema),
    readsLog: true,
    examples: [],
    async run(ctx: FilterContext, params: Record<string, unknown>) {
      if (matcher.prefilter && !matcher.prefilter(ctx.session, params)) return false;
      const helpers = { iterEvents: () => ctx.iterEvents(ctx.logPath) };
      return normalizeLegacyResult(await matcher.matches(ctx.session, ctx.logPath, params, helpers));
    },
  };
}

async function readFilterDir(dir: string, legacy: boolean): Promise<Filter[]> {
  let files: string[] = [];
  try {
    files = (await readdir(dir)).filter((f) => f.endsWith('.js') || f.endsWith('.mjs'));
  } catch {
    return [];
  }

  const out: Filter[] = [];
  for (const f of files) {
    try {
      const mod = await import(pathToFileURL(join(dir, f)).href);
      const candidate = (mod.default ?? mod.filter) as unknown;
      if (isFilter(candidate)) {
        out.push(candidate);
      } else if (legacy && isLegacyMatcher(candidate)) {
        out.push(legacyMatcherToFilter(candidate));
      } else {
        console.warn(`[superdense] filter ${f} missing required fields (name, title, paramsSchema, run)`);
      }
    } catch (err) {
      console.error(`[superdense] failed to load filter ${f}:`, err);
    }
  }
  return out;
}

function registerInto(all: Filter[], filter: Filter): void {
  const existing = all.find((x) => x.name === filter.name);
  if (existing) {
    console.error(`[superdense] filter name collision: "${filter.name}" is already registered`);
    return;
  }
  all.push(filter);
}

export async function loadFilters(): Promise<Filter[]> {
  if (cache) return cache;
  const all = [...BUILTINS];
  for (const filter of await readFilterDir(USER_FILTERS_DIR, false)) registerInto(all, filter);
  for (const filter of await readFilterDir(LEGACY_USER_FILTERS_DIR, true)) registerInto(all, filter);
  cache = all;
  return cache;
}

export function clearFilterCache(): void {
  cache = null;
}

export async function getFilter(name: string): Promise<Filter | undefined> {
  const filters = await loadFilters();
  return filters.find((f) => f.name === name);
}

export async function listFilters(): Promise<Filter[]> {
  return loadFilters();
}

export async function listFilterCatalog() {
  return (await loadFilters()).map(serializeFilter);
}

export type { Filter, FilterCatalogItem, FilterContext, FilterResult } from './types.js';
export { serializeFilter } from './types.js';

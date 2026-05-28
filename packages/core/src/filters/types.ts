import type { QueryFilter } from '../query/types.js';
import type { EnrichmentRow } from '../db.js';
import type { Session, TranscriptEvent } from '../types.js';

export type FilterResult = boolean | { match: boolean; evidence?: string | null };

export interface FilterContext {
  session: Session;
  logPath: string;
  iterEvents: (logPath: string) => AsyncIterable<TranscriptEvent>;
  getSystemEnrichment: (name: string) => EnrichmentRow | null;
  includeSubagents?: boolean;
}

export interface Filter {
  name: string;
  title: string;
  description?: string;
  paramsSchema: object;
  examples?: QueryFilter[];
  readsLog?: boolean;
  usesSystemData?: boolean;
  run(ctx: FilterContext, params: Record<string, unknown>): Promise<FilterResult>;
}

export interface FilterCatalogItem {
  name: string;
  title: string;
  description?: string;
  paramsSchema: object;
  examples?: QueryFilter[];
  readsLog?: boolean;
  usesSystemData?: boolean;
}

export function serializeFilter(filter: Filter): FilterCatalogItem {
  return {
    name: filter.name,
    title: filter.title,
    description: filter.description,
    paramsSchema: filter.paramsSchema,
    examples: filter.examples,
    readsLog: filter.readsLog,
    usesSystemData: filter.usesSystemData,
  };
}

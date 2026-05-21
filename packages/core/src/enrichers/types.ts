import type { Session, TranscriptEvent } from '../types.js';
import type { EnrichReturn } from '../query/types.js';

export type { EnrichReturn };

export interface EnricherContext {
  session: Session;
  logPath: string;
  iterEvents: (logPath: string) => AsyncIterable<TranscriptEvent>;
}

export interface Enricher {
  name: string;
  version: number;
  returns: EnrichReturn;
  jsonSchema?: object;
  description?: string;
  /** When true, the enricher runs on every session during discovery,
   *  not only when referenced by a live query. Used for dashboard signals. */
  alwaysRun?: boolean;
  run(ctx: EnricherContext): Promise<unknown>;
}

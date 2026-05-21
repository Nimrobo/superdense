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
  run(ctx: EnricherContext): Promise<unknown>;
}

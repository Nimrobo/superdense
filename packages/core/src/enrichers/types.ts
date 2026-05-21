import type { Session, TranscriptEvent } from '../types.js';

export interface EnricherContext {
  session: Session;
  logPath: string;
  iterEvents: (logPath: string) => AsyncIterable<TranscriptEvent>;
}

export interface Enricher {
  name: string;
  version: number;
  run(ctx: EnricherContext): Promise<unknown>;
}

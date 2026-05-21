import type { Session, TranscriptEvent } from '../types.js';

export interface CompactorContext {
  session: Session;
  logPath: string;
  iterEvents: (logPath: string) => AsyncIterable<TranscriptEvent>;
}

export interface Compactor<T = unknown> {
  name: string;
  kind: 'structural' | 'semantic';
  /** Soft byte budget for the serialized output. Compactors should
   *  hierarchically collapse content if they expect to exceed this. */
  targetBytes?: number;
  description?: string;
  run(ctx: CompactorContext): Promise<T>;
}

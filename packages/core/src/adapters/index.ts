import type { Adapter } from '../types.js';
import type { Session, TranscriptEvent } from '../types.js';
import { claudeCodeAdapter } from './claude-code.js';
import { codexAdapter } from './codex.js';
import { openCodeAdapter } from './opencode.js';

export const adapters: Adapter[] = [claudeCodeAdapter, codexAdapter, openCodeAdapter];

export function getAdapter(name: string): Adapter | undefined {
  return adapters.find((a) => a.name === name);
}

export async function* iterSessionEvents(session: Session): AsyncIterable<TranscriptEvent> {
  const adapter = getAdapter(session.agent);
  if (!adapter) return;
  yield* adapter.iterEvents(session.logPath);
}

export { claudeCodeAdapter, codexAdapter, openCodeAdapter };

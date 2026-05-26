import { describe, it, expect } from 'vitest';
import { eventCountEnricher } from '../event-count.js';
import type { EnricherContext } from '../types.js';
import type { Session, TranscriptEvent } from '../../types.js';

const baseSession: Session = {
  id: 's1',
  agent: 'claude-code',
  sessionId: 'abc',
  logPath: '/tmp/abc.jsonl',
  pwd: '/home/user',
  projectKey: '/home/user',
};

function makeCtx(events: Partial<TranscriptEvent>[]): EnricherContext {
  return {
    session: baseSession,
    logPath: baseSession.logPath,
    async *iterEvents(_logPath: string) {
      for (const ev of events) yield ev as TranscriptEvent;
    },
  };
}

describe('eventCountEnricher', () => {
  it('has correct name and version', () => {
    expect(eventCountEnricher.name).toBe('event_count');
    expect(eventCountEnricher.version).toBe(1);
  });

  it('returns 0 for empty log', async () => {
    expect(await eventCountEnricher.run(makeCtx([]))).toBe(0);
  });

  it('counts all events regardless of type', async () => {
    expect(await eventCountEnricher.run(makeCtx([{}, {}, {}]))).toBe(3);
  });

  it('counts events with various fields', async () => {
    const events = [{ text: 'hello' }, { toolName: 'bash' }, { role: 'user' as const }];
    expect(await eventCountEnricher.run(makeCtx(events))).toBe(3);
  });
});

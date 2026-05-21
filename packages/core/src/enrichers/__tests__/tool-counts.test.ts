import { describe, it, expect } from 'vitest';
import { toolCountsEnricher } from '../tool-counts.js';
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

describe('toolCountsEnricher', () => {
  it('has correct name and version', () => {
    expect(toolCountsEnricher.name).toBe('tool_counts');
    expect(toolCountsEnricher.version).toBe(1);
  });

  it('returns empty object for no events', async () => {
    expect(await toolCountsEnricher.run(makeCtx([]))).toEqual({});
  });

  it('returns empty object when no events have toolName', async () => {
    expect(await toolCountsEnricher.run(makeCtx([{ text: 'hello' }, { role: 'user' }]))).toEqual({});
  });

  it('counts a single tool', async () => {
    const result = await toolCountsEnricher.run(makeCtx([
      { toolName: 'bash' },
      { toolName: 'bash' },
    ]));
    expect(result).toEqual({ bash: 2 });
  });

  it('counts multiple distinct tools', async () => {
    const result = await toolCountsEnricher.run(makeCtx([
      { toolName: 'bash' },
      { toolName: 'read' },
      { toolName: 'bash' },
      { toolName: 'write' },
    ]));
    expect(result).toEqual({ bash: 2, read: 1, write: 1 });
  });

  it('ignores events without toolName', async () => {
    const result = await toolCountsEnricher.run(makeCtx([
      { toolName: 'bash' },
      { text: 'some text' },
      { toolName: 'bash' },
    ]));
    expect(result).toEqual({ bash: 2 });
  });
});

import { describe, it, expect } from 'vitest';
import { hasErrorsEnricher } from '../has-errors.js';
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

describe('hasErrorsEnricher', () => {
  it('has correct name and version', () => {
    expect(hasErrorsEnricher.name).toBe('has_errors');
    expect(hasErrorsEnricher.version).toBe(1);
  });

  it('returns false for empty log', async () => {
    expect(await hasErrorsEnricher.run(makeCtx([]))).toBe(false);
  });

  it('returns false for clean output', async () => {
    expect(await hasErrorsEnricher.run(makeCtx([{ text: 'Everything looks good' }]))).toBe(false);
  });

  it('detects "error" in text', async () => {
    expect(await hasErrorsEnricher.run(makeCtx([{ text: 'An error occurred' }]))).toBe(true);
  });

  it('detects "exception" case-insensitively', async () => {
    expect(await hasErrorsEnricher.run(makeCtx([{ text: 'EXCEPTION raised' }]))).toBe(true);
  });

  it('detects "traceback" in inputText', async () => {
    expect(await hasErrorsEnricher.run(makeCtx([{ inputText: 'traceback (most recent call last)' }]))).toBe(true);
  });

  it('detects "failed"', async () => {
    expect(await hasErrorsEnricher.run(makeCtx([{ text: 'Build failed' }]))).toBe(true);
  });

  it('detects named error classes', async () => {
    expect(await hasErrorsEnricher.run(makeCtx([{ text: 'AssertionError: expected 200' }]))).toBe(true);
  });

  it('detects "fatal"', async () => {
    expect(await hasErrorsEnricher.run(makeCtx([{ text: 'fatal: not a git repo' }]))).toBe(true);
  });

  it('returns true on first match without reading all events', async () => {
    const events = [{ text: 'error in step 1' }, { text: 'exception in step 2' }];
    expect(await hasErrorsEnricher.run(makeCtx(events))).toBe(true);
  });

  it('skips events without text or inputText', async () => {
    expect(await hasErrorsEnricher.run(makeCtx([{ toolName: 'bash' }, { role: 'user' }]))).toBe(false);
  });
});

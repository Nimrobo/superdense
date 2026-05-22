import { describe, it, expect } from 'vitest';
import { insightRunEnricher } from '../insight-run.js';
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

function ctx(events: Partial<TranscriptEvent>[]): EnricherContext {
  return {
    session: baseSession,
    logPath: baseSession.logPath,
    async *iterEvents() {
      for (const ev of events) yield ev as TranscriptEvent;
    },
  };
}

describe('insightRunEnricher', () => {
  it('returns null when no marker is in the first user message', async () => {
    const result = await insightRunEnricher.run(
      ctx([
        { role: 'user', kind: 'text', text: 'just a normal prompt' },
        { role: 'assistant', kind: 'text', text: 'sure thing' },
      ]),
    );
    expect(result).toBeNull();
  });

  it('extracts marker fields and the ## Answer block from the last assistant message', async () => {
    const marker =
      '<!-- road42:insight name="context-files-to-reduce-fetches" run="11111111-2222-3333-4444-555555555555" v=1 -->';
    const assistantAnswer = [
      'doing the work…',
      '',
      '## Answer',
      '',
      'Proposed file: CLAUDE.md',
      'Content: …',
    ].join('\n');
    const result = (await insightRunEnricher.run(
      ctx([
        { role: 'user', kind: 'text', text: `${marker}\n\nhere is the recipe body` },
        { role: 'assistant', kind: 'text', text: 'thinking out loud' },
        { role: 'assistant', kind: 'text', text: assistantAnswer },
      ]),
    )) as { name: string; runId: string; version: number; answer: string | null };

    expect(result).not.toBeNull();
    expect(result.name).toBe('context-files-to-reduce-fetches');
    expect(result.runId).toBe('11111111-2222-3333-4444-555555555555');
    expect(result.version).toBe(1);
    expect(result.answer).toContain('Proposed file: CLAUDE.md');
    expect(result.answer).not.toMatch(/## Answer/);
  });

  it('still tags the session when the marker is present but there is no ## Answer yet', async () => {
    const marker = '<!-- road42:insight name="skills-to-build-for-this-repo" run="aaaa" v=1 -->';
    const result = (await insightRunEnricher.run(
      ctx([
        { role: 'user', kind: 'text', text: marker },
        { role: 'assistant', kind: 'text', text: 'working on it' },
      ]),
    )) as { name: string; answer: string | null };
    expect(result.name).toBe('skills-to-build-for-this-repo');
    expect(result.answer).toBeNull();
  });
});

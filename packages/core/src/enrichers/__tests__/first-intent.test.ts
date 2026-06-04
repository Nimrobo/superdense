import { describe, it, expect } from 'vitest';
import { firstIntentEnricher } from '../first-intent.js';
import type { Session, TranscriptEvent } from '../../types.js';

function ctx(events: TranscriptEvent[], session: Partial<Session> = {}) {
  return {
    session: { agent: 'claude-code', pwd: '/proj', ...session } as Session,
    logPath: '/tmp/x',
    iterEvents: async function* () {
      for (const e of events) yield e;
    },
  };
}

const run = (c: ReturnType<typeof ctx>) =>
  firstIntentEnricher.run(c) as Promise<{ v: 1; intent: string | null }>;

const userText = (text: string): TranscriptEvent => ({ kind: 'text', role: 'user', text });

describe('firstIntentEnricher', () => {
  it('skips a /model switch and returns the real task', async () => {
    const { intent } = await run(
      ctx([
        userText('<command-name>/model</command-name><command-message>sonnet</command-message>'),
        userText('Add a reward layer to superdense'),
      ]),
    );
    expect(intent).toBe('Add a reward layer to superdense');
  });

  it('skips an attachment-only turn', async () => {
    const { intent } = await run(
      ctx([userText('.context/attachments/aB/plan.md'), userText('Implement the plan')]),
    );
    expect(intent).toBe('Implement the plan');
  });

  it('falls back to firstPrompt when no meaningful turn exists', async () => {
    const { intent } = await run(ctx([], { firstPrompt: 'raw fallback' }));
    expect(intent).toBe('raw fallback');
  });
});

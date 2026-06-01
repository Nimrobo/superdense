import { describe, it, expect } from 'vitest';
import { planRefsEnricher, type PlanRef } from '../plan-refs.js';
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
  planRefsEnricher.run(c) as Promise<{ v: 1; refs: PlanRef[] }>;

describe('planRefsEnricher', () => {
  it('captures a wrote slug from a Write to the plans dir', async () => {
    const { refs } = await run(
      ctx([
        {
          kind: 'tool_call',
          toolName: 'Write',
          inputText: JSON.stringify({ file_path: '/home/u/.claude/plans/swirling-bengio.md' }),
        },
      ]),
    );
    expect(refs).toContainEqual({ slug: 'swirling-bengio', kind: 'wrote' });
  });

  it('captures a referenced slug from text mentions', async () => {
    const { refs } = await run(
      ctx([{ kind: 'text', role: 'user', text: 'see ~/.claude/plans/dreamy-phoenix.md please' }]),
    );
    expect(refs).toContainEqual({ slug: 'dreamy-phoenix', kind: 'referenced' });
  });

  it('captures a referenced slug from firstPrompt', async () => {
    const { refs } = await run(
      ctx([], { firstPrompt: 'continue ~/.claude/plans/move-the-openclaw.md' }),
    );
    expect(refs).toContainEqual({ slug: 'move-the-openclaw', kind: 'referenced' });
  });

  it('does not collect plan references from tool results or assistant narration', async () => {
    const { refs } = await run(
      ctx([
        {
          kind: 'tool_result',
          role: 'user',
          text: 'generated output mentions ~/.claude/plans/false-positive.md',
        },
        {
          kind: 'text',
          role: 'assistant',
          text: 'I read ~/.claude/plans/assistant-narration.md',
        },
      ]),
    );
    expect(refs).toEqual([]);
  });

  it('returns nothing for non-claude-code agents', async () => {
    const { refs } = await run(
      ctx([{ kind: 'text', role: 'user', text: '~/.claude/plans/x.md' }], { agent: 'codex' }),
    );
    expect(refs).toEqual([]);
  });
});

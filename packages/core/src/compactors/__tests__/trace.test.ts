import { describe, it, expect } from 'vitest';
import { traceCompactor } from '../trace.js';
import type { CompactorContext } from '../types.js';
import type { Session, TranscriptEvent } from '../../types.js';

const baseSession: Session = {
  id: 's1',
  agent: 'claude-code',
  sessionId: 'abc',
  logPath: '/tmp/abc.jsonl',
  pwd: '/home/user',
  projectKey: '/home/user',
};

function makeCtx(events: Partial<TranscriptEvent>[]): CompactorContext {
  return {
    session: baseSession,
    logPath: baseSession.logPath,
    async *iterEvents(_logPath: string) {
      for (const ev of events) yield ev as TranscriptEvent;
    },
  };
}

describe('traceCompactor', () => {
  it('has correct identity', () => {
    expect(traceCompactor.name).toBe('trace');
    expect(traceCompactor.kind).toBe('structural');
  });

  it('emits a user turn followed by an assistant turn with calls', async () => {
    const out = await traceCompactor.run(
      makeCtx([
        { kind: 'text', role: 'user', text: 'fix the failing test' },
        { kind: 'text', role: 'assistant', text: "I'll investigate the failure." },
        {
          kind: 'tool_call',
          role: 'assistant',
          toolName: 'Read',
          toolCallId: 'c1',
          inputText: JSON.stringify({ file_path: '/repo/auth.spec.ts' }),
        },
        { kind: 'tool_result', role: 'user', toolCallId: 'c1', text: 'file contents here' },
        {
          kind: 'tool_call',
          role: 'assistant',
          toolName: 'Bash',
          toolCallId: 'c2',
          inputText: JSON.stringify({ command: 'npm test' }),
        },
        { kind: 'tool_result', role: 'user', toolCallId: 'c2', text: 'AssertionError: expected 200' },
      ]),
    );
    expect(out).toEqual({
      v: 1,
      turns: [
        { t: 0, user: 'fix the failing test' },
        {
          t: 1,
          asst: "I'll investigate the failure.",
          calls: [
            { tool: 'Read', arg: '/repo/auth.spec.ts', ok: true, outBytes: 18 },
            { tool: 'Bash', arg: 'npm test', ok: false, outBytes: 28, errSig: 'AssertionError: expected 200' },
          ],
        },
      ],
    });
  });

  it('collapses the middle when there are more than 50 turns', async () => {
    const events: Partial<TranscriptEvent>[] = [];
    for (let i = 0; i < 60; i++) {
      events.push({ kind: 'text', role: 'user', text: `ask ${i}` });
      events.push({ kind: 'tool_call', role: 'assistant', toolName: 'Bash', inputText: '{"command":"ls"}' });
    }
    const out = (await traceCompactor.run(makeCtx(events))) as unknown as {
      turns: Array<Record<string, unknown>>;
    };
    const collapsedIdx = out.turns.findIndex((t) => 'omitted' in t);
    expect(collapsedIdx).toBeGreaterThan(0);
    const collapsed = out.turns[collapsedIdx] as { omitted: number; tools: Record<string, number> };
    expect(collapsed.omitted).toBeGreaterThan(0);
    expect(collapsed.tools.Bash).toBeGreaterThan(0);
    expect(out.turns.length).toBeLessThan(60);
  });

  it('is deterministic', async () => {
    const events: Partial<TranscriptEvent>[] = [
      { kind: 'text', role: 'user', text: 'hi' },
      { kind: 'tool_call', role: 'assistant', toolName: 'Bash', inputText: '{"command":"ls"}' },
    ];
    const a = await traceCompactor.run(makeCtx(events));
    const b = await traceCompactor.run(makeCtx(events));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

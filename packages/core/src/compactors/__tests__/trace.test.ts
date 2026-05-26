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
        {
          kind: 'tool_result',
          role: 'user',
          toolCallId: 'c2',
          text: 'AssertionError: expected 200',
        },
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
            {
              tool: 'Bash',
              arg: 'npm test',
              ok: false,
              outBytes: 28,
              errSig: 'AssertionError: expected 200',
            },
          ],
        },
      ],
    });
  });

  it('collapses the middle when there are more than 50 turns', async () => {
    const events: Partial<TranscriptEvent>[] = [];
    for (let i = 0; i < 60; i++) {
      events.push({ kind: 'text', role: 'user', text: `ask ${i}` });
      events.push({
        kind: 'tool_call',
        role: 'assistant',
        toolName: 'Bash',
        inputText: '{"command":"ls"}',
      });
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

  it('emits plan_enter and plan_exit dividers in order', async () => {
    const out = (await traceCompactor.run(
      makeCtx([
        { kind: 'text', role: 'user', text: 'plan this' },
        { kind: 'mode_change', mode: 'plan' },
        { kind: 'text', role: 'assistant', text: 'proposing approach' },
        {
          kind: 'tool_call',
          role: 'assistant',
          toolName: 'Read',
          inputText: '{"file_path":"a.ts"}',
        },
        { kind: 'mode_change', mode: 'default' },
        { kind: 'text', role: 'assistant', text: 'executing now' },
        {
          kind: 'tool_call',
          role: 'assistant',
          toolName: 'Write',
          inputText: '{"file_path":"a.ts"}',
        },
      ]),
    )) as unknown as { turns: Array<Record<string, unknown>> };

    const kinds = out.turns.map((t) => {
      if ('phase' in t) return t.phase;
      if ('user' in t) return 'user';
      if ('asst' in t || 'calls' in t) return 'asst';
      if ('omitted' in t) return 'omitted';
      return 'unknown';
    });
    expect(kinds).toEqual(['user', 'plan_enter', 'asst', 'plan_exit', 'asst']);
  });

  it('protects 5 turns before and after each divider and excludes them from the 50-turn budget', async () => {
    const events: Partial<TranscriptEvent>[] = [];
    for (let i = 0; i < 100; i++) {
      events.push({ kind: 'text', role: 'user', text: `ask ${i}` });
      events.push({
        kind: 'tool_call',
        role: 'assistant',
        toolName: 'Bash',
        inputText: '{"command":"ls"}',
      });
      // Insert plan mode toggle around the midpoint user/asst pair (turn indices ~60, ~64).
      if (i === 30) events.push({ kind: 'mode_change', mode: 'plan' });
      if (i === 32) events.push({ kind: 'mode_change', mode: 'default' });
    }
    const out = (await traceCompactor.run(makeCtx(events))) as unknown as {
      turns: Array<Record<string, unknown>>;
    };

    const enterIdx = out.turns.findIndex((t) => t.phase === 'plan_enter');
    const exitIdx = out.turns.findIndex((t) => t.phase === 'plan_exit');
    expect(enterIdx).toBeGreaterThan(-1);
    expect(exitIdx).toBeGreaterThan(enterIdx);

    // 5 turns before plan_enter and 5 after plan_exit must be present (no omitted gap inside the protected window).
    const window = out.turns.slice(Math.max(0, enterIdx - 5), exitIdx + 6);
    for (const turn of window) {
      expect('omitted' in turn).toBe(false);
    }

    // Non-protected, non-omitted turns should respect MAX_TURNS_KEPT (50). Protected turns are extra.
    const enterT = (out.turns.find((t) => t.phase === 'plan_enter') as { t: number }).t;
    const exitT = (out.turns.find((t) => t.phase === 'plan_exit') as { t: number }).t;
    const isProtected = (tVal: number) =>
      (tVal >= enterT - 5 && tVal <= enterT + 5) || (tVal >= exitT - 5 && tVal <= exitT + 5);
    const nonProtectedKept = out.turns.filter(
      (t) => !('phase' in t) && !('omitted' in t) && !isProtected(t.t as number),
    );
    expect(nonProtectedKept.length).toBeLessThanOrEqual(50);

    // Sanity: at least one omitted placeholder appeared (we had 100 turns of non-plan content).
    expect(out.turns.some((t) => 'omitted' in t)).toBe(true);
  });

  it('ignores mode_change events that do not change the mode', async () => {
    const out = (await traceCompactor.run(
      makeCtx([
        { kind: 'text', role: 'user', text: 'hi' },
        { kind: 'mode_change', mode: 'default' },
        { kind: 'mode_change', mode: 'default' },
        { kind: 'text', role: 'assistant', text: 'hello' },
      ]),
    )) as unknown as { turns: Array<Record<string, unknown>> };

    expect(out.turns.some((t) => 'phase' in t)).toBe(false);
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

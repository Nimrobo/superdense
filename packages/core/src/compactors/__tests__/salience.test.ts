import { describe, it, expect } from 'vitest';
import { salienceCompactor } from '../salience.js';
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

describe('salienceCompactor', () => {
  it('has correct identity', () => {
    expect(salienceCompactor.name).toBe('salience');
    expect(salienceCompactor.kind).toBe('semantic');
  });

  it('extracts firstAsk, userTurns, decisions, mutations, errors, lastAsst', async () => {
    const out = (await salienceCompactor.run(
      makeCtx([
        { kind: 'text', role: 'user', text: 'fix the failing test in auth.spec.ts' },
        { kind: 'text', role: 'assistant', text: "I'll investigate the failure." },
        {
          kind: 'tool_call',
          role: 'assistant',
          toolName: 'Read',
          toolCallId: 'c1',
          inputText: JSON.stringify({ file_path: '/repo/auth.spec.ts' }),
        },
        {
          kind: 'tool_call',
          role: 'assistant',
          toolName: 'Bash',
          toolCallId: 'c2',
          inputText: JSON.stringify({ command: 'npm test' }),
        },
        { kind: 'tool_result', role: 'user', toolCallId: 'c2', text: 'AssertionError: expected 200 got 401' },
        { kind: 'text', role: 'assistant', text: 'The issue is the regex misses trailing slash.' },
        {
          kind: 'tool_call',
          role: 'assistant',
          toolName: 'Edit',
          toolCallId: 'c3',
          inputText: JSON.stringify({ file_path: '/repo/auth.ts' }),
        },
        {
          kind: 'tool_call',
          role: 'assistant',
          toolName: 'Bash',
          toolCallId: 'c4',
          inputText: JSON.stringify({ command: "git commit -m 'fix auth'" }),
        },
        { kind: 'text', role: 'user', text: 'also add a test for null input' },
        { kind: 'text', role: 'assistant', text: 'Done — tests pass.' },
      ]),
    )) as {
      firstAsk: string;
      userTurns: string[];
      decisions: Array<{ at: number; text: string }>;
      mutations: Array<{ tool: string; path?: string; arg?: string }>;
      errors: Array<{ tool?: string; sig: string }>;
      lastAsst: string;
    };

    expect(out.firstAsk).toBe('fix the failing test in auth.spec.ts');
    expect(out.userTurns).toEqual([
      'fix the failing test in auth.spec.ts',
      'also add a test for null input',
    ]);
    expect(out.decisions.map((d) => d.text)).toEqual([
      "I'll investigate the failure.",
      'The issue is the regex misses trailing slash.',
      'Done — tests pass.',
    ]);
    expect(out.mutations).toEqual([
      { tool: 'Edit', path: '/repo/auth.ts' },
      { tool: 'Bash', arg: "git commit -m 'fix auth'" },
    ]);
    expect(out.errors).toHaveLength(1);
    expect(out.errors[0]!.tool).toBe('Bash');
    expect(out.errors[0]!.sig).toMatch(/AssertionError/);
    expect(out.lastAsst).toBe('Done — tests pass.');
  });

  it('drops non-mutating tools from mutations', async () => {
    const out = (await salienceCompactor.run(
      makeCtx([
        { kind: 'text', role: 'user', text: 'look around' },
        {
          kind: 'tool_call',
          role: 'assistant',
          toolName: 'Read',
          inputText: JSON.stringify({ file_path: '/x.ts' }),
        },
        {
          kind: 'tool_call',
          role: 'assistant',
          toolName: 'Grep',
          inputText: JSON.stringify({ pattern: 'foo' }),
        },
      ]),
    )) as { mutations: unknown[] };
    expect(out.mutations).toEqual([]);
  });

  it('is deterministic', async () => {
    const events: Partial<TranscriptEvent>[] = [
      { kind: 'text', role: 'user', text: 'do a thing' },
      { kind: 'text', role: 'assistant', text: "I'll do the thing." },
    ];
    const a = await salienceCompactor.run(makeCtx(events));
    const b = await salienceCompactor.run(makeCtx(events));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

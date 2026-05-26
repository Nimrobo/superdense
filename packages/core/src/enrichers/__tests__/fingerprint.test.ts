import { describe, it, expect } from 'vitest';
import { fingerprintEnricher } from '../fingerprint.js';
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

describe('fingerprintEnricher', () => {
  it('has correct name, version, and alwaysRun', () => {
    expect(fingerprintEnricher.name).toBe('fingerprint');
    expect(fingerprintEnricher.version).toBe(1);
    expect(fingerprintEnricher.alwaysRun).toBe(true);
  });

  it('returns zero-shaped fingerprint on empty input', async () => {
    const fp = (await fingerprintEnricher.run(makeCtx([]))) as Record<string, unknown>;
    expect(fp).toEqual({
      v: 1,
      events: { text: 0, tool_call: 0, tool_result: 0 },
      tools: {},
      toolErrors: {},
      roles: { user: 0, assistant: 0, system: 0 },
      bytesByRole: { user: 0, assistant: 0, system: 0 },
      uniquePaths: 0,
      verbs: {},
      durationMs: 0,
      turns: 0,
    });
  });

  it('counts events, tools, role bytes, and verbs from a realistic transcript', async () => {
    const events: Partial<TranscriptEvent>[] = [
      { ts: 1000, kind: 'text', role: 'user', text: 'please fix the failing test and commit' },
      { ts: 1100, kind: 'text', role: 'assistant', text: "I'll investigate." },
      {
        ts: 1200,
        kind: 'tool_call',
        role: 'assistant',
        toolName: 'Read',
        toolCallId: 'c1',
        inputText: JSON.stringify({ file_path: '/repo/auth.spec.ts' }),
      },
      { ts: 1300, kind: 'tool_result', role: 'user', toolCallId: 'c1', text: 'ok contents' },
      {
        ts: 1400,
        kind: 'tool_call',
        role: 'assistant',
        toolName: 'Bash',
        toolCallId: 'c2',
        inputText: JSON.stringify({ command: 'npm test' }),
      },
      {
        ts: 1500,
        kind: 'tool_result',
        role: 'user',
        toolCallId: 'c2',
        text: 'AssertionError: failed',
      },
      {
        ts: 1600,
        kind: 'tool_call',
        role: 'assistant',
        toolName: 'Edit',
        toolCallId: 'c3',
        inputText: JSON.stringify({ file_path: '/repo/auth.ts' }),
      },
      { ts: 1700, kind: 'tool_result', role: 'user', toolCallId: 'c3', text: 'ok' },
    ];
    const fp = (await fingerprintEnricher.run(makeCtx(events))) as {
      events: Record<string, number>;
      tools: Record<string, number>;
      toolErrors: Record<string, number>;
      uniquePaths: number;
      verbs: Record<string, number>;
      durationMs: number;
      turns: number;
      roles: Record<string, number>;
    };
    expect(fp.events).toEqual({ text: 2, tool_call: 3, tool_result: 3 });
    expect(fp.tools).toEqual({ Read: 1, Bash: 1, Edit: 1 });
    expect(fp.toolErrors).toEqual({ Bash: 1 });
    expect(fp.uniquePaths).toBe(2);
    expect(fp.verbs).toMatchObject({ fix: 1, test: 1, commit: 1 });
    expect(fp.durationMs).toBe(700);
    expect(fp.turns).toBe(1);
    expect(fp.roles.user).toBeGreaterThan(0);
  });

  it('is deterministic for the same input', async () => {
    const events: Partial<TranscriptEvent>[] = [
      { ts: 1, kind: 'text', role: 'user', text: 'add a test' },
      {
        ts: 2,
        kind: 'tool_call',
        role: 'assistant',
        toolName: 'Bash',
        inputText: '{"command":"ls"}',
      },
    ];
    const a = await fingerprintEnricher.run(makeCtx(events));
    const b = await fingerprintEnricher.run(makeCtx(events));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

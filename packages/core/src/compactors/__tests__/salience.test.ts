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

  it('extracts a sparse timeline, mutations, and errors', async () => {
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
        {
          kind: 'tool_result',
          role: 'user',
          toolCallId: 'c2',
          isError: true,
          text: 'AssertionError: expected 200 got 401',
        },
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
      v: 2;
      timeline: Array<{ type: string; t: number; kind?: string; text?: string }>;
      mutations: Array<{ tool: string; path?: string; arg?: string; count: number }>;
      errors: Array<{ tool?: string; sig: string }>;
    };

    expect(out.v).toBe(2);
    expect(out.timeline).toEqual([
      { type: 'user', t: 0, text: 'fix the failing test in auth.spec.ts' },
      {
        type: 'assistant',
        t: 1,
        kind: 'decision',
        text: 'The issue is the regex misses trailing slash.',
      },
      { type: 'user', t: 2, text: 'also add a test for null input' },
      { type: 'assistant', t: 3, kind: 'final', text: 'Done — tests pass.' },
    ]);
    expect(out.mutations).toEqual([
      { tool: 'Edit', path: '/repo/auth.ts', count: 1 },
      { tool: 'Bash', arg: "git commit -m 'fix auth'", count: 1 },
    ]);
    expect(out.errors).toHaveLength(1);
    expect(out.errors[0]!.tool).toBe('Bash');
    expect(out.errors[0]!.sig).toMatch(/AssertionError/);
  });

  it('keeps plan boundaries, every proposed plan, and user pushbacks as separate timeline items', async () => {
    const out = (await salienceCompactor.run(
      makeCtx([
        { kind: 'text', role: 'user', text: 'update salience for plan mode' },
        { kind: 'mode_change', mode: 'plan' },
        { kind: 'text', role: 'assistant', text: "I'll inspect and propose a plan." },
        { kind: 'text', role: 'assistant', text: '<proposed_plan>first plan</proposed_plan>' },
        { kind: 'text', role: 'user', text: 'push back: keep plan events separate' },
        { kind: 'text', role: 'assistant', text: 'Let me revise the plan.' },
        { kind: 'text', role: 'assistant', text: '<proposed_plan>second plan</proposed_plan>' },
        {
          kind: 'tool_call',
          role: 'assistant',
          toolName: 'Edit',
          inputText: JSON.stringify({ file_path: '/repo/plan.md' }),
        },
        { kind: 'mode_change', mode: 'default', prevMode: 'plan' },
        {
          kind: 'tool_call',
          role: 'assistant',
          toolName: 'Edit',
          inputText: JSON.stringify({ file_path: '/repo/salience.ts' }),
        },
        { kind: 'text', role: 'assistant', text: 'Done — implemented.' },
      ]),
    )) as {
      timeline: Array<{ type: string; t: number; kind?: string; text?: string }>;
      mutations: Array<{ tool: string; path?: string; count: number }>;
    };

    expect(out.timeline).toEqual([
      { type: 'user', t: 0, text: 'update salience for plan mode' },
      { type: 'plan_enter', t: 1 },
      {
        type: 'assistant',
        t: 2,
        kind: 'proposed_plan',
        text: '<proposed_plan>first plan</proposed_plan>',
      },
      { type: 'user', t: 3, text: 'push back: keep plan events separate' },
      {
        type: 'assistant',
        t: 4,
        kind: 'proposed_plan',
        text: '<proposed_plan>second plan</proposed_plan>',
      },
      { type: 'plan_exit', t: 5 },
      { type: 'assistant', t: 6, kind: 'final', text: 'Done — implemented.' },
    ]);
    expect(out.mutations).toEqual([{ tool: 'Edit', path: '/repo/salience.ts', count: 1 }]);
  });

  it('captures Claude ExitPlanMode plans and skips synthetic interruption rows', async () => {
    const out = (await salienceCompactor.run(
      makeCtx([
        {
          kind: 'mode_change',
          mode: 'plan',
        },
        {
          kind: 'text',
          role: 'user',
          text: '<system_instruction>Keep this context</system_instruction>\n\nBuild the feature',
        },
        { kind: 'text', role: 'assistant', text: 'I have enough context. Writing the plan now.' },
        {
          kind: 'tool_call',
          role: 'assistant',
          toolName: 'ExitPlanMode',
          inputText: JSON.stringify({ plan: '# Plan\n\nImplement the feature.' }),
        },
        { kind: 'text', role: 'user', text: '[Request interrupted by user for tool use]' },
        { kind: 'text', role: 'user', text: 'change the plan' },
        {
          kind: 'tool_call',
          role: 'assistant',
          toolName: 'ExitPlanMode',
          inputText: JSON.stringify({ plan: '# Revised Plan\n\nKeep system instructions.' }),
        },
        { kind: 'mode_change', mode: 'default', prevMode: 'plan' },
        { kind: 'text', role: 'assistant', text: 'Done.' },
      ]),
    )) as {
      timeline: Array<{ type: string; t: number; kind?: string; text?: string }>;
    };

    expect(out.timeline).toEqual([
      {
        type: 'user',
        t: 0,
        text: '<system_instruction>Keep this context</system_instruction>\n\nBuild the feature',
      },
      { type: 'plan_enter', t: 1 },
      { type: 'assistant', t: 2, kind: 'proposed_plan', text: '# Plan\n\nImplement the feature.' },
      { type: 'user', t: 3, text: 'change the plan' },
      {
        type: 'assistant',
        t: 4,
        kind: 'proposed_plan',
        text: '# Revised Plan\n\nKeep system instructions.',
      },
      { type: 'plan_exit', t: 5 },
      { type: 'assistant', t: 6, kind: 'final', text: 'Done.' },
    ]);
  });

  it('replaces "PLEASE IMPLEMENT THIS PLAN" user echo with a placeholder so plan body is not duplicated', async () => {
    const planBody = '# Plan\n\nFull plan body that should not appear twice in the timeline.';
    const out = (await salienceCompactor.run(
      makeCtx([
        { kind: 'text', role: 'user', text: 'design the feature' },
        { kind: 'mode_change', mode: 'plan' },
        { kind: 'text', role: 'assistant', text: `<proposed_plan>\n${planBody}\n</proposed_plan>` },
        { kind: 'mode_change', mode: 'default', prevMode: 'plan' },
        { kind: 'text', role: 'user', text: `PLEASE IMPLEMENT THIS PLAN:\n${planBody}` },
        { kind: 'text', role: 'assistant', text: 'Done.' },
      ]),
    )) as {
      timeline: Array<{ type: string; t: number; kind?: string; text?: string }>;
    };

    const proposed = out.timeline.filter((i) => i.kind === 'proposed_plan');
    expect(proposed).toHaveLength(1);

    const echo = out.timeline.find(
      (i) => i.type === 'user' && i.text?.startsWith('PLEASE IMPLEMENT THIS PLAN'),
    );
    expect(echo).toBeDefined();
    expect(echo?.text).toBe(
      'PLEASE IMPLEMENT THIS PLAN: [plan details were sent again — skipped for compaction]',
    );
    expect(echo?.text).not.toContain('Full plan body');

    expect(out.timeline.some((i) => i.type === 'plan_enter')).toBe(true);
    expect(out.timeline.some((i) => i.type === 'plan_exit')).toBe(true);
    expect(out.timeline.some((i) => i.kind === 'final' && i.text === 'Done.')).toBe(true);
  });

  it('preserves single-line user feedback that starts with "PLEASE IMPLEMENT THIS PLAN:" verbatim', async () => {
    const feedback = 'PLEASE IMPLEMENT THIS PLAN: this line should be there too';
    const out = (await salienceCompactor.run(
      makeCtx([
        { kind: 'text', role: 'user', text: feedback },
        { kind: 'text', role: 'assistant', text: 'Acknowledged.' },
      ]),
    )) as {
      timeline: Array<{ type: string; t: number; kind?: string; text?: string }>;
    };

    const userItem = out.timeline.find((i) => i.type === 'user');
    expect(userItem).toBeDefined();
    expect(userItem?.text).toBe(feedback);
  });

  it('preserves full user and assistant narrative text while filtering standalone harness noise', async () => {
    const longUser = [
      '<system_instruction>Do not strip this.</system_instruction>',
      '',
      `Please keep this entire prompt: ${'x'.repeat(450)}`,
    ].join('\n');
    const longPlan = [
      '<proposed_plan>',
      '# Full plan',
      '',
      `- Preserve all detail: ${'y'.repeat(500)}`,
      '- Keep markdown and blank lines.',
      '</proposed_plan>',
    ].join('\n');

    const out = (await salienceCompactor.run(
      makeCtx([
        {
          kind: 'text',
          role: 'user',
          text: '<environment_context>\n  <cwd>/repo</cwd>\n</environment_context>',
        },
        { kind: 'text', role: 'user', text: '<turn_aborted>stale turn</turn_aborted>' },
        { kind: 'text', role: 'user', text: longUser },
        { kind: 'text', role: 'assistant', text: longPlan },
      ]),
    )) as {
      timeline: Array<{ type: string; t: number; kind?: string; text?: string }>;
      omitted?: Record<string, number>;
    };

    expect(out.timeline).toEqual([
      { type: 'user', t: 0, text: longUser },
      { type: 'assistant', t: 1, kind: 'proposed_plan', text: longPlan },
    ]);
    expect(out.timeline[0]!.text).not.toContain('…');
    expect(out.timeline[1]!.text).not.toContain('…');
    expect(out.omitted).toBeUndefined();
  });

  it('does not classify explanatory proposed_plan examples as real plans', async () => {
    const explanatoryText = [
      'No, that example should not become a plan.',
      '',
      '```json',
      '{ "text": "<proposed_plan>example only</proposed_plan>" }',
      '```',
    ].join('\n');

    const out = (await salienceCompactor.run(
      makeCtx([
        { kind: 'text', role: 'user', text: 'is this a plan?' },
        { kind: 'text', role: 'assistant', text: explanatoryText },
      ]),
    )) as {
      timeline: Array<{ type: string; t: number; kind?: string; text?: string }>;
    };

    expect(out.timeline).toEqual([
      { type: 'user', t: 0, text: 'is this a plan?' },
      { type: 'assistant', t: 1, kind: 'final', text: explanatoryText },
    ]);
  });

  it('does not treat successful read output containing Error as a tool failure', async () => {
    const out = (await salienceCompactor.run(
      makeCtx([
        { kind: 'text', role: 'user', text: 'inspect code' },
        { kind: 'tool_call', role: 'assistant', toolName: 'Read', toolCallId: 'r1' },
        {
          kind: 'tool_result',
          role: 'user',
          toolCallId: 'r1',
          isError: false,
          text: "if (!res.ok) throw new Error('bad response');",
        },
        { kind: 'tool_call', role: 'assistant', toolName: 'Bash', toolCallId: 'b1' },
        {
          kind: 'tool_result',
          role: 'user',
          toolCallId: 'b1',
          text: 'Error text from a successful command should not count',
        },
        { kind: 'tool_call', role: 'assistant', toolName: 'Bash', toolCallId: 'b2' },
        {
          kind: 'tool_result',
          role: 'user',
          toolCallId: 'b2',
          isError: true,
          text: 'Chunk ID: abc\nWall time: 0.0000 seconds\nProcess exited with code 127\nOutput:\nzsh:1: command not found: rg',
        },
        { kind: 'tool_call', role: 'assistant', toolName: 'ExitPlanMode', toolCallId: 'p1' },
        {
          kind: 'tool_result',
          role: 'user',
          toolCallId: 'p1',
          isError: true,
          text: "The user doesn't want to proceed with this tool use.",
        },
      ]),
    )) as { errors: Array<{ tool?: string; sig: string }> };

    expect(out.errors).toEqual([{ tool: 'Bash', sig: 'zsh:1: command not found: rg' }]);
  });

  it('does not record Claude plan-file edits as implementation mutations', async () => {
    const out = (await salienceCompactor.run(
      makeCtx([
        { kind: 'text', role: 'user', text: 'revise the plan' },
        {
          kind: 'tool_call',
          role: 'assistant',
          toolName: 'Edit',
          inputText: JSON.stringify({ file_path: '/Users/me/.claude/plans/session-plan.md' }),
        },
        {
          kind: 'tool_call',
          role: 'assistant',
          toolName: 'Edit',
          inputText: JSON.stringify({ file_path: '/repo/src/file.ts' }),
        },
      ]),
    )) as { mutations: Array<{ tool: string; path?: string; count: number }> };

    expect(out.mutations).toEqual([{ tool: 'Edit', path: '/repo/src/file.ts', count: 1 }]);
  });

  it('deduplicates repeated mutations against the same target', async () => {
    const out = (await salienceCompactor.run(
      makeCtx([
        {
          kind: 'tool_call',
          role: 'assistant',
          toolName: 'Edit',
          inputText: JSON.stringify({ file_path: '/repo/src/file.ts' }),
        },
        {
          kind: 'tool_call',
          role: 'assistant',
          toolName: 'Edit',
          inputText: JSON.stringify({ file_path: '/repo/src/file.ts' }),
        },
        {
          kind: 'tool_call',
          role: 'assistant',
          toolName: 'Edit',
          inputText: JSON.stringify({ file_path: '/repo/src/file.ts' }),
        },
      ]),
    )) as { mutations: Array<{ tool: string; path?: string; count: number }> };

    expect(out.mutations).toEqual([{ tool: 'Edit', path: '/repo/src/file.ts', count: 3 }]);
  });

  it('reports omitted mutations while still counting repeats after the cap', async () => {
    const events: Partial<TranscriptEvent>[] = Array.from({ length: 51 }, (_, idx) => ({
      kind: 'tool_call',
      role: 'assistant',
      toolName: 'Edit',
      inputText: JSON.stringify({ file_path: `/repo/src/file-${idx}.ts` }),
    }));
    events.push({
      kind: 'tool_call',
      role: 'assistant',
      toolName: 'Edit',
      inputText: JSON.stringify({ file_path: '/repo/src/file-0.ts' }),
    });

    const out = (await salienceCompactor.run(makeCtx(events))) as {
      mutations: Array<{ tool: string; path?: string; count: number }>;
      omitted?: Record<string, number>;
    };

    expect(out.mutations).toHaveLength(50);
    expect(out.mutations[0]).toEqual({ tool: 'Edit', path: '/repo/src/file-0.ts', count: 2 });
    expect(out.omitted?.mutations).toBe(1);
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

import { describe, it, expect } from 'vitest';
import { planModeEnricher } from '../plan-mode.js';
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

describe('planModeEnricher', () => {
  it('reports never-entered when there are no mode_change events', async () => {
    const result = await planModeEnricher.run(makeCtx([
      { kind: 'text', role: 'user', text: 'hello' },
      { kind: 'tool_call', toolName: 'Bash' },
    ])) as any;
    expect(result.entered).toBe(false);
    expect(result.enterCount).toBe(0);
    expect(result.exitCount).toBe(0);
    expect(result.unclosed).toBe(false);
    expect(result.totalDurationMs).toBe(0);
    expect(result.toolCallsInPlan).toEqual({});
    expect(result.toolCallsOutOfPlan).toEqual({ Bash: 1 });
  });

  it('tracks a complete plan enter -> exit interval', async () => {
    const result = await planModeEnricher.run(makeCtx([
      { ts: 1000, kind: 'mode_change', mode: 'plan' },
      { ts: 1100, kind: 'text', role: 'user', text: 'go' },
      { ts: 1200, kind: 'tool_call', toolName: 'Read' },
      { ts: 1300, kind: 'tool_call', toolName: 'ExitPlanMode' },
      { ts: 1400, kind: 'mode_change', mode: 'default', prevMode: 'plan' },
      { ts: 1500, kind: 'tool_call', toolName: 'Edit' },
    ])) as any;
    expect(result.entered).toBe(true);
    expect(result.enterCount).toBe(1);
    expect(result.exitCount).toBe(1);
    expect(result.unclosed).toBe(false);
    expect(result.totalDurationMs).toBe(400);
    expect(result.toolCallsInPlan).toEqual({ Read: 1, ExitPlanMode: 1 });
    expect(result.toolCallsOutOfPlan).toEqual({ Edit: 1 });
    expect(result.userPromptsInPlan).toBe(1);
    expect(result.proposedPlanFinalized).toBe(1);
    expect(result.firstEnterTs).toBe(1000);
    expect(result.lastExitTs).toBe(1400);
  });

  it('marks unclosed when session ends while in plan', async () => {
    const result = await planModeEnricher.run(makeCtx([
      { ts: 1000, kind: 'mode_change', mode: 'plan' },
      { ts: 1500, kind: 'text', role: 'user', text: 'still planning' },
    ])) as any;
    expect(result.unclosed).toBe(true);
    expect(result.exitCount).toBe(0);
    expect(result.totalDurationMs).toBe(500);
  });

  it('counts <proposed_plan> blocks in text', async () => {
    const result = await planModeEnricher.run(makeCtx([
      { ts: 1000, kind: 'mode_change', mode: 'plan' },
      { ts: 1100, kind: 'text', role: 'assistant', text: '<proposed_plan>step</proposed_plan>' },
      { ts: 1200, kind: 'mode_change', mode: 'default', prevMode: 'plan' },
    ])) as any;
    expect(result.proposedPlanFinalized).toBe(1);
  });

  it('tracks multiple plan entries', async () => {
    const result = await planModeEnricher.run(makeCtx([
      { ts: 1000, kind: 'mode_change', mode: 'plan' },
      { ts: 1100, kind: 'mode_change', mode: 'default', prevMode: 'plan' },
      { ts: 1200, kind: 'mode_change', mode: 'plan', prevMode: 'default' },
      { ts: 1400, kind: 'mode_change', mode: 'default', prevMode: 'plan' },
    ])) as any;
    expect(result.enterCount).toBe(2);
    expect(result.exitCount).toBe(2);
    expect(result.totalDurationMs).toBe(300);
    expect(result.modes).toEqual({ plan: 2, default: 2 });
  });
});

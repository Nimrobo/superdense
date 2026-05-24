import type { Enricher } from './types.js';

interface PlanMode {
  v: 1;
  entered: boolean;
  enterCount: number;
  exitCount: number;
  unclosed: boolean;
  totalDurationMs: number;
  proposedPlanFinalized: number;
  toolCallsInPlan: Record<string, number>;
  toolCallsOutOfPlan: Record<string, number>;
  userPromptsInPlan: number;
  modes: Record<string, number>;
  firstEnterTs?: number;
  lastExitTs?: number;
}

const PROPOSED_PLAN_RE = /<proposed_plan>/g;

export const planModeEnricher: Enricher = {
  name: 'plan_mode',
  version: 1,
  returns: 'json',
  alwaysRun: true,
  description:
    'Plan-mode entry/exit summary derived from mode_change events: counts, total duration, tool calls and user prompts segmented by whether the agent was in plan mode.',
  async run(ctx) {
    const out: PlanMode = {
      v: 1,
      entered: false,
      enterCount: 0,
      exitCount: 0,
      unclosed: false,
      totalDurationMs: 0,
      proposedPlanFinalized: 0,
      toolCallsInPlan: {},
      toolCallsOutOfPlan: {},
      userPromptsInPlan: 0,
      modes: {},
    };

    let currentMode: string | undefined;
    let planEnterTs: number | undefined;
    let lastEventTs: number | undefined;

    for await (const ev of ctx.iterEvents(ctx.logPath)) {
      if (typeof ev.ts === 'number') lastEventTs = ev.ts;

      if (ev.kind === 'mode_change') {
        const mode = ev.mode;
        if (!mode) continue;
        out.modes[mode] = (out.modes[mode] ?? 0) + 1;
        const wasPlan = currentMode === 'plan';
        const isPlan = mode === 'plan';
        if (isPlan && !wasPlan) {
          out.entered = true;
          out.enterCount += 1;
          planEnterTs = ev.ts;
          if (out.firstEnterTs == null && typeof ev.ts === 'number') out.firstEnterTs = ev.ts;
        } else if (!isPlan && wasPlan) {
          out.exitCount += 1;
          if (typeof ev.ts === 'number') out.lastExitTs = ev.ts;
          if (planEnterTs != null && typeof ev.ts === 'number') {
            out.totalDurationMs += Math.max(0, ev.ts - planEnterTs);
          }
          planEnterTs = undefined;
        }
        currentMode = mode;
        continue;
      }

      const inPlan = currentMode === 'plan';
      if (ev.kind === 'tool_call' && ev.toolName) {
        const bucket = inPlan ? out.toolCallsInPlan : out.toolCallsOutOfPlan;
        bucket[ev.toolName] = (bucket[ev.toolName] ?? 0) + 1;
        if (ev.toolName === 'ExitPlanMode') out.proposedPlanFinalized += 1;
      } else if (ev.kind === 'text') {
        if (inPlan && ev.role === 'user') out.userPromptsInPlan += 1;
        if (typeof ev.text === 'string') {
          const matches = ev.text.match(PROPOSED_PLAN_RE);
          if (matches) out.proposedPlanFinalized += matches.length;
        }
      }
    }

    if (currentMode === 'plan') {
      out.unclosed = true;
      if (planEnterTs != null && lastEventTs != null) {
        out.totalDurationMs += Math.max(0, lastEventTs - planEnterTs);
      }
    }

    return out;
  },
};

import type { TranscriptEvent } from '../types.js';
import type { Enricher } from './types.js';

export interface TurnLatencyTurn {
  startTs: number;
  endTs: number;
  durationMs: number;
}

export interface TurnLatencyValue {
  v: 1;
  count: number;
  minMs: number | null;
  maxMs: number | null;
  avgMs: number | null;
  medianMs: number | null;
  p90Ms: number | null;
  turns: TurnLatencyTurn[];
}

function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, idx))]!;
}

export function summarizeTurnDurations(durations: number[]): Omit<TurnLatencyValue, 'v' | 'turns'> {
  if (durations.length === 0) {
    return {
      count: 0,
      minMs: null,
      maxMs: null,
      avgMs: null,
      medianMs: null,
      p90Ms: null,
    };
  }

  const sorted = durations.slice().sort((a, b) => a - b);
  const sum = sorted.reduce((total, value) => total + value, 0);
  return {
    count: sorted.length,
    minMs: sorted[0]!,
    maxMs: sorted[sorted.length - 1]!,
    avgMs: sum / sorted.length,
    medianMs: percentile(sorted, 50),
    p90Ms: percentile(sorted, 90),
  };
}

function isHumanPrompt(ev: TranscriptEvent): boolean {
  return ev.kind === 'text' && ev.role === 'user';
}

function isAgentActivity(ev: TranscriptEvent): boolean {
  return ev.role === 'assistant' || ev.kind === 'tool_call' || ev.kind === 'tool_result';
}

export const turnLatencyEnricher: Enricher = {
  name: 'turn_latency',
  version: 1,
  returns: 'json',
  alwaysRun: true,
  description:
    'Full-turn response latency from each user prompt to the last assistant/tool event before the next user prompt or EOF.',
  async run(ctx) {
    const turns: TurnLatencyTurn[] = [];
    let current: { startTs: number; endTs?: number } | null = null;

    const finishCurrent = () => {
      if (!current || current.endTs == null) {
        current = null;
        return;
      }
      const durationMs = current.endTs - current.startTs;
      if (durationMs >= 0) {
        turns.push({ startTs: current.startTs, endTs: current.endTs, durationMs });
      }
      current = null;
    };

    for await (const ev of ctx.iterEvents(ctx.logPath)) {
      if (isHumanPrompt(ev)) {
        if (current?.endTs != null) finishCurrent();
        if (!current && typeof ev.ts === 'number') current = { startTs: ev.ts };
        continue;
      }

      if (current && typeof ev.ts === 'number' && isAgentActivity(ev)) {
        current.endTs = ev.ts;
      }
    }

    finishCurrent();
    const stats = summarizeTurnDurations(turns.map((turn) => turn.durationMs));
    const out: TurnLatencyValue = { v: 1, ...stats, turns };
    return out;
  },
};

import type { Enricher } from './types.js';

const IDLE_THRESHOLD_MS = 5 * 60 * 1000;

interface ActiveDuration {
  v: 1;
  activeMs: number;
  wallMs: number;
  idleMs: number;
  eventCount: number;
  maxGapMs: number;
  idleThresholdMs: number;
}

export const activeDurationEnricher: Enricher = {
  name: 'active_duration',
  version: 1,
  returns: 'json',
  alwaysRun: true,
  description:
    'Active conversation time computed from inter-event timestamps. Gaps longer than the idle threshold (5 min) are excluded, so a session left open does not inflate the duration.',
  async run(ctx) {
    const timestamps: number[] = [];
    for await (const ev of ctx.iterEvents(ctx.logPath)) {
      if (typeof ev.ts === 'number') timestamps.push(ev.ts);
    }
    timestamps.sort((a, b) => a - b);

    const out: ActiveDuration = {
      v: 1,
      activeMs: 0,
      wallMs: 0,
      idleMs: 0,
      eventCount: timestamps.length,
      maxGapMs: 0,
      idleThresholdMs: IDLE_THRESHOLD_MS,
    };

    if (timestamps.length < 2) return out;

    out.wallMs = timestamps[timestamps.length - 1]! - timestamps[0]!;
    for (let i = 1; i < timestamps.length; i++) {
      const gap = timestamps[i]! - timestamps[i - 1]!;
      if (gap > out.maxGapMs) out.maxGapMs = gap;
      if (gap <= IDLE_THRESHOLD_MS) out.activeMs += gap;
      else out.idleMs += gap;
    }

    return out;
  },
};

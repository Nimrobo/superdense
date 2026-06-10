import { describe, expect, it } from 'vitest';
import type { TranscriptEvent } from '../types.js';
import { turnLatencyEnricher, type TurnLatencyValue } from './turn-latency.js';

async function run(events: TranscriptEvent[]): Promise<TurnLatencyValue> {
  const iterEvents = async function* () {
    for (const event of events) yield event;
  };
  return (await turnLatencyEnricher.run({
    session: {
      id: 's1',
      agent: 'test',
      sessionId: 'native-s1',
      logPath: '/tmp/s1',
      pwd: '/repo',
      projectKey: '/repo',
    },
    logPath: '/tmp/s1',
    iterEvents,
  })) as TurnLatencyValue;
}

describe('turnLatencyEnricher', () => {
  it('measures a single prompt through the final assistant event', async () => {
    const result = await run([
      { ts: 1000, kind: 'text', role: 'user', text: 'Fix it' },
      { ts: 1500, kind: 'text', role: 'assistant', text: 'Working' },
      { ts: 5000, kind: 'text', role: 'assistant', text: 'Done' },
    ]);

    expect(result.count).toBe(1);
    expect(result.turns).toEqual([{ startTs: 1000, endTs: 5000, durationMs: 4000 }]);
    expect(result).toMatchObject({ minMs: 4000, maxMs: 4000, avgMs: 4000, medianMs: 4000 });
  });

  it('measures multiple user turns', async () => {
    const result = await run([
      { ts: 1000, kind: 'text', role: 'user', text: 'One' },
      { ts: 2000, kind: 'text', role: 'assistant', text: 'A' },
      { ts: 3000, kind: 'text', role: 'user', text: 'Two' },
      { ts: 9000, kind: 'text', role: 'assistant', text: 'B' },
    ]);

    expect(result.turns.map((turn) => turn.durationMs)).toEqual([1000, 6000]);
    expect(result).toMatchObject({ count: 2, medianMs: 1000, p90Ms: 6000 });
  });

  it('coalesces consecutive user text before assistant output', async () => {
    const result = await run([
      { ts: 1000, kind: 'text', role: 'user', text: 'First line' },
      { ts: 2000, kind: 'text', role: 'user', text: 'Second line' },
      { ts: 5000, kind: 'text', role: 'assistant', text: 'Reply' },
    ]);

    expect(result.turns).toEqual([{ startTs: 1000, endTs: 5000, durationMs: 4000 }]);
  });

  it('counts tool calls and tool results as agent activity', async () => {
    const result = await run([
      { ts: 1000, kind: 'text', role: 'user', text: 'Run tests' },
      { ts: 2000, kind: 'tool_call', role: 'assistant', toolName: 'bash' },
      { ts: 7000, kind: 'tool_result', role: 'user', toolCallId: 't1', text: 'ok' },
      { ts: 8000, kind: 'text', role: 'user', text: 'Thanks' },
    ]);

    expect(result.turns).toEqual([{ startTs: 1000, endTs: 7000, durationMs: 6000 }]);
  });

  it('skips turns with missing timestamps, no response, or negative duration', async () => {
    const result = await run([
      { kind: 'text', role: 'user', text: 'No timestamp' },
      { ts: 2000, kind: 'text', role: 'assistant', text: 'Ignored' },
      { ts: 4000, kind: 'text', role: 'user', text: 'Negative' },
      { ts: 3500, kind: 'text', role: 'assistant', text: 'Earlier' },
      { ts: 5000, kind: 'text', role: 'user', text: 'Valid' },
      { ts: 8000, kind: 'text', role: 'assistant', text: 'Done' },
      { ts: 9000, kind: 'text', role: 'user', text: 'No response' },
    ]);

    expect(result.turns).toEqual([{ startTs: 5000, endTs: 8000, durationMs: 3000 }]);
    expect(result.count).toBe(1);
  });
});

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { claudeCodeAdapter } from '../src/adapters/claude-code.js';

let tempDir: string | undefined;

afterEach(async () => {
  if (!tempDir) return;
  await rm(tempDir, { recursive: true, force: true });
  tempDir = undefined;
});

async function collectEvents(lines: unknown[]) {
  tempDir = await mkdtemp(join(tmpdir(), 'road42-claude-test-'));
  const logPath = join(tempDir, 'session.jsonl');
  await writeFile(logPath, lines.map((line) => JSON.stringify(line)).join('\n'), 'utf8');

  const events = [];
  for await (const event of claudeCodeAdapter.iterEvents(logPath)) events.push(event);
  return events;
}

describe('claudeCodeAdapter.iterEvents', () => {
  it('normalizes Claude tool calls and results with pairable ids', async () => {
    const events = await collectEvents([
      {
        type: 'assistant',
        timestamp: '2026-05-21T04:00:00.000Z',
        message: {
          role: 'assistant',
          content: [
            { type: 'text', text: 'I will run a command.' },
            {
              type: 'tool_use',
              id: 'toolu_test_123',
              name: 'Bash',
              input: { command: 'printf hi' },
            },
          ],
        },
      },
      {
        type: 'user',
        timestamp: '2026-05-21T04:00:01.000Z',
        message: {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'toolu_test_123',
              content: 'hi',
            },
          ],
        },
        toolUseResult: { stdout: 'hi', stderr: '' },
      },
      {
        type: 'assistant',
        timestamp: '2026-05-21T04:00:02.000Z',
        message: { role: 'assistant', content: 'Done.' },
      },
    ]);

    expect(events).toMatchObject([
      { kind: 'text', role: 'assistant', text: 'I will run a command.' },
      {
        kind: 'tool_call',
        role: 'assistant',
        toolCallId: 'toolu_test_123',
        toolName: 'Bash',
        inputText: '{"command":"printf hi"}',
      },
      { kind: 'tool_result', role: 'user', toolCallId: 'toolu_test_123', text: 'hi' },
      { kind: 'text', role: 'assistant', text: 'Done.' },
    ]);
  });

  it('normalizes array tool result content without emitting ordinary user text', async () => {
    const events = await collectEvents([
      {
        type: 'user',
        timestamp: '2026-05-21T04:00:01.000Z',
        message: {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'toolu_array_result',
              content: [{ type: 'text', text: 'line one' }, { type: 'text', text: 'line two' }],
            },
          ],
        },
      },
    ]);

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: 'tool_result',
      role: 'user',
      toolCallId: 'toolu_array_result',
      text: 'line one\nline two',
    });
  });

  it('skips Claude metadata records that are not transcript turns', async () => {
    const events = await collectEvents([
      { type: 'queue-operation', operation: 'add', timestamp: '2026-05-21T04:00:00.000Z', content: 'queued prompt' },
      { type: 'attachment', timestamp: '2026-05-21T04:00:01.000Z', attachment: { type: 'skill_listing', content: 'skills' } },
      { type: 'ai-title', aiTitle: 'Generated title', sessionId: 'session-1' },
      { type: 'last-prompt', lastPrompt: 'Last prompt preview', sessionId: 'session-1' },
      {
        type: 'user',
        timestamp: '2026-05-21T04:00:02.000Z',
        message: { role: 'user', content: 'Actual user turn' },
      },
      {
        type: 'system',
        timestamp: '2026-05-21T04:00:03.000Z',
        message: { role: 'system', content: 'Actual system turn' },
      },
    ]);

    expect(events).toMatchObject([
      { kind: 'text', role: 'user', text: 'Actual user turn' },
      { kind: 'text', role: 'system', text: 'Actual system turn' },
    ]);
  });
});

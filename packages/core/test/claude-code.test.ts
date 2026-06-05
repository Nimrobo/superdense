import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { claudeCodeAdapter } from '../src/adapters/claude-code.js';

let tempDir: string | undefined;
const originalClaudeProjectsDir = process.env.CLAUDE_PROJECTS_DIR;

afterEach(async () => {
  if (originalClaudeProjectsDir == null) delete process.env.CLAUDE_PROJECTS_DIR;
  else process.env.CLAUDE_PROJECTS_DIR = originalClaudeProjectsDir;
  if (!tempDir) return;
  await rm(tempDir, { recursive: true, force: true });
  tempDir = undefined;
});

async function collectEvents(lines: unknown[]) {
  tempDir = await mkdtemp(join(tmpdir(), 'superdense-claude-test-'));
  const logPath = join(tempDir, 'session.jsonl');
  await writeFile(logPath, lines.map((line) => JSON.stringify(line)).join('\n'), 'utf8');

  const events = [];
  for await (const event of claudeCodeAdapter.iterEvents(logPath)) events.push(event);
  return events;
}

describe('claudeCodeAdapter discovery', () => {
  it('excludes sub-agent transcripts from root discovery', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'superdense-claude-discovery-'));
    const projectsDir = join(tempDir, 'projects');
    const projectDir = join(projectsDir, '-repo');
    const rootPath = join(projectDir, 'root.jsonl');
    const childPath = join(projectDir, 'root', 'subagents', 'agent-worker.jsonl');
    await mkdir(join(projectDir, 'root', 'subagents'), { recursive: true });
    await writeFile(
      rootPath,
      JSON.stringify({
        cwd: '/repo',
        type: 'user',
        message: { role: 'user', content: 'Root prompt' },
      }),
      'utf8',
    );
    await writeFile(
      childPath,
      JSON.stringify({
        cwd: '/repo',
        type: 'user',
        message: { role: 'user', content: 'Child prompt' },
      }),
      'utf8',
    );
    await writeFile(
      join(projectDir, 'sessions-index.json'),
      JSON.stringify({
        version: 1,
        entries: [
          { sessionId: 'root', fullPath: rootPath, projectPath: '/repo' },
          { sessionId: 'child', fullPath: childPath, projectPath: '/repo' },
        ],
      }),
      'utf8',
    );
    process.env.CLAUDE_PROJECTS_DIR = projectsDir;

    const sessions = await claudeCodeAdapter.discover();

    expect(sessions.map((s) => s.sessionId)).toEqual(['root']);
  });

  it('discovers direct sub-agent transcripts with parent-scoped ids and metadata', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'superdense-claude-subagents-'));
    const projectsDir = join(tempDir, 'projects');
    const subagentsDir = join(projectsDir, '-repo', 'parent-1', 'subagents');
    const childPath = join(subagentsDir, 'agent-worker.jsonl');
    await mkdir(subagentsDir, { recursive: true });
    await writeFile(
      childPath,
      JSON.stringify({
        cwd: '/repo',
        agentId: 'json-id',
        slug: 'audit-tests',
        type: 'user',
        message: { role: 'user', content: 'Audit the tests' },
      }),
      'utf8',
    );
    process.env.CLAUDE_PROJECTS_DIR = projectsDir;

    const children = await claudeCodeAdapter.discoverSubAgentSessions('parent-1');

    expect(children).toHaveLength(1);
    expect(children[0]).toMatchObject({
      relation: 'subagent',
      metadata: { agentId: 'json-id', slug: 'audit-tests' },
      session: {
        sessionId: 'parent-1:agent-json-id',
        logPath: childPath,
        pwd: '/repo',
        firstPrompt: 'Audit the tests',
      },
    });
  });
});

describe('claudeCodeAdapter.iterEvents', () => {
  it('normalizes assistant usage rows into usage events', async () => {
    const events = await collectEvents([
      {
        type: 'assistant',
        timestamp: '2026-05-21T04:00:00.000Z',
        message: {
          role: 'assistant',
          model: 'claude-haiku-4-5-20251001',
          usage: {
            input_tokens: 1000,
            cache_read_input_tokens: 200,
            cache_creation_input_tokens: 300,
            cache_creation: {
              ephemeral_5m_input_tokens: 100,
              ephemeral_1h_input_tokens: 200,
            },
            output_tokens: 50,
          },
          content: 'Done',
        },
      },
    ]);

    expect(events).toContainEqual(
      expect.objectContaining({
        kind: 'usage',
        model: 'claude-haiku-4-5-20251001',
        modelProvider: 'anthropic',
        tokenUsage: expect.objectContaining({
          inputTokens: 1000,
          cachedInputTokens: 200,
          cacheCreationInputTokens: 300,
          cacheCreation5mInputTokens: 100,
          cacheCreation1hInputTokens: 200,
          outputTokens: 50,
        }),
      }),
    );
  });

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
              is_error: false,
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
      {
        kind: 'tool_result',
        role: 'user',
        toolCallId: 'toolu_test_123',
        text: 'hi',
        isError: false,
      },
      { kind: 'text', role: 'assistant', text: 'Done.' },
    ]);
  });

  it('preserves Claude tool result error status', async () => {
    const events = await collectEvents([
      {
        type: 'user',
        timestamp: '2026-05-21T04:00:01.000Z',
        message: {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'toolu_failed',
              content: 'fatal: command failed',
              is_error: true,
            },
          ],
        },
      },
    ]);

    expect(events).toMatchObject([
      {
        kind: 'tool_result',
        role: 'user',
        toolCallId: 'toolu_failed',
        text: 'fatal: command failed',
        isError: true,
      },
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
              content: [
                { type: 'text', text: 'line one' },
                { type: 'text', text: 'line two' },
              ],
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

  it('emits mode_change on permissionMode transitions only', async () => {
    const events = await collectEvents([
      {
        type: 'user',
        timestamp: '2026-05-21T04:00:00.000Z',
        permissionMode: 'plan',
        message: { role: 'user', content: 'first in plan' },
      },
      {
        type: 'assistant',
        timestamp: '2026-05-21T04:00:01.000Z',
        permissionMode: 'plan',
        message: { role: 'assistant', content: 'still plan' },
      },
      {
        type: 'user',
        timestamp: '2026-05-21T04:00:02.000Z',
        permissionMode: 'default',
        message: { role: 'user', content: 'back to default' },
      },
    ]);

    const modeChanges = events.filter((e) => e.kind === 'mode_change');
    expect(modeChanges).toEqual([
      {
        ts: Date.parse('2026-05-21T04:00:00.000Z'),
        kind: 'mode_change',
        mode: 'plan',
        prevMode: undefined,
      },
      {
        ts: Date.parse('2026-05-21T04:00:02.000Z'),
        kind: 'mode_change',
        mode: 'default',
        prevMode: 'plan',
      },
    ]);
  });

  it('defers mode_change to the next timestamped row when the permissionMode row has no timestamp', async () => {
    const events = await collectEvents([
      // Standalone permission-mode row without a timestamp — must not consume
      // the transition; the next timestamped row sharing the mode should emit
      // it so duration math has a real anchor.
      { permissionMode: 'plan' },
      {
        type: 'user',
        timestamp: '2026-05-21T04:00:00.000Z',
        permissionMode: 'plan',
        message: { role: 'user', content: 'first ts in plan' },
      },
      { permissionMode: 'default' },
      {
        type: 'assistant',
        timestamp: '2026-05-21T04:00:05.000Z',
        permissionMode: 'default',
        message: { role: 'assistant', content: 'exited' },
      },
    ]);

    const modeChanges = events.filter((e) => e.kind === 'mode_change');
    expect(modeChanges).toEqual([
      {
        ts: Date.parse('2026-05-21T04:00:00.000Z'),
        kind: 'mode_change',
        mode: 'plan',
        prevMode: undefined,
      },
      {
        ts: Date.parse('2026-05-21T04:00:05.000Z'),
        kind: 'mode_change',
        mode: 'default',
        prevMode: 'plan',
      },
    ]);
  });

  it('flushes a pending mode_change at EOF using the last observed timestamp', async () => {
    // Real Claude sessions emit trailing {type:"permission-mode",...} rows with
    // no timestamp after the final transcript turn. The exit must still be
    // recorded so plan_mode.unclosed / lastExitTs are accurate.
    const events = await collectEvents([
      {
        type: 'user',
        timestamp: '2026-05-21T04:00:00.000Z',
        permissionMode: 'plan',
        message: { role: 'user', content: 'in plan' },
      },
      {
        type: 'assistant',
        timestamp: '2026-05-21T04:00:05.000Z',
        permissionMode: 'plan',
        message: { role: 'assistant', content: 'still plan' },
      },
      { type: 'permission-mode', permissionMode: 'default' },
    ]);

    const modeChanges = events.filter((e) => e.kind === 'mode_change');
    expect(modeChanges).toEqual([
      {
        ts: Date.parse('2026-05-21T04:00:00.000Z'),
        kind: 'mode_change',
        mode: 'plan',
        prevMode: undefined,
      },
      {
        ts: Date.parse('2026-05-21T04:00:05.000Z'),
        kind: 'mode_change',
        mode: 'default',
        prevMode: 'plan',
      },
    ]);
  });

  it('skips Claude metadata records that are not transcript turns', async () => {
    const events = await collectEvents([
      {
        type: 'queue-operation',
        operation: 'add',
        timestamp: '2026-05-21T04:00:00.000Z',
        content: 'queued prompt',
      },
      {
        type: 'attachment',
        timestamp: '2026-05-21T04:00:01.000Z',
        attachment: { type: 'skill_listing', content: 'skills' },
      },
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

  it('emits mode_change to default after an approved ExitPlanMode tool_result (toolUseResult.plan object)', async () => {
    const events = await collectEvents([
      {
        type: 'assistant',
        timestamp: '2026-05-21T04:00:00.000Z',
        permissionMode: 'plan',
        message: {
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: 'toolu_epm_approve_1',
              name: 'ExitPlanMode',
              input: { plan: '# Plan body' },
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
              tool_use_id: 'toolu_epm_approve_1',
              content: 'User has approved your plan. You can now start coding.',
            },
          ],
        },
        toolUseResult: { plan: '# Plan body', isAgent: false, filePath: '/tmp/plan.md' },
      },
    ]);

    const kinds = events.map((e) => e.kind);
    expect(kinds).toContain('mode_change');
    const lastModeChange = events.filter((e) => e.kind === 'mode_change').pop();
    expect(lastModeChange).toMatchObject({
      kind: 'mode_change',
      mode: 'default',
      prevMode: 'plan',
    });

    const toolResultIdx = events.findIndex(
      (e) => e.kind === 'tool_result' && e.toolCallId === 'toolu_epm_approve_1',
    );
    const modeChangeIdx = events.findIndex((e) => e.kind === 'mode_change' && e.mode === 'default');
    expect(toolResultIdx).toBeGreaterThanOrEqual(0);
    expect(modeChangeIdx).toBeGreaterThan(toolResultIdx);
  });

  it('does not emit mode_change for a rejected ExitPlanMode tool_result (toolUseResult string)', async () => {
    const events = await collectEvents([
      {
        type: 'assistant',
        timestamp: '2026-05-21T04:00:00.000Z',
        permissionMode: 'plan',
        message: {
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: 'toolu_epm_reject_1',
              name: 'ExitPlanMode',
              input: { plan: '# Plan body' },
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
              tool_use_id: 'toolu_epm_reject_1',
              content: "The user doesn't want to proceed with this tool use.",
              is_error: true,
            },
          ],
        },
        toolUseResult: 'User rejected tool use',
      },
    ]);

    const modeChanges = events.filter((e) => e.kind === 'mode_change');
    expect(modeChanges).toHaveLength(1);
    expect(modeChanges[0]).toMatchObject({ mode: 'plan' });
  });

  it('emits mode_change to plan before a subsequent ExitPlanMode tool_use after a prior approval', async () => {
    const events = await collectEvents([
      {
        type: 'assistant',
        timestamp: '2026-05-21T04:00:00.000Z',
        permissionMode: 'plan',
        message: {
          role: 'assistant',
          content: [
            { type: 'tool_use', id: 'toolu_a', name: 'ExitPlanMode', input: { plan: '# A' } },
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
              tool_use_id: 'toolu_a',
              content: 'User has approved your plan.',
            },
          ],
        },
        toolUseResult: { plan: '# A' },
      },
      {
        type: 'assistant',
        timestamp: '2026-05-21T04:00:02.000Z',
        message: {
          role: 'assistant',
          content: [
            { type: 'tool_use', id: 'toolu_b', name: 'ExitPlanMode', input: { plan: '# B' } },
          ],
        },
      },
    ]);

    const modes = events.filter((e) => e.kind === 'mode_change').map((e: any) => e.mode);
    expect(modes).toEqual(['plan', 'default', 'plan']);

    const toolBIdx = events.findIndex((e) => e.kind === 'tool_call' && e.toolCallId === 'toolu_b');
    const planEnterBeforeB = events
      .slice(0, toolBIdx)
      .filter((e) => e.kind === 'mode_change' && (e as any).mode === 'plan').length;
    expect(planEnterBeforeB).toBe(2);
  });
});

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { claudeCodeAdapter } from '../../adapters/claude-code.js';
import type { Session } from '../../types.js';
import { workflowSummaryEnricher, type WorkflowSummaryValue } from '../workflow-summary.js';

let tempDir: string | undefined;
const ORIGINAL_TMP_DIR = process.env.SUPERDENSE_CLAUDE_TMP_DIR;

afterEach(async () => {
  if (ORIGINAL_TMP_DIR === undefined) delete process.env.SUPERDENSE_CLAUDE_TMP_DIR;
  else process.env.SUPERDENSE_CLAUDE_TMP_DIR = ORIGINAL_TMP_DIR;
  if (!tempDir) return;
  await rm(tempDir, { recursive: true, force: true });
  tempDir = undefined;
});

/** Write a transcript JSONL from raw line objects and return its path + session. */
async function setupSession(
  prefix: string,
  lines: unknown[],
): Promise<{ projectDir: string; sessionId: string; logPath: string; session: Session }> {
  tempDir = await mkdtemp(join(tmpdir(), prefix));
  const projectDir = join(tempDir, '-repo');
  const sessionId = 'session-1';
  const logPath = join(projectDir, `${sessionId}.jsonl`);
  await mkdir(join(projectDir, sessionId, 'workflows'), { recursive: true });
  await writeFile(logPath, lines.map((line) => JSON.stringify(line)).join('\n'), 'utf8');
  const session: Session = {
    id: `claude-code:${sessionId}`,
    agent: 'claude-code',
    sessionId,
    logPath,
    pwd: '/repo',
    projectKey: '/repo',
  };
  return { projectDir, sessionId, logPath, session };
}

async function runEnricher(logPath: string, session: Session): Promise<WorkflowSummaryValue> {
  return (await workflowSummaryEnricher.run({
    session,
    logPath,
    iterEvents: () => claudeCodeAdapter.iterEvents(logPath),
  })) as WorkflowSummaryValue;
}

function workflowToolUse(id: string) {
  return {
    type: 'assistant',
    message: {
      role: 'assistant',
      content: [{ type: 'tool_use', id, name: 'Workflow', input: {} }],
    },
  };
}

function writeRun(
  projectDir: string,
  sessionId: string,
  file: string,
  body: unknown,
): Promise<void> {
  return writeFile(join(projectDir, sessionId, 'workflows', file), JSON.stringify(body), 'utf8');
}

describe('workflowSummaryEnricher', () => {
  it('summarizes Claude Code dynamic workflow metadata and transcript settings evidence', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'superdense-workflow-summary-'));
    const projectDir = join(tempDir, '-repo');
    const sessionId = 'session-1';
    const logPath = join(projectDir, `${sessionId}.jsonl`);
    await mkdir(join(projectDir, sessionId, 'workflows'), { recursive: true });
    await writeFile(
      logPath,
      [
        {
          type: 'user',
          message: {
            role: 'user',
            content:
              '<command-name>/config</command-name>\n<local-command-stdout>Set workflows to on</local-command-stdout>',
          },
        },
        {
          type: 'attachment',
          attachment: { type: 'ultra_effort_enter', reminderType: 'full' },
        },
        {
          type: 'assistant',
          timestamp: '2026-06-05T00:00:00.000Z',
          message: {
            role: 'assistant',
            content: [
              {
                type: 'tool_use',
                id: 'toolu_workflow',
                name: 'Workflow',
                input: { description: 'run analysis' },
              },
            ],
          },
        },
      ]
        .map((line) => JSON.stringify(line))
        .join('\n'),
      'utf8',
    );
    await writeFile(
      join(projectDir, sessionId, 'workflows', 'wf_abc.json'),
      JSON.stringify({
        runId: 'wf_abc',
        workflowName: 'reward-layer-comms-review',
        status: 'completed',
        agentCount: 1,
        taskId: 'task-1',
        scriptPath: '/tmp/workflow.js',
        startTime: 1000,
        durationMs: 2000,
        totalTokens: 123,
        totalToolCalls: 4,
        phases: [{ title: 'Read', detail: 'read docs' }],
        workflowProgress: [
          {
            type: 'workflow_agent',
            agentId: 'agent-1',
            label: 'reader',
            phaseTitle: 'Read',
            phaseIndex: 1,
            state: 'done',
            model: 'claude-opus-4-8',
            tokens: 123,
            toolCalls: 4,
          },
        ],
      }),
      'utf8',
    );
    const session: Session = {
      id: `claude-code:${sessionId}`,
      agent: 'claude-code',
      sessionId,
      logPath,
      pwd: '/repo',
      projectKey: '/repo',
    };

    const value = (await workflowSummaryEnricher.run({
      session,
      logPath,
      iterEvents: () => claudeCodeAdapter.iterEvents(logPath),
    })) as WorkflowSummaryValue;

    expect(value).toMatchObject({
      hasWorkflow: true,
      workflowRunCount: 1,
      workflowToolCallCount: 1,
      workflowEnabled: true,
      effort: 'ultracode',
      ultraEffort: true,
      totalAgents: 1,
      totalTokens: 123,
      totalToolCalls: 4,
      runs: [
        {
          runId: 'wf_abc',
          workflowName: 'reward-layer-comms-review',
          status: 'completed',
          agentCount: 1,
          phases: [{ title: 'Read', detail: 'read docs' }],
          agents: [
            {
              agentId: 'agent-1',
              label: 'reader',
              phaseTitle: 'Read',
              model: 'claude-opus-4-8',
            },
          ],
        },
      ],
    });
  });

  it('resolves taskOutputPath from the overridable claude tmp dir when the file exists', async () => {
    const { projectDir, sessionId, logPath, session } = await setupSession(
      'superdense-workflow-taskout-',
      [workflowToolUse('toolu_1')],
    );
    // Base dir override points at a sibling of the project dir.
    const tmpBase = join(tempDir!, 'claude-tmp');
    process.env.SUPERDENSE_CLAUDE_TMP_DIR = tmpBase;
    const encodedProjectDir = '-repo';
    const tasksDir = join(tmpBase, encodedProjectDir, sessionId, 'tasks');
    await mkdir(tasksDir, { recursive: true });
    await writeFile(join(tasksDir, 'task-1.output'), 'agent output', 'utf8');
    await writeRun(projectDir, sessionId, 'wf_out.json', {
      runId: 'wf_out',
      taskId: 'task-1',
      workflowProgress: [],
    });

    const value = await runEnricher(logPath, session);
    expect(value.runs[0].taskOutputPath).toBe(join(tasksDir, 'task-1.output'));
  });

  it('omits taskOutputPath when the output file is absent', async () => {
    const { projectDir, sessionId, logPath, session } = await setupSession(
      'superdense-workflow-noout-',
      [workflowToolUse('toolu_1')],
    );
    process.env.SUPERDENSE_CLAUDE_TMP_DIR = join(tempDir!, 'claude-tmp');
    await writeRun(projectDir, sessionId, 'wf_out.json', {
      runId: 'wf_out',
      taskId: 'task-missing',
      workflowProgress: [],
    });

    const value = await runEnricher(logPath, session);
    expect(value.runs[0].taskOutputPath).toBeUndefined();
  });

  it('counts multiple Workflow tool calls in a single transcript pass', async () => {
    const { logPath, session } = await setupSession('superdense-workflow-count-', [
      workflowToolUse('toolu_1'),
      {
        type: 'assistant',
        message: { role: 'assistant', content: [{ type: 'text', text: 'hi' }] },
      },
      workflowToolUse('toolu_2'),
    ]);

    const value = await runEnricher(logPath, session);
    expect(value.workflowToolCallCount).toBe(2);
    expect(value.hasWorkflow).toBe(true);
  });

  it('reports no workflow when there are no signals, runs, or tool calls', async () => {
    const { logPath, session } = await setupSession('superdense-workflow-none-', [
      { type: 'user', message: { role: 'user', content: 'just a normal prompt' } },
    ]);

    const value = await runEnricher(logPath, session);
    expect(value).toMatchObject({
      hasWorkflow: false,
      workflowRunCount: 0,
      workflowToolCallCount: 0,
      workflowEnabled: null,
      ultraEffort: false,
      runs: [],
    });
  });

  it('flags hasWorkflow on ultracode-only sessions with no runs (documented behavior)', async () => {
    const { logPath, session } = await setupSession('superdense-workflow-ultra-', [
      { type: 'attachment', attachment: { type: 'ultra_effort_enter', reminderType: 'full' } },
    ]);

    const value = await runEnricher(logPath, session);
    expect(value).toMatchObject({
      hasWorkflow: true,
      ultraEffort: true,
      effort: 'ultracode',
      workflowRunCount: 0,
      workflowToolCallCount: 0,
      totalAgents: 0,
      runs: [],
    });
  });

  it('does not enable workflows when the transcript says "Set workflows to off"', async () => {
    const { logPath, session } = await setupSession('superdense-workflow-off-', [
      {
        type: 'user',
        message: {
          role: 'user',
          content:
            '<command-name>/config</command-name>\n<local-command-stdout>Set workflows to off</local-command-stdout>',
        },
      },
    ]);

    const value = await runEnricher(logPath, session);
    expect(value.workflowEnabled).toBeNull();
    expect(value.hasWorkflow).toBe(false);
  });

  it('ignores malformed workflow JSON and keeps valid runs, sorted by startTime', async () => {
    const { projectDir, sessionId, logPath, session } = await setupSession(
      'superdense-workflow-multi-',
      [workflowToolUse('toolu_1')],
    );
    await writeFile(
      join(projectDir, sessionId, 'workflows', 'broken.json'),
      '{ not valid json',
      'utf8',
    );
    await writeRun(projectDir, sessionId, 'wf_late.json', {
      runId: 'wf_late',
      startTime: 2000,
      totalTokens: 10,
      totalToolCalls: 1,
      workflowProgress: [{ type: 'workflow_agent', agentId: 'a2' }],
    });
    await writeRun(projectDir, sessionId, 'wf_early.json', {
      runId: 'wf_early',
      startTime: 1000,
      totalTokens: 5,
      totalToolCalls: 2,
      workflowProgress: [{ type: 'workflow_agent', agentId: 'a1' }],
    });

    const value = await runEnricher(logPath, session);
    expect(value.runs.map((r) => r.runId)).toEqual(['wf_early', 'wf_late']);
    expect(value.workflowRunCount).toBe(2);
    expect(value.totalAgents).toBe(2);
    expect(value.totalTokens).toBe(15);
    expect(value.totalToolCalls).toBe(3);
  });
});

import { createReadStream } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import type { Enricher } from './types.js';

export interface WorkflowSummaryAgent {
  agentId: string;
  label?: string;
  phaseTitle?: string;
  phaseIndex?: number;
  state?: string;
  model?: string;
  startedAt?: number;
  durationMs?: number;
  toolCalls?: number;
  tokens?: number;
  promptPreview?: string;
  resultPreview?: string;
}

export interface WorkflowSummaryRun {
  runId: string;
  workflowName?: string;
  status?: string;
  agentCount?: number;
  taskId?: string;
  scriptPath?: string;
  taskOutputPath?: string;
  timestamp?: string;
  startTime?: number;
  durationMs?: number;
  totalTokens?: number;
  totalToolCalls?: number;
  phases: Array<{ title?: string; detail?: string }>;
  agents: WorkflowSummaryAgent[];
}

export interface WorkflowSummaryValue {
  v: 1;
  hasWorkflow: boolean;
  workflowRunCount: number;
  workflowToolCallCount: number;
  workflowEnabled: boolean | null;
  effort: string | null;
  ultraEffort: boolean;
  totalAgents: number;
  totalTokens: number;
  totalToolCalls: number;
  runs: WorkflowSummaryRun[];
}

interface WorkflowRunFile {
  runId?: string;
  workflowName?: string;
  status?: string;
  agentCount?: number;
  taskId?: string;
  scriptPath?: string;
  timestamp?: string;
  startTime?: number;
  durationMs?: number;
  totalTokens?: number;
  totalToolCalls?: number;
  phases?: Array<{ title?: string; detail?: string }>;
  workflowProgress?: Array<Record<string, unknown>>;
}

interface TranscriptWorkflowSignals {
  workflowEnabled: boolean | null;
  effort: string | null;
  ultraEffort: boolean;
  workflowToolCallCount: number;
}

export const workflowSummaryEnricher: Enricher = {
  name: 'workflow_summary',
  version: 1,
  returns: 'json',
  alwaysRun: true,
  description: 'Claude Code dynamic workflow summary detected from transcript and workflow files.',
  async run(ctx) {
    if (ctx.session.agent !== 'claude-code') {
      return {
        v: 1,
        hasWorkflow: false,
        workflowRunCount: 0,
        workflowToolCallCount: 0,
        workflowEnabled: null,
        effort: null,
        ultraEffort: false,
        totalAgents: 0,
        totalTokens: 0,
        totalToolCalls: 0,
        runs: [],
      } satisfies WorkflowSummaryValue;
    }
    const [signals, runs] = await Promise.all([
      scanTranscript(ctx.logPath),
      readWorkflowRuns(ctx.logPath, ctx.session.sessionId),
    ]);
    const totalAgents = runs.reduce((sum, run) => sum + run.agents.length, 0);
    const totalTokens = runs.reduce((sum, run) => sum + (run.totalTokens ?? 0), 0);
    const totalToolCalls = runs.reduce((sum, run) => sum + (run.totalToolCalls ?? 0), 0);
    return {
      v: 1,
      hasWorkflow: signals.workflowToolCallCount > 0 || runs.length > 0 || signals.ultraEffort,
      workflowRunCount: runs.length,
      workflowToolCallCount: signals.workflowToolCallCount,
      workflowEnabled: signals.workflowEnabled,
      effort: signals.effort,
      ultraEffort: signals.ultraEffort,
      totalAgents,
      totalTokens,
      totalToolCalls,
      runs,
    } satisfies WorkflowSummaryValue;
  },
};

async function readWorkflowRuns(logPath: string, sessionId: string): Promise<WorkflowSummaryRun[]> {
  const workflowsDir = join(dirname(logPath), sessionId, 'workflows');
  let files: string[];
  try {
    files = await readdir(workflowsDir);
  } catch {
    return [];
  }
  const runs: WorkflowSummaryRun[] = [];
  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    const path = join(workflowsDir, file);
    let parsed: WorkflowRunFile;
    try {
      parsed = JSON.parse(await readFile(path, 'utf8')) as WorkflowRunFile;
    } catch {
      continue;
    }
    const runId = typeof parsed.runId === 'string' ? parsed.runId : file.slice(0, -'.json'.length);
    const agents = (parsed.workflowProgress ?? [])
      .filter((item) => item.type === 'workflow_agent' && typeof item.agentId === 'string')
      .map(
        (item) =>
          compactObject({
            agentId: item.agentId,
            label: item.label,
            phaseTitle: item.phaseTitle,
            phaseIndex: item.phaseIndex,
            state: item.state,
            model: item.model,
            startedAt: item.startedAt,
            durationMs: item.durationMs,
            toolCalls: item.toolCalls,
            tokens: item.tokens,
            promptPreview: item.promptPreview,
            resultPreview: item.resultPreview,
          }) as unknown as WorkflowSummaryAgent,
      );
    runs.push(
      compactObject({
        runId,
        workflowName: parsed.workflowName,
        status: parsed.status,
        agentCount: parsed.agentCount,
        taskId: parsed.taskId,
        scriptPath: parsed.scriptPath,
        taskOutputPath: parsed.taskId
          ? await findTaskOutputPath(logPath, sessionId, parsed.taskId)
          : undefined,
        timestamp: parsed.timestamp,
        startTime: parsed.startTime,
        durationMs: parsed.durationMs,
        totalTokens: parsed.totalTokens,
        totalToolCalls: parsed.totalToolCalls,
        phases: parsed.phases ?? [],
        agents,
      }) as unknown as WorkflowSummaryRun,
    );
  }
  return runs.sort((a, b) => (a.startTime ?? 0) - (b.startTime ?? 0));
}

/**
 * Base directory where Claude Code stores per-task scratch output, e.g.
 * `/tmp/claude-<uid>`. `os.tmpdir()` is deliberately NOT used: on macOS it
 * resolves to `/var/folders/...`, whereas Claude Code uses `/tmp/claude-<uid>`
 * literally on both macOS and Linux. Overridable for tests / non-standard setups.
 */
function claudeTaskBaseDir(): string {
  const override = process.env.SUPERDENSE_CLAUDE_TMP_DIR ?? process.env.CLAUDE_TMP_DIR;
  if (override) return override;
  const uid = typeof process.getuid === 'function' ? process.getuid() : '';
  return join('/tmp', `claude-${uid}`);
}

async function findTaskOutputPath(
  logPath: string,
  sessionId: string,
  taskId: string,
): Promise<string | undefined> {
  const encodedProjectDir = dirname(logPath).split('/').pop();
  if (!encodedProjectDir) return undefined;
  const path = join(claudeTaskBaseDir(), encodedProjectDir, sessionId, 'tasks', `${taskId}.output`);
  try {
    await stat(path);
    return path;
  } catch {
    return undefined;
  }
}

/**
 * Single raw pass over the transcript that both counts `Workflow` tool calls and
 * infers workflow/effort settings. The setting signals are intentionally
 * best-effort: they key off harness reminder / slash-command text (e.g.
 * `Set workflows to on`, `/effort … ultracode`), so they may drift if that
 * wording changes. They only influence the `hasWorkflow`/`effort` hints, never
 * the authoritative run data read from the workflow JSON files.
 */
async function scanTranscript(logPath: string): Promise<TranscriptWorkflowSignals> {
  const out: TranscriptWorkflowSignals = {
    workflowEnabled: null,
    effort: null,
    ultraEffort: false,
    workflowToolCallCount: 0,
  };
  let stream;
  try {
    stream = createReadStream(logPath, { encoding: 'utf8' });
  } catch {
    return out;
  }
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const line of rl) {
      if (!line.trim()) continue;
      let obj: any;
      try {
        obj = JSON.parse(line);
      } catch {
        continue;
      }
      out.workflowToolCallCount += countWorkflowToolUses(obj?.message?.content);
      if (obj?.attachment?.type === 'ultra_effort_enter') {
        out.ultraEffort = true;
        out.effort = out.effort ?? 'ultracode';
      }
      const text = stringifyMessageContent(obj?.message?.content) || String(obj?.content ?? '');
      const lower = text.toLowerCase();
      if (text.includes('Set workflows to') && /\bon\b/.test(lower) && !/\boff\b/.test(lower)) {
        out.workflowEnabled = true;
      }
      if (text.includes('/effort') && lower.includes('ultracode')) {
        out.effort = 'ultracode';
      }
      if (lower.includes('set effort level to ultracode')) {
        out.effort = 'ultracode';
        out.ultraEffort = true;
      }
      if (lower.includes('dynamic workflow orchestration')) {
        out.ultraEffort = true;
      }
    }
  } finally {
    try {
      rl.close();
      stream.destroy();
    } catch {
      /* ignore */
    }
  }
  return out;
}

function countWorkflowToolUses(content: unknown): number {
  if (!Array.isArray(content)) return 0;
  let count = 0;
  for (const part of content) {
    if (
      part &&
      typeof part === 'object' &&
      (part as { type?: unknown }).type === 'tool_use' &&
      (part as { name?: unknown }).name === 'Workflow'
    ) {
      count++;
    }
  }
  return count;
}

function stringifyMessageContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((part) => {
      if (!part || typeof part !== 'object') return '';
      const p = part as { text?: unknown; content?: unknown };
      if (typeof p.text === 'string') return p.text;
      if (typeof p.content === 'string') return p.content;
      return '';
    })
    .filter(Boolean)
    .join('\n');
}

function compactObject(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value != null) out[key] = value;
  }
  return out;
}

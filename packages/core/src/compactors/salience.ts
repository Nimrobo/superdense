import type { TranscriptEvent } from '../types.js';
import type { Compactor } from './types.js';

const ERROR_RE = /\b([A-Za-z]+Error|error|exception|traceback|failed|fatal)\b/i;
const DECISION_RE = /^(I'll|Let me|The issue is|The problem is|Done|Fixed|Found it|Looks like)/i;
const PROPOSED_PLAN_RE = /^<proposed_plan>[\s\S]*<\/proposed_plan>$/;
const INTERRUPTED_USER_RE = /^\[Request interrupted by user for tool use\]$/i;
const ENVIRONMENT_CONTEXT_RE = /^<environment_context>[\s\S]*<\/environment_context>$/;
const TURN_ABORTED_RE = /^<turn_aborted>[\s\S]*<\/turn_aborted>$/;
const PLEASE_IMPLEMENT_PLAN_RE = /^PLEASE IMPLEMENT THIS PLAN:[ \t]*\n/i;
const PLAN_RESEND_PLACEHOLDER =
  'PLEASE IMPLEMENT THIS PLAN: [plan details were sent again — skipped for compaction]';
const SYNTHETIC_ASSISTANT_RE = /^No response requested\.$/i;
const MUTATION_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit', 'MultiEdit']);
const COMMIT_RE = /^(git\s+(commit|push|rebase|merge|reset|tag)|gh\s+(pr|release))/;
const ERR_SIG_CHARS = 120;
const MAX_MUTATIONS = 50;
const MAX_ERRORS = 20;

interface UserTimelineItem {
  type: 'user';
  t: number;
  text: string;
}

interface AssistantTimelineItem {
  type: 'assistant';
  t: number;
  kind: 'handoff' | 'decision' | 'proposed_plan' | 'final';
  text: string;
}

interface PlanTimelineItem {
  type: 'plan_enter' | 'plan_exit';
  t: number;
}

type TimelineItem = UserTimelineItem | AssistantTimelineItem | PlanTimelineItem;
type TimelineItemInput =
  | Omit<UserTimelineItem, 't'>
  | Omit<AssistantTimelineItem, 't'>
  | Omit<PlanTimelineItem, 't'>;

interface PendingAssistant {
  kind: 'handoff' | 'decision';
  text: string;
}

interface Mutation {
  tool: string;
  path?: string;
  arg?: string;
  count: number;
}

interface ErrorEntry {
  tool?: string;
  sig: string;
}

interface SalienceOutput {
  v: 2;
  timeline: TimelineItem[];
  mutations: Mutation[];
  errors: ErrorEntry[];
  omitted?: Partial<Record<'timeline' | 'mutations' | 'errors', number>>;
}

function clean(s: string, n: number): string {
  const c = s.replace(/\s+/g, ' ').trim();
  return c.length > n ? c.slice(0, n) + '…' : c;
}

function timelineText(s: string): string {
  return s.replace(/\r\n?/g, '\n').trim();
}

function isSyntheticUserText(text: string): boolean {
  return (
    INTERRUPTED_USER_RE.test(text) ||
    ENVIRONMENT_CONTEXT_RE.test(text) ||
    TURN_ABORTED_RE.test(text)
  );
}

function extractPath(inputText: string | undefined): string | undefined {
  if (!inputText) return undefined;
  try {
    const parsed = JSON.parse(inputText) as Record<string, unknown>;
    const candidate = parsed.file_path ?? parsed.path ?? parsed.filePath ?? parsed.notebook_path;
    if (typeof candidate === 'string') return candidate;
  } catch {
    // not JSON
  }
  return undefined;
}

function extractCommand(inputText: string | undefined): string | undefined {
  if (!inputText) return undefined;
  try {
    const parsed = JSON.parse(inputText) as Record<string, unknown>;
    if (typeof parsed.command === 'string') return parsed.command;
  } catch {
    // not JSON
  }
  return undefined;
}

function extractPlan(inputText: string | undefined): string | undefined {
  if (!inputText) return undefined;
  try {
    const parsed = JSON.parse(inputText) as Record<string, unknown>;
    if (typeof parsed.plan === 'string') return parsed.plan;
  } catch {
    // not JSON
  }
  return undefined;
}

function isPlanFilePath(path: string | undefined): boolean {
  return Boolean(path && /\/\.claude\/plans\/[^/]+\.md$/.test(path));
}

function shouldRecordError(ev: TranscriptEvent, tool: string | undefined): boolean {
  if (tool === 'ExitPlanMode') return false;
  return ev.isError === true;
}

function errorSignature(text: string): string {
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const matching = lines.find((line) => ERROR_RE.test(line));
  if (matching) return clean(matching, ERR_SIG_CHARS);
  const commandNotFound = lines.find((line) => /\bcommand not found\b/i.test(line));
  if (commandNotFound) return clean(commandNotFound, ERR_SIG_CHARS);
  const outputIdx = lines.findIndex((line) => line === 'Output:');
  if (outputIdx >= 0) {
    const outputLine = lines.slice(outputIdx + 1).find(Boolean);
    if (outputLine) return clean(outputLine, ERR_SIG_CHARS);
  }
  const exitLine = lines.find((line) => /^Process exited with code \d+/i.test(line));
  return clean(exitLine ?? lines[0] ?? text, ERR_SIG_CHARS);
}

export const salienceCompactor: Compactor<SalienceOutput> = {
  name: 'salience',
  kind: 'semantic',
  description:
    'Rule-based sparse timeline extraction: user messages, plan-mode boundaries, salient assistant handoffs/proposed plans, mutating tool calls, and errored tool results. No LLM. Designed for "what was the user trying to do, did it work?" pattern mining.',
  async run(ctx) {
    const out: SalienceOutput = {
      v: 2,
      timeline: [],
      mutations: [],
      errors: [],
    };

    let timelineIdx = -1;
    let currentMode: string | undefined;
    let pendingInitialPlanEnter = false;
    let pendingAssistant: PendingAssistant | undefined;
    const callIdToTool = new Map<string, string>();

    const pushTimeline = (item: TimelineItemInput) => {
      timelineIdx++;
      out.timeline.push({ ...item, t: timelineIdx } as TimelineItem);
    };

    const recordMutation = (mutation: Omit<Mutation, 'count'>) => {
      const key = mutation.path ?? mutation.arg ?? '';
      const existing = out.mutations.find(
        (item) => item.tool === mutation.tool && (item.path ?? item.arg ?? '') === key,
      );
      if (existing) {
        existing.count++;
        return;
      }
      if (out.mutations.length >= MAX_MUTATIONS) {
        out.omitted = {
          ...out.omitted,
          mutations: (out.omitted?.mutations ?? 0) + 1,
        };
        return;
      }
      out.mutations.push({ ...mutation, count: 1 });
    };

    const flushPendingAssistant = (kind?: 'final') => {
      if (!pendingAssistant) return;
      if (SYNTHETIC_ASSISTANT_RE.test(pendingAssistant.text)) {
        pendingAssistant = undefined;
        return;
      }
      pushTimeline({
        type: 'assistant',
        kind: kind ?? pendingAssistant.kind,
        text: pendingAssistant.text,
      });
      pendingAssistant = undefined;
    };

    for await (const ev of ctx.iterEvents(ctx.logPath)) {
      if (ev.kind === 'mode_change') {
        const newMode = ev.mode;
        if (!newMode || newMode === currentMode) continue;
        flushPendingAssistant();
        if (newMode === 'plan' && currentMode !== 'plan') {
          if (out.timeline.length === 0) pendingInitialPlanEnter = true;
          else pushTimeline({ type: 'plan_enter' });
        } else if (currentMode === 'plan' && newMode !== 'plan') {
          if (pendingInitialPlanEnter) {
            pushTimeline({ type: 'plan_enter' });
            pendingInitialPlanEnter = false;
          }
          pushTimeline({ type: 'plan_exit' });
        }
        currentMode = newMode;
        continue;
      }

      if (ev.role === 'user' && ev.kind === 'text' && ev.text) {
        flushPendingAssistant();
        const text = timelineText(ev.text);
        if (!text) continue;
        if (isSyntheticUserText(text)) continue;
        const userText = PLEASE_IMPLEMENT_PLAN_RE.test(text) ? PLAN_RESEND_PLACEHOLDER : text;
        pushTimeline({ type: 'user', text: userText });
        if (pendingInitialPlanEnter) {
          pushTimeline({ type: 'plan_enter' });
          pendingInitialPlanEnter = false;
        }
        continue;
      }

      if (ev.role === 'assistant' && ev.kind === 'text' && ev.text) {
        const text = timelineText(ev.text);
        if (!text) continue;
        if (PROPOSED_PLAN_RE.test(text)) {
          pendingAssistant = undefined;
          pushTimeline({ type: 'assistant', kind: 'proposed_plan', text });
          continue;
        }

        const firstLine =
          text
            .split('\n')
            .map((l) => l.trim())
            .find(Boolean) ?? '';
        if (firstLine && DECISION_RE.test(firstLine)) {
          pendingAssistant = { kind: 'decision', text: firstLine };
        } else {
          pendingAssistant = { kind: 'handoff', text };
        }
        continue;
      }

      if (ev.kind === 'tool_call' && ev.toolName) {
        if (ev.toolCallId) callIdToTool.set(ev.toolCallId, ev.toolName);
        if (ev.toolName === 'ExitPlanMode') {
          pendingAssistant = undefined;
          const plan = extractPlan(ev.inputText);
          if (plan)
            pushTimeline({ type: 'assistant', kind: 'proposed_plan', text: timelineText(plan) });
          continue;
        }
        if (pendingAssistant?.kind === 'handoff') pendingAssistant = undefined;
        if (currentMode !== 'plan') {
          if (MUTATION_TOOLS.has(ev.toolName)) {
            const path = extractPath(ev.inputText);
            if (!isPlanFilePath(path))
              recordMutation(path ? { tool: ev.toolName, path } : { tool: ev.toolName });
          } else if (ev.toolName === 'Bash') {
            const cmd = extractCommand(ev.inputText);
            if (cmd && COMMIT_RE.test(cmd.trim())) {
              recordMutation({ tool: 'Bash', arg: clean(cmd, 120) });
            }
          }
        }
        continue;
      }

      if (ev.kind === 'tool_result' && ev.text) {
        const tool = ev.toolCallId ? callIdToTool.get(ev.toolCallId) : undefined;
        if (!shouldRecordError(ev, tool)) continue;
        if (out.errors.length < MAX_ERRORS) {
          out.errors.push({ tool, sig: errorSignature(ev.text) });
        }
      }
    }

    flushPendingAssistant('final');
    return out;
  },
};

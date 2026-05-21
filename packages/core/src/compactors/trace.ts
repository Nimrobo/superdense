import type { TranscriptEvent } from '../types.js';
import type { Compactor } from './types.js';

const ERROR_RE = /\b([A-Za-z]+Error|error|exception|traceback|failed|fatal)\b/i;
const MAX_TURNS_KEPT = 50;
const ARG_PREVIEW_CHARS = 40;
const ASSISTANT_HEADER_CHARS = 120;
const MAX_CALLS_PER_TURN = 20;

interface ToolCall {
  tool: string;
  arg?: string;
  ok?: boolean;
  outBytes?: number;
  errSig?: string;
}

interface UserTurn {
  t: number;
  user: string;
}

interface AssistantTurn {
  t: number;
  asst?: string;
  calls?: ToolCall[];
}

interface OmittedTurns {
  omitted: number;
  tools: Record<string, number>;
}

type Turn = UserTurn | AssistantTurn | OmittedTurns;

interface TraceOutput {
  v: 1;
  turns: Turn[];
}

function jsonBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), 'utf8');
}

function previewArg(ev: TranscriptEvent): string | undefined {
  if (!ev.inputText) return undefined;
  let s = ev.inputText;
  try {
    const parsed = JSON.parse(s) as Record<string, unknown>;
    const candidate =
      parsed.file_path ??
      parsed.path ??
      parsed.command ??
      parsed.pattern ??
      parsed.query;
    if (typeof candidate === 'string') s = candidate;
  } catch {
    // raw string, fall through
  }
  s = s.replace(/\s+/g, ' ').trim();
  if (s.length > ARG_PREVIEW_CHARS) s = s.slice(0, ARG_PREVIEW_CHARS) + '…';
  return s;
}

function errorSignature(text: string): string {
  const firstLine = text.split('\n').find((l) => ERROR_RE.test(l)) ?? text.split('\n')[0] ?? '';
  return firstLine.trim().slice(0, 80);
}

function truncateAssistant(text: string): string {
  const firstLine = text.split('\n')[0] ?? '';
  const clean = firstLine.replace(/\s+/g, ' ').trim();
  if (clean.length > ASSISTANT_HEADER_CHARS) return clean.slice(0, ASSISTANT_HEADER_CHARS) + '…';
  return clean;
}

function collapseTurns(turns: (UserTurn | AssistantTurn)[], maxTurns: number): Turn[] {
  if (turns.length <= maxTurns) return turns;

  const visible = Math.max(2, maxTurns - 1);
  const head = Math.max(1, Math.floor(visible / 2));
  const tail = Math.max(1, visible - head);
  const middle = turns.slice(head, turns.length - tail);
  const omittedTools: Record<string, number> = {};
  for (const turn of middle) {
    if ('calls' in turn && turn.calls) {
      for (const c of turn.calls) omittedTools[c.tool] = (omittedTools[c.tool] ?? 0) + 1;
    }
  }
  return [
    ...turns.slice(0, head),
    { omitted: middle.length, tools: omittedTools },
    ...turns.slice(turns.length - tail),
  ];
}

function capCalls(turns: Turn[]): Turn[] {
  return turns.map((turn) => {
    if (!('calls' in turn) || !turn.calls || turn.calls.length <= MAX_CALLS_PER_TURN) return turn;
    const kept = turn.calls.slice(0, MAX_CALLS_PER_TURN);
    const omitted = turn.calls.slice(MAX_CALLS_PER_TURN);
    const tools: Record<string, number> = {};
    for (const call of omitted) tools[call.tool] = (tools[call.tool] ?? 0) + 1;
    return {
      ...turn,
      calls: [
        ...kept,
        {
          tool: '_omitted',
          arg: `${omitted.length} calls`,
          ok: undefined,
          outBytes: undefined,
          errSig: Object.entries(tools).map(([tool, n]) => `${tool}:${n}`).join(', '),
        },
      ],
    };
  });
}

function budgetTurns(turns: (UserTurn | AssistantTurn)[], targetBytes: number): Turn[] {
  let maxTurns = Math.min(MAX_TURNS_KEPT, turns.length);
  let out = capCalls(collapseTurns(turns, maxTurns));
  while (jsonBytes({ v: 1, turns: out }) > targetBytes && maxTurns > 10) {
    maxTurns = Math.max(10, Math.floor(maxTurns * 0.75));
    out = capCalls(collapseTurns(turns, maxTurns));
  }
  return out;
}

export const traceCompactor: Compactor<TraceOutput> = {
  name: 'trace',
  kind: 'structural',
  targetBytes: 10_000,
  description: 'Ordered turn sequence: user prompts + assistant headers + tool-call sequence with brief args and success/failure. Drops assistant prose bodies and tool result content. Designed for workflow / retry / sequence pattern mining.',
  async run(ctx) {
    const turns: (UserTurn | AssistantTurn)[] = [];
    let current: AssistantTurn | null = null;
    let turnIdx = -1;
    const callIdToCall = new Map<string, ToolCall>();

    for await (const ev of ctx.iterEvents(ctx.logPath)) {
      if (ev.role === 'user' && ev.kind === 'text') {
        if (current) {
          turns.push(current);
          current = null;
        }
        turnIdx++;
        const text = (ev.text ?? '').replace(/\s+/g, ' ').trim();
        turns.push({ t: turnIdx, user: text.slice(0, 200) });
        continue;
      }

      if (ev.role === 'assistant') {
        if (!current) {
          turnIdx++;
          current = { t: turnIdx };
        }
        if (ev.kind === 'text' && ev.text) {
          const header = truncateAssistant(ev.text);
          if (header) current.asst = current.asst ? current.asst : header;
        } else if (ev.kind === 'tool_call' && ev.toolName) {
          const call: ToolCall = { tool: ev.toolName };
          const arg = previewArg(ev);
          if (arg) call.arg = arg;
          if (!current.calls) current.calls = [];
          current.calls.push(call);
          if (ev.toolCallId) callIdToCall.set(ev.toolCallId, call);
        }
        continue;
      }

      if (ev.kind === 'tool_result') {
        const call = ev.toolCallId ? callIdToCall.get(ev.toolCallId) : undefined;
        if (!call) continue;
        const text = ev.text ?? '';
        call.outBytes = text.length;
        if (ERROR_RE.test(text)) {
          call.ok = false;
          call.errSig = errorSignature(text);
        } else {
          call.ok = true;
        }
      }
    }

    if (current) turns.push(current);

    return { v: 1, turns: budgetTurns(turns, traceCompactor.targetBytes ?? 10_000) };
  },
};

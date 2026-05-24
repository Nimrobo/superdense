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

interface PhaseDivider {
  phase: 'plan_enter' | 'plan_exit';
  t: number;
}

type Turn = UserTurn | AssistantTurn | OmittedTurns | PhaseDivider;
type LiveTurn = UserTurn | AssistantTurn | PhaseDivider;

const PROTECT_WINDOW = 5;

function isPhaseDivider(turn: Turn): turn is PhaseDivider {
  return 'phase' in turn;
}

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

function computeProtectedIndices(turns: LiveTurn[]): Set<number> {
  const out = new Set<number>();
  turns.forEach((turn, idx) => {
    if (!isPhaseDivider(turn)) return;
    const start = Math.max(0, idx - PROTECT_WINDOW);
    const end = Math.min(turns.length - 1, idx + PROTECT_WINDOW);
    for (let i = start; i <= end; i++) out.add(i);
  });
  return out;
}

function collapseTurns(turns: LiveTurn[], maxTurns: number): Turn[] {
  const protectedIdx = computeProtectedIndices(turns);
  const nonProtectedIdx: number[] = [];
  for (let i = 0; i < turns.length; i++) if (!protectedIdx.has(i)) nonProtectedIdx.push(i);

  if (nonProtectedIdx.length <= maxTurns) return turns.slice();

  const visible = Math.max(2, maxTurns - 1);
  const head = Math.max(1, Math.floor(visible / 2));
  const tail = Math.max(1, visible - head);
  const keepHead = new Set(nonProtectedIdx.slice(0, head));
  const keepTail = new Set(nonProtectedIdx.slice(nonProtectedIdx.length - tail));
  const keepNonProtected = new Set<number>([...keepHead, ...keepTail]);

  const out: Turn[] = [];
  let pendingOmitted: { count: number; tools: Record<string, number> } | null = null;

  const flushOmitted = () => {
    if (!pendingOmitted) return;
    out.push({ omitted: pendingOmitted.count, tools: pendingOmitted.tools });
    pendingOmitted = null;
  };

  for (let i = 0; i < turns.length; i++) {
    const turn = turns[i];
    if (protectedIdx.has(i) || keepNonProtected.has(i)) {
      flushOmitted();
      out.push(turn);
      continue;
    }
    // Omitted non-protected turn — accumulate into the running placeholder.
    if (!pendingOmitted) pendingOmitted = { count: 0, tools: {} };
    pendingOmitted.count += 1;
    if ('calls' in turn && turn.calls) {
      for (const c of turn.calls) pendingOmitted.tools[c.tool] = (pendingOmitted.tools[c.tool] ?? 0) + 1;
    }
  }
  flushOmitted();
  return out;
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

function budgetTurns(turns: LiveTurn[], targetBytes: number): Turn[] {
  // Note: protected turns around plan-mode dividers bypass `maxTurns` and can push
  // the output past `targetBytes`; that's accepted — plan context is mandatory.
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
    const turns: LiveTurn[] = [];
    let current: AssistantTurn | null = null;
    let turnIdx = -1;
    let currentMode: string | undefined;
    const callIdToCall = new Map<string, ToolCall>();

    for await (const ev of ctx.iterEvents(ctx.logPath)) {
      if (ev.kind === 'mode_change') {
        const newMode = ev.mode;
        if (!newMode || newMode === currentMode) continue;
        if (current) {
          turns.push(current);
          current = null;
        }
        if (newMode === 'plan' && currentMode !== 'plan') {
          turnIdx++;
          turns.push({ phase: 'plan_enter', t: turnIdx });
        } else if (currentMode === 'plan' && newMode !== 'plan') {
          turnIdx++;
          turns.push({ phase: 'plan_exit', t: turnIdx });
        }
        currentMode = newMode;
        continue;
      }

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

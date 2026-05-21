import type { TranscriptEvent } from '../types.js';
import type { Compactor } from './types.js';

const ERROR_RE = /\b([A-Za-z]+Error|error|exception|traceback|failed|fatal)\b/i;
const DECISION_RE = /^(I'll|Let me|The issue is|The problem is|Done|Fixed|Found it|Looks like)/i;
const MUTATION_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit', 'MultiEdit']);
const COMMIT_RE = /^(git\s+(commit|push|rebase|merge|reset|tag)|gh\s+(pr|release))/;
const USER_TURN_CHARS = 300;
const DECISION_CHARS = 200;
const LAST_ASST_CHARS = 400;
const ERR_SIG_CHARS = 120;
const MAX_USER_TURNS = 20;
const MAX_DECISIONS = 20;
const MAX_MUTATIONS = 50;
const MAX_ERRORS = 20;

interface Decision {
  at: number;
  text: string;
}

interface Mutation {
  tool: string;
  path?: string;
  arg?: string;
}

interface ErrorEntry {
  tool?: string;
  sig: string;
}

interface SalienceOutput {
  v: 1;
  firstAsk?: string;
  userTurns: string[];
  decisions: Decision[];
  mutations: Mutation[];
  errors: ErrorEntry[];
  lastAsst?: string;
  omitted?: Partial<Record<'userTurns' | 'decisions' | 'mutations' | 'errors', number>>;
}

function clean(s: string, n: number): string {
  const c = s.replace(/\s+/g, ' ').trim();
  return c.length > n ? c.slice(0, n) + '…' : c;
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

function jsonBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), 'utf8');
}

function trimArray<T>(
  out: SalienceOutput,
  key: 'userTurns' | 'decisions' | 'mutations' | 'errors',
  minLength: number,
): boolean {
  const arr = out[key] as T[];
  if (arr.length <= minLength) return false;
  const nextLength = Math.max(minLength, Math.ceil(arr.length * 0.75));
  const omitted = arr.length - nextLength;
  const next = arr.slice(0, nextLength);
  if (key === 'userTurns') out.userTurns = next as string[];
  else if (key === 'decisions') out.decisions = next as Decision[];
  else if (key === 'mutations') out.mutations = next as Mutation[];
  else out.errors = next as ErrorEntry[];
  out.omitted = out.omitted ?? {};
  out.omitted[key] = (out.omitted[key] ?? 0) + omitted;
  return true;
}

function enforceBudget(out: SalienceOutput, targetBytes: number): SalienceOutput {
  while (jsonBytes(out) > targetBytes) {
    if (trimArray<Mutation>(out, 'mutations', 5)) continue;
    if (trimArray<Decision>(out, 'decisions', 5)) continue;
    if (trimArray<ErrorEntry>(out, 'errors', 5)) continue;
    if (trimArray<string>(out, 'userTurns', 5)) continue;
    if (out.lastAsst && out.lastAsst.length > 120) {
      out.lastAsst = clean(out.lastAsst, 120);
      continue;
    }
    break;
  }
  return out;
}

export const salienceCompactor: Compactor<SalienceOutput> = {
  name: 'salience',
  kind: 'semantic',
  targetBytes: 4_000,
  description: 'Rule-based narrative extraction: first/last messages, every user message, decision-marker assistant lines, mutating tool calls, and errored tool results. No LLM. Designed for "what was the user trying to do, did it work?" pattern mining.',
  async run(ctx) {
    const out: SalienceOutput = {
      v: 1,
      userTurns: [],
      decisions: [],
      mutations: [],
      errors: [],
    };

    let turnIdx = -1;
    let lastAsstText: string | undefined;
    const callIdToTool = new Map<string, string>();

    for await (const ev of ctx.iterEvents(ctx.logPath)) {
      if (ev.role === 'user' && ev.kind === 'text' && ev.text) {
        turnIdx++;
        const text = clean(ev.text, USER_TURN_CHARS);
        if (!text) continue;
        if (!out.firstAsk) out.firstAsk = text;
        if (out.userTurns.length < MAX_USER_TURNS) out.userTurns.push(text);
        continue;
      }

      if (ev.role === 'assistant' && ev.kind === 'text' && ev.text) {
        const firstLine = ev.text.split('\n').map((l) => l.trim()).find(Boolean) ?? '';
        if (firstLine && DECISION_RE.test(firstLine) && out.decisions.length < MAX_DECISIONS) {
          out.decisions.push({ at: Math.max(turnIdx, 0), text: clean(firstLine, DECISION_CHARS) });
        }
        lastAsstText = ev.text;
        continue;
      }

      if (ev.kind === 'tool_call' && ev.toolName) {
        if (ev.toolCallId) callIdToTool.set(ev.toolCallId, ev.toolName);
        if (out.mutations.length < MAX_MUTATIONS) {
          if (MUTATION_TOOLS.has(ev.toolName)) {
            const path = extractPath(ev.inputText);
            out.mutations.push(path ? { tool: ev.toolName, path } : { tool: ev.toolName });
          } else if (ev.toolName === 'Bash') {
            const cmd = extractCommand(ev.inputText);
            if (cmd && COMMIT_RE.test(cmd.trim())) {
              out.mutations.push({ tool: 'Bash', arg: clean(cmd, 120) });
            }
          }
        }
        continue;
      }

      if (ev.kind === 'tool_result' && ev.text && ERROR_RE.test(ev.text)) {
        if (out.errors.length < MAX_ERRORS) {
          const tool = ev.toolCallId ? callIdToTool.get(ev.toolCallId) : undefined;
          const sigLine = ev.text.split('\n').find((l) => ERROR_RE.test(l)) ?? ev.text.split('\n')[0] ?? '';
          out.errors.push({ tool, sig: clean(sigLine, ERR_SIG_CHARS) });
        }
      }
    }

    if (lastAsstText) out.lastAsst = clean(lastAsstText, LAST_ASST_CHARS);
    return enforceBudget(out, salienceCompactor.targetBytes ?? 4_000);
  },
};

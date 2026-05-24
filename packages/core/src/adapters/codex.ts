import { existsSync } from 'node:fs';
import { createReadStream } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import Database from 'better-sqlite3';
import type { Adapter, DiscoveredSession, TranscriptEvent } from '../types.js';
import { statLogFile } from './claude-code.js';
import { extractMeaningfulPrompt } from './prompt.js';

const DEFAULT_CODEX_DB = join(homedir(), '.codex', 'state_5.sqlite');

interface ThreadRow {
  id: string;
  rollout_path: string;
  cwd: string;
  first_user_message?: string | null;
  git_branch?: string | null;
  created_at?: number | null;
  updated_at?: number | null;
  created_at_ms?: number | null;
  updated_at_ms?: number | null;
}

function codexDbPath(): string {
  return process.env.CODEX_STATE_DB ?? DEFAULT_CODEX_DB;
}

function safeJsonParse(value: string): unknown {
  try { return JSON.parse(value); } catch { return undefined; }
}

function stringifyValue(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  try { return JSON.stringify(value); } catch { return String(value); }
}

function timestampMs(obj: unknown): number | undefined {
  const ts = (obj as { timestamp?: unknown })?.timestamp;
  if (typeof ts !== 'string') return undefined;
  const ms = Date.parse(ts);
  return Number.isFinite(ms) ? ms : undefined;
}

function isTranscriptRole(role: unknown): role is TranscriptEvent['role'] {
  return role === 'user' || role === 'assistant' || role === 'system';
}

function textParts(content: unknown): string[] {
  if (typeof content === 'string') return content.trim() ? [content] : [];
  if (!Array.isArray(content)) return [];
  const out: string[] = [];
  for (const part of content) {
    if (!part || typeof part !== 'object') continue;
    const p = part as { type?: unknown; text?: unknown };
    if ((p.type === 'input_text' || p.type === 'output_text' || p.type === 'text') && typeof p.text === 'string' && p.text.trim()) {
      out.push(p.text);
    }
  }
  return out;
}

async function firstPromptFromRollout(logPath: string, fallback?: string | null): Promise<string | undefined> {
  let stream;
  try {
    stream = createReadStream(logPath, { encoding: 'utf8' });
  } catch {
    return extractMeaningfulPrompt(fallback);
  }
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const line of rl) {
      if (!line.trim()) continue;
      const obj = safeJsonParse(line);
      if (!obj || typeof obj !== 'object') continue;
      const record = obj as { type?: unknown; payload?: any };
      if (record.type !== 'response_item') continue;
      const payload = record.payload;
      if (payload?.type !== 'message' || payload.role !== 'user') continue;
      for (const text of textParts(payload.content)) {
        const prompt = extractMeaningfulPrompt(text);
        if (prompt) return prompt;
      }
    }
  } finally {
    try { rl.close(); stream.destroy(); } catch { /* ignore */ }
  }
  return extractMeaningfulPrompt(fallback);
}

function openReadonlyDb(path: string): Database.Database | null {
  if (!existsSync(path)) return null;
  try {
    return new Database(path, { readonly: true, fileMustExist: true });
  } catch {
    return null;
  }
}

export const codexAdapter: Adapter = {
  name: 'codex',

  async discover(): Promise<DiscoveredSession[]> {
    const db = openReadonlyDb(codexDbPath());
    if (!db) return [];
    try {
      const rows = db.prepare(`
        SELECT id, rollout_path, cwd, first_user_message, git_branch,
               created_at, updated_at, created_at_ms, updated_at_ms
        FROM threads
        WHERE rollout_path IS NOT NULL AND rollout_path != ''
          AND cwd IS NOT NULL AND cwd != ''
      `).all() as ThreadRow[];

      const out: DiscoveredSession[] = [];
      for (const row of rows) {
        if (!row.id || !row.rollout_path || !row.cwd || !existsSync(row.rollout_path)) continue;
        const firstPrompt = await firstPromptFromRollout(row.rollout_path, row.first_user_message);
        out.push({
          sessionId: row.id,
          logPath: row.rollout_path,
          pwd: row.cwd,
          firstPrompt,
          gitBranch: row.git_branch ?? undefined,
          createdAt: row.created_at_ms ?? (row.created_at != null ? row.created_at * 1000 : undefined),
          modifiedAt: row.updated_at_ms ?? (row.updated_at != null ? row.updated_at * 1000 : undefined),
          raw: row,
        });
      }
      return out;
    } catch {
      return [];
    } finally {
      db.close();
    }
  },

  iterEvents(logPath: string): AsyncIterable<TranscriptEvent> {
    return iterCodexEvents(logPath);
  },

  sourceMtime(session: DiscoveredSession): Promise<number | undefined> {
    return statLogFile(session.logPath);
  },
};

async function* iterCodexEvents(logPath: string): AsyncIterable<TranscriptEvent> {
  let stream;
  try {
    stream = createReadStream(logPath, { encoding: 'utf8' });
  } catch {
    return;
  }
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  let lastMode: string | undefined;
  const toolResultErrors = new Map<string, boolean>();
  try {
    for await (const line of rl) {
      if (!line.trim()) continue;
      const obj = safeJsonParse(line);
      if (!obj || typeof obj !== 'object') continue;
      const record = obj as { type?: unknown; payload?: any };
      if (record.type === 'turn_context') {
        const mode = record.payload?.collaboration_mode?.mode;
        if (typeof mode === 'string' && mode !== lastMode) {
          yield { ts: timestampMs(obj), kind: 'mode_change', mode, prevMode: lastMode };
          lastMode = mode;
        }
        continue;
      }
      if (record.type === 'event_msg') {
        const status = extractToolEndStatus(record.payload);
        if (status) toolResultErrors.set(status.callId, status.isError);
        continue;
      }
      yield* extractCodexEvents(obj, toolResultErrors);
    }
  } finally {
    try { rl.close(); stream.destroy(); } catch { /* ignore */ }
  }
}

function extractToolEndStatus(payload: unknown): { callId: string; isError: boolean } | undefined {
  if (!payload || typeof payload !== 'object') return undefined;
  const p = payload as Record<string, unknown>;
  const callId = p.call_id ?? p.callId ?? p.tool_call_id ?? p.toolCallId;
  if (typeof callId !== 'string' || !callId) return undefined;

  const exitCode = p.exit_code ?? p.exitCode;
  if (typeof exitCode === 'number') return { callId, isError: exitCode !== 0 };
  if (typeof exitCode === 'string' && exitCode.trim()) {
    const parsed = Number(exitCode);
    if (Number.isFinite(parsed)) return { callId, isError: parsed !== 0 };
  }
  return undefined;
}

function* extractCodexEvents(
  obj: unknown,
  toolResultErrors: ReadonlyMap<string, boolean> = new Map(),
): Generator<TranscriptEvent> {
  const record = obj as { type?: unknown; payload?: any };
  if (record.type !== 'response_item') return;
  const payload = record.payload;
  const ts = timestampMs(obj);

  if (payload?.type === 'message') {
    if (!isTranscriptRole(payload.role)) return;
    for (const text of textParts(payload.content)) {
      yield { ts, kind: 'text', role: payload.role, text, raw: obj };
    }
    return;
  }

  if (payload?.type === 'function_call') {
    yield {
      ts,
      kind: 'tool_call',
      role: 'assistant',
      toolCallId: typeof payload.call_id === 'string' ? payload.call_id : undefined,
      toolName: typeof payload.name === 'string' ? payload.name : undefined,
      inputText: stringifyValue(payload.arguments ?? {}),
      raw: obj,
    };
    return;
  }

  if (payload?.type === 'function_call_output') {
    const toolCallId = typeof payload.call_id === 'string' ? payload.call_id : undefined;
    yield {
      ts,
      kind: 'tool_result',
      role: 'user',
      toolCallId,
      isError: toolCallId ? toolResultErrors.get(toolCallId) : undefined,
      text: stringifyValue(payload.output),
      raw: obj,
    };
  }
}

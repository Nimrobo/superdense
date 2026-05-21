import { existsSync } from 'node:fs';
import { createReadStream } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import Database from 'better-sqlite3';
import type { Adapter, DiscoveredSession, TranscriptEvent } from '../types.js';
import { statLogFile } from './claude-code.js';

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

function isLikelyInternalPrompt(text: string): boolean {
  const trimmed = text.trim();
  return (
    trimmed.startsWith('<system_instruction>') ||
    trimmed.startsWith('<environment_context>') ||
    trimmed.startsWith('Respond directly to the user') ||
    trimmed.startsWith('You are generating a git branch name')
  );
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
    return fallback?.trim() ? fallback.trim().slice(0, 500) : undefined;
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
        const trimmed = text.trim();
        if (!trimmed || isLikelyInternalPrompt(trimmed)) continue;
        return trimmed.slice(0, 500);
      }
    }
  } finally {
    try { rl.close(); stream.destroy(); } catch { /* ignore */ }
  }
  const trimmed = fallback?.trim();
  return trimmed ? trimmed.slice(0, 500) : undefined;
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
  try {
    for await (const line of rl) {
      if (!line.trim()) continue;
      const obj = safeJsonParse(line);
      if (!obj || typeof obj !== 'object') continue;
      yield* extractCodexEvents(obj);
    }
  } finally {
    try { rl.close(); stream.destroy(); } catch { /* ignore */ }
  }
}

function* extractCodexEvents(obj: unknown): Generator<TranscriptEvent> {
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
    yield {
      ts,
      kind: 'tool_result',
      role: 'user',
      toolCallId: typeof payload.call_id === 'string' ? payload.call_id : undefined,
      text: stringifyValue(payload.output),
      raw: obj,
    };
  }
}

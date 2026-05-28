import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import type { Adapter, DiscoveredSession, DiscoveredSubAgent, TranscriptEvent } from '../types.js';
import { statLogFile } from './claude-code.js';
import { extractMeaningfulPrompt } from './prompt.js';

const DEFAULT_CURSOR_GLOBAL_DB = join(
  homedir(),
  'Library',
  'Application Support',
  'Cursor',
  'User',
  'globalStorage',
  'state.vscdb',
);

const DEFAULT_CURSOR_WORKSPACE_STORAGE_DIR = join(
  homedir(),
  'Library',
  'Application Support',
  'Cursor',
  'User',
  'workspaceStorage',
);

const LOGPATH_FRAGMENT = '#composer=';

function globalDbPath(): string {
  return process.env.CURSOR_GLOBAL_DB ?? DEFAULT_CURSOR_GLOBAL_DB;
}

function workspaceStorageDir(): string {
  return process.env.CURSOR_WORKSPACE_STORAGE_DIR ?? DEFAULT_CURSOR_WORKSPACE_STORAGE_DIR;
}

function safeJsonParse<T = unknown>(value: string | null | undefined): T | undefined {
  if (value == null) return undefined;
  try {
    return JSON.parse(value) as T;
  } catch {
    return undefined;
  }
}

function stringifyValue(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function isTranscriptRole(role: unknown): role is TranscriptEvent['role'] {
  return role === 'user' || role === 'assistant' || role === 'system';
}

function openReadonlyDb(path: string): Database.Database | null {
  if (!existsSync(path)) return null;
  try {
    return new Database(path, { readonly: true, fileMustExist: true });
  } catch {
    return null;
  }
}

function parseCreatedAtMs(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const ms = Date.parse(value);
    if (Number.isFinite(ms)) return ms;
  }
  return undefined;
}

function fileUriToPath(folder: unknown): string | undefined {
  if (typeof folder !== 'string' || !folder.startsWith('file://')) return undefined;
  try {
    return fileURLToPath(folder);
  } catch {
    return undefined;
  }
}

interface CursorHeader {
  bubbleId?: string;
  type?: number;
}

interface ComposerData {
  composerId?: string;
  createdAt?: number;
  name?: string;
  text?: string;
  fullConversationHeadersOnly?: CursorHeader[];
}

interface ToolFormerData {
  toolCallId?: string;
  name?: string;
  status?: string;
  rawArgs?: string;
  params?: string;
  result?: unknown;
}

interface CursorBubble {
  bubbleId?: string;
  type?: number;
  text?: string;
  thinking?: { text?: string } | string;
  toolFormerData?: ToolFormerData;
  createdAt?: number | string;
  unifiedMode?: number;
  isPlanExecution?: boolean;
}

// Cursor records mode only reliably on user bubbles: assistant bubbles always
// carry unifiedMode=2 even when responding inside plan mode, so the assistant
// inherits the surrounding (user-set) mode. The one exception is
// isPlanExecution=true, which marks an explicit post-approval execution turn.
function deriveMode(
  bubble: CursorBubble,
  isUser: boolean,
  lastMode: string | undefined,
): string | undefined {
  if (bubble.isPlanExecution === true) return 'default';
  if (!isUser) return lastMode;
  if (bubble.unifiedMode === 5) return 'plan';
  if (bubble.unifiedMode === 1) return 'chat';
  if (bubble.unifiedMode === 2) return 'default';
  return lastMode;
}

async function buildComposerPwdMap(): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const dir = workspaceStorageDir();
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    const wsDir = join(dir, entry);
    const workspaceJsonPath = join(wsDir, 'workspace.json');
    let folderRaw: string;
    try {
      folderRaw = await readFile(workspaceJsonPath, 'utf8');
    } catch {
      continue;
    }
    const folderJson = safeJsonParse<{ folder?: unknown }>(folderRaw);
    const pwd = fileUriToPath(folderJson?.folder);
    if (!pwd) continue;

    const wsDbPath = join(wsDir, 'state.vscdb');
    const wsDb = openReadonlyDb(wsDbPath);
    if (!wsDb) continue;
    try {
      const row = wsDb
        .prepare(`SELECT value FROM ItemTable WHERE key = 'composer.composerData' LIMIT 1`)
        .get() as { value?: string } | undefined;
      const parsed = safeJsonParse<{
        allComposers?: Array<{ composerId?: string }>;
      }>(row?.value);
      for (const c of parsed?.allComposers ?? []) {
        if (typeof c?.composerId === 'string' && !out.has(c.composerId)) {
          out.set(c.composerId, pwd);
        }
      }
    } catch {
      // ignore broken workspace dbs
    } finally {
      wsDb.close();
    }
  }
  return out;
}

function firstPromptFromHeaders(
  db: Database.Database,
  composerId: string,
  headers: CursorHeader[],
  fallback?: string,
): string | undefined {
  const stmt = db.prepare(`SELECT value FROM cursorDiskKV WHERE key = ? LIMIT 1`);
  for (const h of headers) {
    if (h?.type !== 1 || !h.bubbleId) continue;
    const row = stmt.get(`bubbleId:${composerId}:${h.bubbleId}`) as { value?: string } | undefined;
    const bubble = safeJsonParse<CursorBubble>(row?.value);
    if (typeof bubble?.text === 'string' && bubble.text.trim()) {
      const prompt = extractMeaningfulPrompt(bubble.text);
      if (prompt) return prompt;
    }
  }
  return extractMeaningfulPrompt(fallback);
}

function maxBubbleMtime(
  db: Database.Database,
  composerId: string,
  headers: CursorHeader[],
): number | undefined {
  if (headers.length === 0) return undefined;
  const tail = headers[headers.length - 1];
  if (!tail?.bubbleId) return undefined;
  const stmt = db.prepare(`SELECT value FROM cursorDiskKV WHERE key = ? LIMIT 1`);
  const row = stmt.get(`bubbleId:${composerId}:${tail.bubbleId}`) as { value?: string } | undefined;
  const bubble = safeJsonParse<CursorBubble>(row?.value);
  return parseCreatedAtMs(bubble?.createdAt);
}

function parseComposerIdFromLogPath(logPath: string): {
  dbPath: string;
  composerId?: string;
} {
  const idx = logPath.indexOf(LOGPATH_FRAGMENT);
  if (idx < 0) return { dbPath: logPath };
  return {
    dbPath: logPath.slice(0, idx),
    composerId: logPath.slice(idx + LOGPATH_FRAGMENT.length) || undefined,
  };
}

export const cursorAdapter: Adapter = {
  name: 'cursor',

  async discover(): Promise<DiscoveredSession[]> {
    const dbPath = globalDbPath();
    const db = openReadonlyDb(dbPath);
    if (!db) return [];

    try {
      const pwdMap = await buildComposerPwdMap();
      const rows = db
        .prepare(`SELECT key, value FROM cursorDiskKV WHERE key LIKE 'composerData:%'`)
        .all() as Array<{ key: string; value: string }>;

      const out: DiscoveredSession[] = [];
      for (const row of rows) {
        const composer = safeJsonParse<ComposerData>(row.value);
        const composerId = composer?.composerId ?? row.key.slice('composerData:'.length);
        if (!composerId) continue;
        const headers = composer?.fullConversationHeadersOnly ?? [];
        if (headers.length === 0) continue;
        const pwd = pwdMap.get(composerId);
        if (!pwd) continue;

        const firstPrompt = firstPromptFromHeaders(
          db,
          composerId,
          headers,
          composer?.name ?? composer?.text ?? undefined,
        );
        const createdAt = parseCreatedAtMs(composer?.createdAt);
        const modifiedAt = maxBubbleMtime(db, composerId, headers) ?? createdAt;

        out.push({
          sessionId: composerId,
          logPath: `${dbPath}${LOGPATH_FRAGMENT}${composerId}`,
          pwd,
          firstPrompt,
          messageCount: headers.length,
          createdAt,
          modifiedAt,
          raw: { composer: { composerId, createdAt, name: composer?.name } },
        });
      }
      return out;
    } catch {
      return [];
    } finally {
      db.close();
    }
  },

  // TODO: implement when Cursor adds sub-agent support
  async discoverSubAgentSessions(_parentSessionId: string): Promise<DiscoveredSubAgent[]> {
    return [];
  },

  iterEvents(logPath: string): AsyncIterable<TranscriptEvent> {
    return iterCursorEvents(logPath);
  },

  sourceMtime(session: DiscoveredSession): Promise<number | undefined> {
    const { dbPath } = parseComposerIdFromLogPath(session.logPath);
    return statLogFile(dbPath);
  },
};

async function* iterCursorEvents(logPath: string): AsyncIterable<TranscriptEvent> {
  const { dbPath, composerId } = parseComposerIdFromLogPath(logPath);
  if (!composerId) return;
  const db = openReadonlyDb(dbPath);
  if (!db) return;
  try {
    const composerRow = db
      .prepare(`SELECT value FROM cursorDiskKV WHERE key = ? LIMIT 1`)
      .get(`composerData:${composerId}`) as { value?: string } | undefined;
    const composer = safeJsonParse<ComposerData>(composerRow?.value);
    const headers = composer?.fullConversationHeadersOnly ?? [];
    if (headers.length === 0) return;

    const bubbleStmt = db.prepare(`SELECT value FROM cursorDiskKV WHERE key = ? LIMIT 1`);
    let currentMode: string | undefined;
    for (const header of headers) {
      if (!header?.bubbleId) continue;
      const row = bubbleStmt.get(`bubbleId:${composerId}:${header.bubbleId}`) as
        | { value?: string }
        | undefined;
      const bubble = safeJsonParse<CursorBubble>(row?.value);
      if (!bubble) continue;
      const ts = parseCreatedAtMs(bubble.createdAt);
      const isUser = (typeof bubble.type === 'number' ? bubble.type : header.type) === 1;
      const derived = deriveMode(bubble, isUser, currentMode);
      // Only emit transitions that cross the plan boundary — the downstream
      // plan-mode enricher only differentiates 'plan' vs not. Suppress
      // default↔chat noise.
      if (derived !== currentMode && (derived === 'plan' || currentMode === 'plan')) {
        yield { ts, kind: 'mode_change', mode: derived, prevMode: currentMode };
      }
      currentMode = derived;
      yield* bubbleToEvents(bubble, header.type);
    }
  } finally {
    db.close();
  }
}

function* bubbleToEvents(
  bubble: CursorBubble,
  headerType: number | undefined,
): Generator<TranscriptEvent> {
  const ts = parseCreatedAtMs(bubble.createdAt);
  const type = typeof bubble.type === 'number' ? bubble.type : headerType;

  if (type === 1) {
    if (typeof bubble.text === 'string' && bubble.text.trim()) {
      const role: TranscriptEvent['role'] = 'user';
      if (isTranscriptRole(role)) {
        yield { ts, kind: 'text', role, text: bubble.text, raw: bubble };
      }
    }
    return;
  }

  if (type === 2) {
    if (typeof bubble.text === 'string' && bubble.text.trim()) {
      yield {
        ts,
        kind: 'text',
        role: 'assistant',
        text: bubble.text,
        raw: bubble,
      };
    }

    const tfd = bubble.toolFormerData;
    if (tfd && typeof tfd === 'object') {
      const toolCallId = typeof tfd.toolCallId === 'string' ? tfd.toolCallId : undefined;
      const toolName = typeof tfd.name === 'string' ? tfd.name : undefined;
      const inputText =
        typeof tfd.rawArgs === 'string' && tfd.rawArgs
          ? tfd.rawArgs
          : typeof tfd.params === 'string'
            ? tfd.params
            : stringifyValue(tfd.params ?? {});
      yield {
        ts,
        kind: 'tool_call',
        role: 'assistant',
        toolCallId,
        toolName,
        inputText,
        raw: bubble,
      };

      const status = typeof tfd.status === 'string' ? tfd.status : undefined;
      const hasResult = tfd.result !== undefined || status === 'completed' || status === 'error';
      if (hasResult) {
        yield {
          ts,
          kind: 'tool_result',
          role: 'user',
          toolCallId,
          isError: status === 'error',
          text: stringifyValue(tfd.result ?? ''),
          raw: bubble,
        };
      }
    }
  }
}

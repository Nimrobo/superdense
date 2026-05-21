import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import type { Adapter, DiscoveredSession, TranscriptEvent } from '../types.js';

interface OpenCodeSessionRow {
  id: string;
  directory: string | null;
  title: string | null;
  time_created: number | null;
  time_updated: number | null;
  parent_id: string | null;
  project_worktree: string | null;
  git_branch: string | null;
  message_count: number | null;
}

interface OpenCodePartRow {
  message_id: string;
  message_role: string | null;
  message_time: number;
  part_id: string;
  part_time: number;
  part_data: string;
}

function candidateDbPaths(): string[] {
  if (process.env.OPENCODE_DB) return [process.env.OPENCODE_DB];
  const paths: string[] = [];
  if (process.env.XDG_DATA_HOME) paths.push(join(process.env.XDG_DATA_HOME, 'opencode', 'opencode.db'));
  paths.push(join(homedir(), '.local', 'share', 'opencode', 'opencode.db'));
  paths.push(join(homedir(), 'Library', 'Application Support', 'opencode', 'opencode.db'));
  return Array.from(new Set(paths));
}

function openReadonlyDb(path: string): Database.Database | null {
  if (!existsSync(path)) return null;
  try {
    return new Database(path, { readonly: true, fileMustExist: true });
  } catch {
    return null;
  }
}

function firstExistingDbPath(): string | undefined {
  return candidateDbPaths().find((p) => existsSync(p));
}

function tableExists(db: Database.Database, name: string): boolean {
  const row = db
    .prepare("SELECT 1 AS x FROM sqlite_master WHERE type='table' AND name = ?")
    .get(name) as { x: number } | undefined;
  return !!row;
}

function columnExists(db: Database.Database, table: string, column: string): boolean {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return rows.some((r) => r.name === column);
}

function locator(dbPath: string, sessionId: string): string {
  return `opencode:${dbPath}#${sessionId}`;
}

function parseLocator(value: string): { dbPath: string; sessionId: string } | null {
  if (!value.startsWith('opencode:')) return null;
  const rest = value.slice('opencode:'.length);
  const hash = rest.lastIndexOf('#');
  if (hash <= 0 || hash === rest.length - 1) return null;
  return { dbPath: rest.slice(0, hash), sessionId: rest.slice(hash + 1) };
}

function safeJsonParse(value: string): any {
  try { return JSON.parse(value); } catch { return undefined; }
}

function isTranscriptRole(role: unknown): role is TranscriptEvent['role'] {
  return role === 'user' || role === 'assistant' || role === 'system';
}

function stringifyValue(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  try { return JSON.stringify(value); } catch { return String(value); }
}

function compactText(value: unknown): string | undefined {
  const text = stringifyValue(value).trim();
  return text ? text : undefined;
}

function resultText(state: any): string | undefined {
  return compactText(state?.output) ?? compactText(state?.error) ?? compactText(state?.message);
}

function shouldEmitToolResult(state: any): boolean {
  if (!state || typeof state !== 'object') return false;
  return state.output != null || state.error != null || state.status === 'completed' || state.status === 'error' || state.status === 'failed';
}

function openCodeSelect(db: Database.Database): string {
  const hasProject = tableExists(db, 'project');
  const hasWorkspace = tableExists(db, 'workspace');
  const workspaceHasBranch = hasWorkspace && columnExists(db, 'workspace', 'branch') && columnExists(db, 'session', 'workspace_id');

  return `
    SELECT
      s.id,
      s.directory,
      s.title,
      s.time_created,
      s.time_updated,
      s.parent_id,
      ${hasProject ? 'p.worktree' : 'NULL'} AS project_worktree,
      ${workspaceHasBranch ? 'w.branch' : 'NULL'} AS git_branch,
      COUNT(m.id) AS message_count
    FROM session s
    ${hasProject ? 'LEFT JOIN project p ON p.id = s.project_id' : ''}
    ${workspaceHasBranch ? 'LEFT JOIN workspace w ON w.id = s.workspace_id' : ''}
    LEFT JOIN message m ON m.session_id = s.id
    GROUP BY s.id
    ORDER BY COALESCE(s.time_updated, 0) DESC
  `;
}

function firstPrompt(db: Database.Database, sessionId: string): string | undefined {
  if (!tableExists(db, 'message') || !tableExists(db, 'part')) return undefined;
  const rows = db.prepare(`
    SELECT p.data AS part_data
    FROM message m
    JOIN part p ON p.message_id = m.id
    WHERE m.session_id = ?
      AND json_extract(m.data, '$.role') = 'user'
      AND json_extract(p.data, '$.type') = 'text'
    ORDER BY m.time_created ASC, p.time_created ASC, p.id ASC
    LIMIT 10
  `).all(sessionId) as Array<{ part_data: string }>;

  for (const row of rows) {
    const parsed = safeJsonParse(row.part_data);
    if (typeof parsed?.text === 'string' && parsed.text.trim()) return parsed.text.trim().slice(0, 500);
  }
  return undefined;
}

export const openCodeAdapter: Adapter = {
  name: 'opencode',

  async discover(): Promise<DiscoveredSession[]> {
    const dbPath = firstExistingDbPath();
    if (!dbPath) return [];
    const db = openReadonlyDb(dbPath);
    if (!db) return [];
    try {
      if (!tableExists(db, 'session')) return [];
      const rows = db.prepare(openCodeSelect(db)).all() as OpenCodeSessionRow[];
      return rows
        .filter((row) => !!row.id)
        .map((row) => {
          const pwd = row.directory || row.project_worktree || '';
          return {
            sessionId: row.id,
            logPath: locator(dbPath, row.id),
            pwd,
            firstPrompt: firstPrompt(db, row.id),
            summary: row.title ?? undefined,
            messageCount: row.message_count ?? undefined,
            gitBranch: row.git_branch ?? undefined,
            createdAt: row.time_created ?? undefined,
            modifiedAt: row.time_updated ?? undefined,
            isSidechain: !!row.parent_id,
            raw: row,
          };
        })
        .filter((s) => s.pwd);
    } catch {
      return [];
    } finally {
      db.close();
    }
  },

  iterEvents(logPath: string): AsyncIterable<TranscriptEvent> {
    return iterOpenCodeEvents(logPath);
  },

  async sourceMtime(session: DiscoveredSession): Promise<number | undefined> {
    return session.modifiedAt;
  },
};

async function* iterOpenCodeEvents(logPath: string): AsyncIterable<TranscriptEvent> {
  const parsed = parseLocator(logPath);
  if (!parsed) return;
  const db = openReadonlyDb(parsed.dbPath);
  if (!db) return;
  try {
    if (!tableExists(db, 'message') || !tableExists(db, 'part')) return;
    const rows = db.prepare(`
      SELECT
        m.id AS message_id,
        json_extract(m.data, '$.role') AS message_role,
        m.time_created AS message_time,
        p.id AS part_id,
        p.time_created AS part_time,
        p.data AS part_data
      FROM message m
      JOIN part p ON p.message_id = m.id
      WHERE m.session_id = ?
      ORDER BY m.time_created ASC, p.time_created ASC, p.id ASC
    `).all(parsed.sessionId) as OpenCodePartRow[];

    for (const row of rows) {
      yield* extractOpenCodePart(row);
    }
  } finally {
    db.close();
  }
}

function* extractOpenCodePart(row: OpenCodePartRow): Generator<TranscriptEvent> {
  const data = safeJsonParse(row.part_data);
  if (!data || typeof data !== 'object') return;
  const role = isTranscriptRole(row.message_role) ? row.message_role : undefined;
  const ts = row.part_time ?? row.message_time;

  if (data.type === 'text' && typeof data.text === 'string' && data.text.trim()) {
    yield { ts, kind: 'text', role, text: data.text, raw: data };
    return;
  }

  if (data.type !== 'tool') return;
  const callId = typeof data.callID === 'string' ? data.callID : row.part_id;
  const state = data.state;
  yield {
    ts,
    kind: 'tool_call',
    role: role ?? 'assistant',
    toolCallId: callId,
    toolName: typeof data.tool === 'string' ? data.tool : undefined,
    inputText: stringifyValue(state?.input ?? {}),
    raw: data,
  };

  if (shouldEmitToolResult(state)) {
    yield {
      ts,
      kind: 'tool_result',
      role: role ?? 'assistant',
      toolCallId: callId,
      text: resultText(state) ?? '',
      raw: data,
    };
  }
}

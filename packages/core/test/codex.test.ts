import Database from 'better-sqlite3';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { codexAdapter } from '../src/adapters/codex.js';

let tempDir: string | undefined;
const originalDb = process.env.CODEX_STATE_DB;

afterEach(async () => {
  if (originalDb == null) delete process.env.CODEX_STATE_DB;
  else process.env.CODEX_STATE_DB = originalDb;
  if (!tempDir) return;
  await rm(tempDir, { recursive: true, force: true });
  tempDir = undefined;
});

async function makeTempDir(): Promise<string> {
  tempDir = await mkdtemp(join(tmpdir(), 'superdense-codex-test-'));
  return tempDir;
}

function writeStateDb(path: string, rolloutPath: string): void {
  const db = new Database(path);
  db.exec(`
    CREATE TABLE threads (
      id TEXT PRIMARY KEY,
      rollout_path TEXT NOT NULL,
      cwd TEXT NOT NULL,
      first_user_message TEXT,
      git_branch TEXT,
      created_at INTEGER,
      updated_at INTEGER,
      created_at_ms INTEGER,
      updated_at_ms INTEGER
    );
  `);
  db.prepare(`
    INSERT INTO threads (
      id, rollout_path, cwd, first_user_message, git_branch,
      created_at, updated_at, created_at_ms, updated_at_ms
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'thread-1',
    rolloutPath,
    '/repo',
    'fallback prompt',
    'feature/codex',
    100,
    200,
    null,
    250_000,
  );
  db.close();
}

describe('codexAdapter', () => {
  it('discovers sessions from the Codex state DB and rollout file', async () => {
    const dir = await makeTempDir();
    const rolloutPath = join(dir, 'rollout.jsonl');
    await writeFile(rolloutPath, [
      JSON.stringify({ type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '<system_instruction>internal</system_instruction>' }] } }),
      JSON.stringify({ type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Build the adapters' }] } }),
    ].join('\n'), 'utf8');
    const dbPath = join(dir, 'state.sqlite');
    writeStateDb(dbPath, rolloutPath);
    process.env.CODEX_STATE_DB = dbPath;

    const sessions = await codexAdapter.discover();

    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      sessionId: 'thread-1',
      logPath: rolloutPath,
      pwd: '/repo',
      firstPrompt: 'Build the adapters',
      gitBranch: 'feature/codex',
      createdAt: 100_000,
      modifiedAt: 250_000,
    });
  });

  it('normalizes text, tool calls, and tool outputs with pairable ids', async () => {
    const dir = await makeTempDir();
    const rolloutPath = join(dir, 'rollout.jsonl');
    await writeFile(rolloutPath, [
      JSON.stringify({ timestamp: '2026-05-21T04:00:00.000Z', type: 'session_meta', payload: { id: 'thread-1' } }),
      JSON.stringify({ timestamp: '2026-05-21T04:00:01.000Z', type: 'response_item', payload: { type: 'message', role: 'developer', content: [{ type: 'input_text', text: 'internal' }] } }),
      JSON.stringify({ timestamp: '2026-05-21T04:00:02.000Z', type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Run tests' }] } }),
      JSON.stringify({ timestamp: '2026-05-21T04:00:03.000Z', type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'I will run a command.' }] } }),
      JSON.stringify({ timestamp: '2026-05-21T04:00:04.000Z', type: 'response_item', payload: { type: 'function_call', call_id: 'call_123', name: 'exec_command', arguments: { cmd: 'pnpm test' } } }),
      JSON.stringify({ timestamp: '2026-05-21T04:00:05.000Z', type: 'event_msg', payload: { type: 'token_count' } }),
      JSON.stringify({ timestamp: '2026-05-21T04:00:06.000Z', type: 'response_item', payload: { type: 'function_call_output', call_id: 'call_123', output: 'ok' } }),
      JSON.stringify({ timestamp: '2026-05-21T04:00:07.000Z', type: 'response_item', payload: { type: 'reasoning', content: [] } }),
    ].join('\n'), 'utf8');

    const events = [];
    for await (const event of codexAdapter.iterEvents(rolloutPath)) events.push(event);

    expect(events).toMatchObject([
      { kind: 'text', role: 'user', text: 'Run tests' },
      { kind: 'text', role: 'assistant', text: 'I will run a command.' },
      {
        kind: 'tool_call',
        role: 'assistant',
        toolCallId: 'call_123',
        toolName: 'exec_command',
        inputText: '{"cmd":"pnpm test"}',
      },
      { kind: 'tool_result', role: 'user', toolCallId: 'call_123', text: 'ok' },
    ]);
  });
});

import Database from 'better-sqlite3';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { iterSessionEvents } from '../src/adapters/index.js';
import { toolCountsEnricher } from '../src/enrichers/tool-counts.js';
import type { Session } from '../src/types.js';

let tempDir: string | undefined;

afterEach(async () => {
  if (!tempDir) return;
  await rm(tempDir, { recursive: true, force: true });
  tempDir = undefined;
});

async function makeTempDir(): Promise<string> {
  tempDir = await mkdtemp(join(tmpdir(), 'superdense-dispatch-test-'));
  return tempDir;
}

async function collect(session: Session) {
  const events = [];
  for await (const event of iterSessionEvents(session)) events.push(event);
  return events;
}

function baseSession(overrides: Partial<Session>): Session {
  return {
    id: `${overrides.agent ?? 'agent'}:${overrides.sessionId ?? 'session'}`,
    agent: overrides.agent ?? 'agent',
    sessionId: overrides.sessionId ?? 'session',
    logPath: overrides.logPath ?? '',
    pwd: '/repo',
    ...overrides,
  };
}

describe('iterSessionEvents', () => {
  it('dispatches Codex sessions through the Codex adapter', async () => {
    const dir = await makeTempDir();
    const rolloutPath = join(dir, 'rollout.jsonl');
    await writeFile(
      rolloutPath,
      JSON.stringify({
        type: 'response_item',
        payload: {
          type: 'function_call',
          call_id: 'call_1',
          name: 'exec_command',
          arguments: { cmd: 'ls' },
        },
      }),
      'utf8',
    );
    const session = baseSession({ agent: 'codex', sessionId: 'thread-1', logPath: rolloutPath });

    const events = await collect(session);

    expect(events).toMatchObject([
      { kind: 'tool_call', toolCallId: 'call_1', toolName: 'exec_command' },
    ]);
    await expect(
      toolCountsEnricher.run({
        session,
        logPath: session.logPath,
        iterEvents: () => iterSessionEvents(session),
      }),
    ).resolves.toEqual({ exec_command: 1 });
  });

  it('dispatches OpenCode sessions through the OpenCode adapter', async () => {
    const dir = await makeTempDir();
    const dbPath = join(dir, 'opencode.db');
    const db = new Database(dbPath);
    db.exec(`
      CREATE TABLE message (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        time_created INTEGER NOT NULL,
        time_updated INTEGER NOT NULL,
        data TEXT NOT NULL
      );
      CREATE TABLE part (
        id TEXT PRIMARY KEY,
        message_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        time_created INTEGER NOT NULL,
        time_updated INTEGER NOT NULL,
        data TEXT NOT NULL
      );
    `);
    db.prepare(
      'INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?)',
    ).run('msg_1', 'ses_1', 1, 1, JSON.stringify({ role: 'assistant' }));
    db.prepare(
      'INSERT INTO part (id, message_id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(
      'part_1',
      'msg_1',
      'ses_1',
      2,
      2,
      JSON.stringify({
        type: 'tool',
        tool: 'bash',
        state: { status: 'completed', input: { command: 'pwd' }, output: '/repo' },
      }),
    );
    db.close();
    const session = baseSession({
      agent: 'opencode',
      sessionId: 'ses_1',
      logPath: `opencode:${dbPath}#ses_1`,
    });

    const events = await collect(session);

    expect(events).toMatchObject([
      { kind: 'tool_call', toolName: 'bash', inputText: '{"command":"pwd"}' },
      { kind: 'tool_result', text: '/repo' },
    ]);
    await expect(
      toolCountsEnricher.run({
        session,
        logPath: session.logPath,
        iterEvents: () => iterSessionEvents(session),
      }),
    ).resolves.toEqual({ bash: 1 });
  });

  it('returns an empty stream for unknown adapters', async () => {
    await expect(collect(baseSession({ agent: 'unknown' }))).resolves.toEqual([]);
  });
});

import Database from 'better-sqlite3';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openCodeAdapter } from '../src/adapters/opencode.js';

let tempDir: string | undefined;
const originalDb = process.env.OPENCODE_DB;

afterEach(async () => {
  if (originalDb == null) delete process.env.OPENCODE_DB;
  else process.env.OPENCODE_DB = originalDb;
  if (!tempDir) return;
  await rm(tempDir, { recursive: true, force: true });
  tempDir = undefined;
});

async function makeTempDir(): Promise<string> {
  tempDir = await mkdtemp(join(tmpdir(), 'superdense-opencode-test-'));
  return tempDir;
}

function writeOpenCodeDb(path: string): void {
  const db = new Database(path);
  db.exec(`
    CREATE TABLE project (
      id TEXT PRIMARY KEY,
      worktree TEXT NOT NULL
    );
    CREATE TABLE workspace (
      id TEXT PRIMARY KEY,
      branch TEXT,
      project_id TEXT NOT NULL
    );
    CREATE TABLE session (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      parent_id TEXT,
      slug TEXT NOT NULL,
      directory TEXT NOT NULL,
      title TEXT NOT NULL,
      version TEXT NOT NULL,
      time_created INTEGER NOT NULL,
      time_updated INTEGER NOT NULL,
      workspace_id TEXT
    );
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
  db.prepare('INSERT INTO project (id, worktree) VALUES (?, ?)').run('project-1', '/project-root');
  db.prepare('INSERT INTO workspace (id, branch, project_id) VALUES (?, ?, ?)').run('workspace-1', 'feature/opencode', 'project-1');
  db.prepare(`
    INSERT INTO session (
      id, project_id, parent_id, slug, directory, title, version,
      time_created, time_updated, workspace_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run('ses_1', 'project-1', null, 'slug', '/repo', 'OpenCode session', '1', 1000, 2000, 'workspace-1');
  db.prepare('INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?)').run(
    'msg_user',
    'ses_1',
    1100,
    1100,
    JSON.stringify({ role: 'user' }),
  );
  db.prepare('INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?)').run(
    'msg_assistant',
    'ses_1',
    1200,
    1200,
    JSON.stringify({ role: 'assistant', path: { cwd: '/repo' } }),
  );
  const insertPart = db.prepare('INSERT INTO part (id, message_id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?, ?)');
  insertPart.run('part_user_text', 'msg_user', 'ses_1', 1101, 1101, JSON.stringify({ type: 'text', text: 'Create a file' }));
  insertPart.run('part_assistant_text', 'msg_assistant', 'ses_1', 1201, 1201, JSON.stringify({ type: 'text', text: 'I will edit it.' }));
  insertPart.run('part_tool', 'msg_assistant', 'ses_1', 1202, 1202, JSON.stringify({
    type: 'tool',
    tool: 'bash',
    callID: 'tool_1',
    state: {
      status: 'completed',
      input: { command: 'printf ok' },
      output: 'ok',
    },
  }));
  db.close();
}

describe('openCodeAdapter', () => {
  it('discovers sessions from the OpenCode DB', async () => {
    const dir = await makeTempDir();
    const dbPath = join(dir, 'opencode.db');
    writeOpenCodeDb(dbPath);
    process.env.OPENCODE_DB = dbPath;

    const sessions = await openCodeAdapter.discover();

    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      sessionId: 'ses_1',
      logPath: `opencode:${dbPath}#ses_1`,
      pwd: '/repo',
      firstPrompt: 'Create a file',
      summary: 'OpenCode session',
      messageCount: 2,
      gitBranch: 'feature/opencode',
      createdAt: 1000,
      modifiedAt: 2000,
    });
  });

  it('skips setup text parts when discovering the first prompt', async () => {
    const dir = await makeTempDir();
    const dbPath = join(dir, 'opencode.db');
    writeOpenCodeDb(dbPath);
    const db = new Database(dbPath);
    db.prepare('INSERT INTO part (id, message_id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?, ?)').run(
      'part_setup_text',
      'msg_user',
      'ses_1',
      1001,
      1001,
      JSON.stringify({ type: 'text', text: '<system_instruction>internal setup</system_instruction>' }),
    );
    db.close();
    process.env.OPENCODE_DB = dbPath;

    const sessions = await openCodeAdapter.discover();

    expect(sessions[0].firstPrompt).toBe('Create a file');
  });

  it('normalizes text and tool parts into common transcript events', async () => {
    const dir = await makeTempDir();
    const dbPath = join(dir, 'opencode.db');
    writeOpenCodeDb(dbPath);

    const events = [];
    for await (const event of openCodeAdapter.iterEvents(`opencode:${dbPath}#ses_1`)) events.push(event);

    expect(events).toMatchObject([
      { kind: 'text', role: 'user', text: 'Create a file' },
      { kind: 'text', role: 'assistant', text: 'I will edit it.' },
      {
        kind: 'tool_call',
        role: 'assistant',
        toolCallId: 'tool_1',
        toolName: 'bash',
        inputText: '{"command":"printf ok"}',
      },
      { kind: 'tool_result', role: 'assistant', toolCallId: 'tool_1', text: 'ok' },
    ]);
  });

  it('emits mode_change when message.data.agent transitions', async () => {
    const dir = await makeTempDir();
    const dbPath = join(dir, 'opencode.db');
    writeOpenCodeDb(dbPath);
    const db = new Database(dbPath);
    db.prepare('INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?)').run(
      'msg_plan_user',
      'ses_1',
      1300,
      1300,
      JSON.stringify({ role: 'user', agent: 'plan' }),
    );
    db.prepare('INSERT INTO part (id, message_id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?, ?)').run(
      'part_plan_user_text',
      'msg_plan_user',
      'ses_1',
      1301,
      1301,
      JSON.stringify({ type: 'text', text: 'switch to plan' }),
    );
    db.prepare('INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?)').run(
      'msg_plan_assistant',
      'ses_1',
      1400,
      1400,
      JSON.stringify({ role: 'assistant', agent: 'plan' }),
    );
    db.prepare('INSERT INTO part (id, message_id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?, ?)').run(
      'part_plan_assistant_text',
      'msg_plan_assistant',
      'ses_1',
      1401,
      1401,
      JSON.stringify({ type: 'text', text: 'in plan now' }),
    );
    db.prepare('INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?)').run(
      'msg_build_user',
      'ses_1',
      1500,
      1500,
      JSON.stringify({ role: 'user', agent: 'build' }),
    );
    db.prepare('INSERT INTO part (id, message_id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?, ?)').run(
      'part_build_user_text',
      'msg_build_user',
      'ses_1',
      1501,
      1501,
      JSON.stringify({ type: 'text', text: 'back to build' }),
    );
    db.close();

    const events = [];
    for await (const event of openCodeAdapter.iterEvents(`opencode:${dbPath}#ses_1`)) events.push(event);
    const modeChanges = events.filter((e) => e.kind === 'mode_change');
    expect(modeChanges).toEqual([
      { ts: 1300, kind: 'mode_change', mode: 'plan', prevMode: undefined },
      { ts: 1500, kind: 'mode_change', mode: 'build', prevMode: 'plan' },
    ]);
  });

  it('returns no sessions when the OpenCode DB is missing', async () => {
    const dir = await makeTempDir();
    process.env.OPENCODE_DB = join(dir, 'missing.db');

    await expect(openCodeAdapter.discover()).resolves.toEqual([]);
  });
});

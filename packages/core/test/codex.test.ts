import Database from 'better-sqlite3';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { codexAdapter } from '../src/adapters/codex.js';
import { collectFootprint } from '../src/enrichers/file-footprint.js';

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
  db.prepare(
    `
    INSERT INTO threads (
      id, rollout_path, cwd, first_user_message, git_branch,
      created_at, updated_at, created_at_ms, updated_at_ms
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
  ).run(
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
    await writeFile(
      rolloutPath,
      [
        JSON.stringify({
          type: 'response_item',
          payload: {
            type: 'message',
            role: 'user',
            content: [
              { type: 'input_text', text: '<system_instruction>internal</system_instruction>' },
            ],
          },
        }),
        JSON.stringify({
          type: 'response_item',
          payload: {
            type: 'message',
            role: 'user',
            content: [{ type: 'input_text', text: 'Build the adapters' }],
          },
        }),
      ].join('\n'),
      'utf8',
    );
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

  it('discovers only root Codex threads and exposes sub-agent children by parent', async () => {
    const dir = await makeTempDir();
    const rootRollout = join(dir, 'root.jsonl');
    const childRollout = join(dir, 'child.jsonl');
    await writeFile(
      rootRollout,
      JSON.stringify({
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: 'Coordinate the work' }],
        },
      }),
      'utf8',
    );
    await writeFile(
      childRollout,
      JSON.stringify({
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: 'Inspect the adapters' }],
        },
      }),
      'utf8',
    );
    const dbPath = join(dir, 'state.sqlite');
    const db = new Database(dbPath);
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
        updated_at_ms INTEGER,
        source TEXT
      );
    `);
    const insert = db.prepare(
      `
      INSERT INTO threads (
        id, rollout_path, cwd, first_user_message, git_branch,
        created_at, updated_at, created_at_ms, updated_at_ms, source
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    );
    insert.run('root-thread', rootRollout, '/repo', null, null, 1, 2, null, null, null);
    insert.run(
      'child-thread',
      childRollout,
      '/repo',
      null,
      null,
      3,
      4,
      null,
      null,
      JSON.stringify({
        subagent: {
          thread_spawn: {
            parent_thread_id: 'root-thread',
            depth: 1,
            agent_role: 'explorer',
            agent_nickname: 'Dalton',
            agent_path: '/agents/explorer',
          },
        },
      }),
    );
    db.close();
    process.env.CODEX_STATE_DB = dbPath;

    const roots = await codexAdapter.discover();
    const children = await codexAdapter.discoverSubAgentSessions('root-thread');

    expect(roots.map((s) => s.sessionId)).toEqual(['root-thread']);
    expect(children).toHaveLength(1);
    expect(children[0]).toMatchObject({
      relation: 'subagent',
      metadata: {
        depth: 1,
        agent_role: 'explorer',
        agent_nickname: 'Dalton',
        agent_path: '/agents/explorer',
      },
      session: {
        sessionId: 'child-thread',
        logPath: childRollout,
        pwd: '/repo',
        firstPrompt: 'Inspect the adapters',
      },
    });
  });

  it('handles mixed source formats when discovering Codex sub-agents', async () => {
    const dir = await makeTempDir();
    const rolloutPaths = new Map<string, string>();
    for (const id of [
      'root-cli',
      'root-exec',
      'root-vscode',
      'root-invalid-json',
      'root-null',
      'child-thread',
    ]) {
      const rolloutPath = join(dir, `${id}.jsonl`);
      rolloutPaths.set(id, rolloutPath);
      await writeFile(
        rolloutPath,
        JSON.stringify({
          type: 'response_item',
          payload: {
            type: 'message',
            role: 'user',
            content: [{ type: 'input_text', text: `Prompt for ${id}` }],
          },
        }),
        'utf8',
      );
    }

    const dbPath = join(dir, 'state.sqlite');
    const db = new Database(dbPath);
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
        updated_at_ms INTEGER,
        source TEXT
      );
    `);
    const insert = db.prepare(
      `
      INSERT INTO threads (
        id, rollout_path, cwd, first_user_message, git_branch,
        created_at, updated_at, created_at_ms, updated_at_ms, source
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    );
    insert.run(
      'root-cli',
      rolloutPaths.get('root-cli'),
      '/repo',
      null,
      null,
      1,
      2,
      null,
      null,
      'cli',
    );
    insert.run(
      'root-exec',
      rolloutPaths.get('root-exec'),
      '/repo',
      null,
      null,
      1,
      2,
      null,
      null,
      'exec',
    );
    insert.run(
      'root-vscode',
      rolloutPaths.get('root-vscode'),
      '/repo',
      null,
      null,
      1,
      2,
      null,
      null,
      'vscode',
    );
    insert.run(
      'root-invalid-json',
      rolloutPaths.get('root-invalid-json'),
      '/repo',
      null,
      null,
      1,
      2,
      null,
      null,
      '{"subagent":',
    );
    insert.run(
      'root-null',
      rolloutPaths.get('root-null'),
      '/repo',
      null,
      null,
      1,
      2,
      null,
      null,
      null,
    );
    insert.run(
      'child-thread',
      rolloutPaths.get('child-thread'),
      '/repo',
      null,
      null,
      3,
      4,
      null,
      null,
      JSON.stringify({
        subagent: {
          thread_spawn: {
            parent_thread_id: 'root-cli',
            depth: 1,
            agent_role: 'explorer',
            agent_nickname: 'Dalton',
            agent_path: '/agents/explorer',
          },
        },
      }),
    );
    db.close();
    process.env.CODEX_STATE_DB = dbPath;

    const roots = await codexAdapter.discover();
    const children = await codexAdapter.discoverSubAgentSessions('root-cli');

    expect(roots.map((s) => s.sessionId).sort()).toEqual([
      'root-cli',
      'root-exec',
      'root-invalid-json',
      'root-null',
      'root-vscode',
    ]);
    expect(children).toHaveLength(1);
    expect(children[0]).toMatchObject({
      relation: 'subagent',
      metadata: {
        depth: 1,
        agent_role: 'explorer',
        agent_nickname: 'Dalton',
        agent_path: '/agents/explorer',
      },
      session: {
        sessionId: 'child-thread',
        firstPrompt: 'Prompt for child-thread',
      },
    });
  });

  it('normalizes text, tool calls, and tool outputs with pairable ids', async () => {
    const dir = await makeTempDir();
    const rolloutPath = join(dir, 'rollout.jsonl');
    await writeFile(
      rolloutPath,
      [
        JSON.stringify({
          timestamp: '2026-05-21T04:00:00.000Z',
          type: 'session_meta',
          payload: { id: 'thread-1' },
        }),
        JSON.stringify({
          timestamp: '2026-05-21T04:00:01.000Z',
          type: 'response_item',
          payload: {
            type: 'message',
            role: 'developer',
            content: [{ type: 'input_text', text: 'internal' }],
          },
        }),
        JSON.stringify({
          timestamp: '2026-05-21T04:00:02.000Z',
          type: 'response_item',
          payload: {
            type: 'message',
            role: 'user',
            content: [{ type: 'input_text', text: 'Run tests' }],
          },
        }),
        JSON.stringify({
          timestamp: '2026-05-21T04:00:03.000Z',
          type: 'response_item',
          payload: {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: 'I will run a command.' }],
          },
        }),
        JSON.stringify({
          timestamp: '2026-05-21T04:00:04.000Z',
          type: 'response_item',
          payload: {
            type: 'function_call',
            call_id: 'call_123',
            name: 'exec_command',
            arguments: { cmd: 'pnpm test' },
          },
        }),
        JSON.stringify({
          timestamp: '2026-05-21T04:00:05.000Z',
          type: 'event_msg',
          payload: { type: 'exec_command_end', call_id: 'call_123', exit_code: 0 },
        }),
        JSON.stringify({
          timestamp: '2026-05-21T04:00:06.000Z',
          type: 'response_item',
          payload: { type: 'function_call_output', call_id: 'call_123', output: 'ok' },
        }),
        JSON.stringify({
          timestamp: '2026-05-21T04:00:07.000Z',
          type: 'response_item',
          payload: { type: 'reasoning', content: [] },
        }),
      ].join('\n'),
      'utf8',
    );

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
      { kind: 'tool_result', role: 'user', toolCallId: 'call_123', isError: false, text: 'ok' },
    ]);
  });

  it('normalizes native custom apply_patch calls so file footprints retain writes', async () => {
    const dir = await makeTempDir();
    const rolloutPath = join(dir, 'rollout.jsonl');
    await writeFile(
      rolloutPath,
      [
        JSON.stringify({
          timestamp: '2026-05-21T04:00:00.000Z',
          type: 'response_item',
          payload: {
            type: 'custom_tool_call',
            call_id: 'patch_1',
            name: 'apply_patch',
            input: '*** Begin Patch\n*** Add File: src/native.ts\n+export {};\n*** End Patch',
          },
        }),
        JSON.stringify({
          timestamp: '2026-05-21T04:00:01.000Z',
          type: 'response_item',
          payload: { type: 'custom_tool_call_output', call_id: 'patch_1', output: 'Done!' },
        }),
      ].join('\n'),
      'utf8',
    );

    const footprint = await collectFootprint({
      session: {
        id: 'codex:thread-1',
        agent: 'codex',
        sessionId: 'thread-1',
        logPath: rolloutPath,
        pwd: '/repo',
        projectKey: '/repo',
      },
      logPath: rolloutPath,
      iterEvents: () => codexAdapter.iterEvents(rolloutPath),
    });

    expect(footprint.files).toContainEqual(
      expect.objectContaining({ pathRel: 'src/native.ts', writes: 1 }),
    );
  });

  it('marks Codex tool outputs as errors only when command end status is nonzero', async () => {
    const dir = await makeTempDir();
    const rolloutPath = join(dir, 'rollout.jsonl');
    await writeFile(
      rolloutPath,
      [
        JSON.stringify({
          timestamp: '2026-05-21T04:00:00.000Z',
          type: 'response_item',
          payload: {
            type: 'function_call',
            call_id: 'ok_call',
            name: 'exec_command',
            arguments: { cmd: 'node script.js' },
          },
        }),
        JSON.stringify({
          timestamp: '2026-05-21T04:00:01.000Z',
          type: 'event_msg',
          payload: { type: 'exec_command_end', call_id: 'ok_call', exit_code: 0 },
        }),
        JSON.stringify({
          timestamp: '2026-05-21T04:00:02.000Z',
          type: 'response_item',
          payload: {
            type: 'function_call_output',
            call_id: 'ok_call',
            output: 'throw new Error("example text")',
          },
        }),
        JSON.stringify({
          timestamp: '2026-05-21T04:00:03.000Z',
          type: 'response_item',
          payload: {
            type: 'function_call',
            call_id: 'bad_call',
            name: 'exec_command',
            arguments: { cmd: 'npm test' },
          },
        }),
        JSON.stringify({
          timestamp: '2026-05-21T04:00:04.000Z',
          type: 'event_msg',
          payload: { type: 'exec_command_end', call_id: 'bad_call', exit_code: 1 },
        }),
        JSON.stringify({
          timestamp: '2026-05-21T04:00:05.000Z',
          type: 'response_item',
          payload: {
            type: 'function_call_output',
            call_id: 'bad_call',
            output: 'AssertionError: failed',
          },
        }),
      ].join('\n'),
      'utf8',
    );

    const events = [];
    for await (const event of codexAdapter.iterEvents(rolloutPath)) events.push(event);
    const results = events.filter((event) => event.kind === 'tool_result');

    expect(results).toMatchObject([
      {
        kind: 'tool_result',
        toolCallId: 'ok_call',
        isError: false,
        text: 'throw new Error("example text")',
      },
      {
        kind: 'tool_result',
        toolCallId: 'bad_call',
        isError: true,
        text: 'AssertionError: failed',
      },
    ]);
  });

  it('emits mode_change on turn_context collaboration_mode transitions', async () => {
    const dir = await makeTempDir();
    const rolloutPath = join(dir, 'rollout.jsonl');
    await writeFile(
      rolloutPath,
      [
        JSON.stringify({
          timestamp: '2026-05-21T04:00:00.000Z',
          type: 'turn_context',
          payload: { collaboration_mode: { mode: 'plan' } },
        }),
        JSON.stringify({
          timestamp: '2026-05-21T04:00:01.000Z',
          type: 'response_item',
          payload: {
            type: 'message',
            role: 'user',
            content: [{ type: 'input_text', text: 'while in plan' }],
          },
        }),
        JSON.stringify({
          timestamp: '2026-05-21T04:00:02.000Z',
          type: 'turn_context',
          payload: { collaboration_mode: { mode: 'plan' } },
        }),
        JSON.stringify({
          timestamp: '2026-05-21T04:00:03.000Z',
          type: 'turn_context',
          payload: { collaboration_mode: { mode: 'default' } },
        }),
      ].join('\n'),
      'utf8',
    );

    const events = [];
    for await (const event of codexAdapter.iterEvents(rolloutPath)) events.push(event);
    const modeChanges = events.filter((e) => e.kind === 'mode_change');
    expect(modeChanges).toEqual([
      {
        ts: Date.parse('2026-05-21T04:00:00.000Z'),
        kind: 'mode_change',
        mode: 'plan',
        prevMode: undefined,
      },
      {
        ts: Date.parse('2026-05-21T04:00:03.000Z'),
        kind: 'mode_change',
        mode: 'default',
        prevMode: 'plan',
      },
    ]);
  });
});

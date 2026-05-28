import Database from 'better-sqlite3';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { cursorAdapter } from '../src/adapters/cursor.js';

let tempDir: string | undefined;
const originalGlobal = process.env.CURSOR_GLOBAL_DB;
const originalWs = process.env.CURSOR_WORKSPACE_STORAGE_DIR;

afterEach(async () => {
  if (originalGlobal == null) delete process.env.CURSOR_GLOBAL_DB;
  else process.env.CURSOR_GLOBAL_DB = originalGlobal;
  if (originalWs == null) delete process.env.CURSOR_WORKSPACE_STORAGE_DIR;
  else process.env.CURSOR_WORKSPACE_STORAGE_DIR = originalWs;
  if (!tempDir) return;
  await rm(tempDir, { recursive: true, force: true });
  tempDir = undefined;
});

async function makeTempDir(): Promise<string> {
  tempDir = await mkdtemp(join(tmpdir(), 'superdense-cursor-test-'));
  return tempDir;
}

function writeGlobalDb(
  path: string,
  composers: Array<{ key: string; value: unknown }>,
  bubbles: Array<{ key: string; value: unknown }>,
): void {
  const db = new Database(path);
  db.exec(`CREATE TABLE cursorDiskKV (key TEXT PRIMARY KEY, value TEXT);`);
  const stmt = db.prepare(`INSERT INTO cursorDiskKV (key, value) VALUES (?, ?)`);
  for (const row of [...composers, ...bubbles]) {
    stmt.run(row.key, JSON.stringify(row.value));
  }
  db.close();
}

async function writeWorkspace(
  storageDir: string,
  hash: string,
  folderPath: string,
  composerIds: string[],
): Promise<void> {
  const wsDir = join(storageDir, hash);
  await mkdir(wsDir, { recursive: true });
  await writeFile(
    join(wsDir, 'workspace.json'),
    JSON.stringify({ folder: pathToFileURL(folderPath).toString() }),
    'utf8',
  );
  const db = new Database(join(wsDir, 'state.vscdb'));
  db.exec(`CREATE TABLE ItemTable (key TEXT PRIMARY KEY, value TEXT);`);
  db.prepare(`INSERT INTO ItemTable (key, value) VALUES (?, ?)`).run(
    'composer.composerData',
    JSON.stringify({
      allComposers: composerIds.map((id) => ({ composerId: id })),
    }),
  );
  db.close();
}

describe('cursorAdapter', () => {
  it('discovers sessions and resolves pwd from workspaceStorage', async () => {
    const dir = await makeTempDir();
    const dbPath = join(dir, 'state.vscdb');
    const wsStorage = join(dir, 'workspaceStorage');
    await writeWorkspace(wsStorage, 'ws-abc', '/repo/proj', ['composer-1']);

    writeGlobalDb(
      dbPath,
      [
        {
          key: 'composerData:composer-1',
          value: {
            composerId: 'composer-1',
            createdAt: 1_700_000_000_000,
            name: 'Some chat',
            fullConversationHeadersOnly: [
              { bubbleId: 'b1', type: 1 },
              { bubbleId: 'b2', type: 2 },
            ],
          },
        },
      ],
      [
        {
          key: 'bubbleId:composer-1:b1',
          value: {
            bubbleId: 'b1',
            type: 1,
            text: 'Help me ship',
            createdAt: '2026-05-21T04:00:00.000Z',
          },
        },
        {
          key: 'bubbleId:composer-1:b2',
          value: {
            bubbleId: 'b2',
            type: 2,
            text: 'Sure',
            createdAt: '2026-05-21T04:00:05.000Z',
          },
        },
      ],
    );

    process.env.CURSOR_GLOBAL_DB = dbPath;
    process.env.CURSOR_WORKSPACE_STORAGE_DIR = wsStorage;

    const sessions = await cursorAdapter.discover();
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      sessionId: 'composer-1',
      pwd: '/repo/proj',
      firstPrompt: 'Help me ship',
      messageCount: 2,
      createdAt: 1_700_000_000_000,
    });
    expect(sessions[0].logPath).toBe(`${dbPath}#composer=composer-1`);
  });

  it('skips composers without a workspace mapping', async () => {
    const dir = await makeTempDir();
    const dbPath = join(dir, 'state.vscdb');
    const wsStorage = join(dir, 'workspaceStorage');
    await mkdir(wsStorage, { recursive: true });

    writeGlobalDb(
      dbPath,
      [
        {
          key: 'composerData:orphan',
          value: {
            composerId: 'orphan',
            fullConversationHeadersOnly: [{ bubbleId: 'b1', type: 1 }],
          },
        },
      ],
      [
        {
          key: 'bubbleId:orphan:b1',
          value: { bubbleId: 'b1', type: 1, text: 'hi' },
        },
      ],
    );

    process.env.CURSOR_GLOBAL_DB = dbPath;
    process.env.CURSOR_WORKSPACE_STORAGE_DIR = wsStorage;

    expect(await cursorAdapter.discover()).toEqual([]);
  });

  it('discovers local sub-agent composer links and hides children from root discovery', async () => {
    const dir = await makeTempDir();
    const dbPath = join(dir, 'state.vscdb');
    const wsStorage = join(dir, 'workspaceStorage');
    await writeWorkspace(wsStorage, 'ws-parent', '/repo/parent', ['parent']);
    await writeWorkspace(wsStorage, 'ws-child-2', '/repo/child-2', ['child-2']);

    writeGlobalDb(
      dbPath,
      [
        {
          key: 'composerData:parent',
          value: {
            composerId: 'parent',
            createdAt: 1_700_000_000_000,
            subagentComposerIds: ['child-1', 'child-1', 'missing-child'],
            subComposerIds: ['child-1', 'child-2', 42, null, ''],
            fullConversationHeadersOnly: [
              { bubbleId: 'p1', type: 1 },
              { bubbleId: 'p2', type: 2 },
            ],
          },
        },
        {
          key: 'composerData:child-1',
          value: {
            composerId: 'child-1',
            createdAt: 1_700_000_001_000,
            isBestOfNSubcomposer: true,
            isSpecSubagentDone: false,
            fullConversationHeadersOnly: [
              { bubbleId: 'c1-1', type: 1 },
              { bubbleId: 'c1-2', type: 2 },
            ],
          },
        },
        {
          key: 'composerData:child-2',
          value: {
            composerId: 'child-2',
            createdAt: 1_700_000_002_000,
            isBestOfNSubcomposer: false,
            isSpecSubagentDone: true,
            fullConversationHeadersOnly: [{ bubbleId: 'c2-1', type: 1 }],
          },
        },
      ],
      [
        {
          key: 'bubbleId:parent:p1',
          value: {
            bubbleId: 'p1',
            type: 1,
            text: 'Parent prompt',
            createdAt: '2026-05-21T04:00:00.000Z',
          },
        },
        {
          key: 'bubbleId:parent:p2',
          value: {
            bubbleId: 'p2',
            type: 2,
            text: 'Parent response',
            createdAt: '2026-05-21T04:00:10.000Z',
          },
        },
        {
          key: 'bubbleId:child-1:c1-1',
          value: {
            bubbleId: 'c1-1',
            type: 1,
            text: 'Child one prompt',
            createdAt: '2026-05-21T04:01:00.000Z',
          },
        },
        {
          key: 'bubbleId:child-1:c1-2',
          value: {
            bubbleId: 'c1-2',
            type: 2,
            text: 'Child one response',
            createdAt: '2026-05-21T04:01:10.000Z',
          },
        },
        {
          key: 'bubbleId:child-2:c2-1',
          value: {
            bubbleId: 'c2-1',
            type: 1,
            text: 'Child two prompt',
            createdAt: '2026-05-21T04:02:00.000Z',
          },
        },
      ],
    );

    process.env.CURSOR_GLOBAL_DB = dbPath;
    process.env.CURSOR_WORKSPACE_STORAGE_DIR = wsStorage;

    const roots = await cursorAdapter.discover();
    expect(roots.map((s) => s.sessionId)).toEqual(['parent']);

    const children = await cursorAdapter.discoverSubAgentSessions('parent');
    expect(children).toHaveLength(2);
    expect(children[0]).toMatchObject({
      relation: 'subagent',
      metadata: {
        cursorRelation: 'subagentComposerIds',
        isBestOfNSubcomposer: true,
        isSpecSubagentDone: false,
      },
      session: {
        sessionId: 'child-1',
        pwd: '/repo/parent',
        firstPrompt: 'Child one prompt',
        messageCount: 2,
        modifiedAt: Date.parse('2026-05-21T04:01:10.000Z'),
      },
    });
    expect(children[1]).toMatchObject({
      relation: 'subagent',
      metadata: {
        cursorRelation: 'subComposerIds',
        isBestOfNSubcomposer: false,
        isSpecSubagentDone: true,
      },
      session: {
        sessionId: 'child-2',
        pwd: '/repo/child-2',
        firstPrompt: 'Child two prompt',
        messageCount: 1,
      },
    });
  });

  it('returns no Cursor sub-agents for empty or malformed child-link fields', async () => {
    const dir = await makeTempDir();
    const dbPath = join(dir, 'state.vscdb');
    const wsStorage = join(dir, 'workspaceStorage');
    await writeWorkspace(wsStorage, 'ws-parent', '/repo/parent', ['parent']);

    writeGlobalDb(
      dbPath,
      [
        {
          key: 'composerData:parent',
          value: {
            composerId: 'parent',
            subagentComposerIds: 'child-1',
            subComposerIds: [null, 42, '', 'parent'],
            fullConversationHeadersOnly: [{ bubbleId: 'p1', type: 1 }],
          },
        },
      ],
      [
        {
          key: 'bubbleId:parent:p1',
          value: { bubbleId: 'p1', type: 1, text: 'Parent prompt' },
        },
      ],
    );

    process.env.CURSOR_GLOBAL_DB = dbPath;
    process.env.CURSOR_WORKSPACE_STORAGE_DIR = wsStorage;

    expect(await cursorAdapter.discover()).toHaveLength(1);
    expect(await cursorAdapter.discoverSubAgentSessions('parent')).toEqual([]);
  });

  it('normalizes user text, assistant text, and tool call+result from one bubble', async () => {
    const dir = await makeTempDir();
    const dbPath = join(dir, 'state.vscdb');
    const wsStorage = join(dir, 'workspaceStorage');
    await writeWorkspace(wsStorage, 'ws-1', '/repo', ['c1']);

    writeGlobalDb(
      dbPath,
      [
        {
          key: 'composerData:c1',
          value: {
            composerId: 'c1',
            fullConversationHeadersOnly: [
              { bubbleId: 'b1', type: 1 },
              { bubbleId: 'b2', type: 2 },
              { bubbleId: 'b3', type: 2 },
              { bubbleId: 'b4', type: 2 },
            ],
          },
        },
      ],
      [
        {
          key: 'bubbleId:c1:b1',
          value: {
            bubbleId: 'b1',
            type: 1,
            text: 'Run tests',
            createdAt: '2026-05-21T04:00:00.000Z',
          },
        },
        {
          key: 'bubbleId:c1:b2',
          value: {
            bubbleId: 'b2',
            type: 2,
            text: 'I will run them.',
            createdAt: '2026-05-21T04:00:01.000Z',
          },
        },
        {
          key: 'bubbleId:c1:b3',
          value: {
            bubbleId: 'b3',
            type: 2,
            createdAt: '2026-05-21T04:00:02.000Z',
            toolFormerData: {
              toolCallId: 'toolu_ok',
              name: 'run_terminal_cmd',
              status: 'completed',
              rawArgs: '{"cmd":"pnpm test"}',
              result: 'all good',
            },
          },
        },
        {
          key: 'bubbleId:c1:b4',
          value: {
            bubbleId: 'b4',
            type: 2,
            createdAt: '2026-05-21T04:00:03.000Z',
            toolFormerData: {
              toolCallId: 'toolu_bad',
              name: 'run_terminal_cmd',
              status: 'error',
              rawArgs: '{"cmd":"false"}',
              result: 'exit 1',
            },
          },
        },
      ],
    );

    process.env.CURSOR_GLOBAL_DB = dbPath;
    process.env.CURSOR_WORKSPACE_STORAGE_DIR = wsStorage;

    const events = [];
    for await (const ev of cursorAdapter.iterEvents(`${dbPath}#composer=c1`)) events.push(ev);

    expect(events).toMatchObject([
      { kind: 'text', role: 'user', text: 'Run tests' },
      { kind: 'text', role: 'assistant', text: 'I will run them.' },
      {
        kind: 'tool_call',
        role: 'assistant',
        toolCallId: 'toolu_ok',
        toolName: 'run_terminal_cmd',
        inputText: '{"cmd":"pnpm test"}',
      },
      {
        kind: 'tool_result',
        role: 'user',
        toolCallId: 'toolu_ok',
        isError: false,
        text: 'all good',
      },
      {
        kind: 'tool_call',
        role: 'assistant',
        toolCallId: 'toolu_bad',
        toolName: 'run_terminal_cmd',
        inputText: '{"cmd":"false"}',
      },
      {
        kind: 'tool_result',
        role: 'user',
        toolCallId: 'toolu_bad',
        isError: true,
        text: 'exit 1',
      },
    ]);
  });

  it('emits plan-boundary transitions only; assistants inherit the user-set mode', async () => {
    const dir = await makeTempDir();
    const dbPath = join(dir, 'state.vscdb');
    const wsStorage = join(dir, 'workspaceStorage');
    await writeWorkspace(wsStorage, 'ws-2', '/repo', ['cp']);

    // Mirrors a real Cursor sequence: user toggles plan on, assistant replies
    // (its own bubble has unifiedMode=2 even though the response is in-plan),
    // user stays in plan for another turn, user toggles plan off, then
    // assistant runs an isPlanExecution turn.
    writeGlobalDb(
      dbPath,
      [
        {
          key: 'composerData:cp',
          value: {
            composerId: 'cp',
            fullConversationHeadersOnly: [
              { bubbleId: 'b1', type: 1 },
              { bubbleId: 'b2', type: 2 },
              { bubbleId: 'b3', type: 1 },
              { bubbleId: 'b4', type: 2 },
              { bubbleId: 'b5', type: 1 },
              { bubbleId: 'b6', type: 2 },
              { bubbleId: 'b7', type: 1 },
              { bubbleId: 'b8', type: 2 },
            ],
          },
        },
      ],
      [
        // Pre-plan exchange (no emissions — default/chat noise suppressed).
        {
          key: 'bubbleId:cp:b1',
          value: {
            bubbleId: 'b1',
            type: 1,
            text: 'start in agent',
            unifiedMode: 2,
            createdAt: '2026-05-21T04:00:00.000Z',
          },
        },
        {
          key: 'bubbleId:cp:b2',
          value: {
            bubbleId: 'b2',
            type: 2,
            text: 'sure',
            unifiedMode: 2,
            createdAt: '2026-05-21T04:00:01.000Z',
          },
        },
        // User enters plan mode — transition emitted at THIS user bubble.
        {
          key: 'bubbleId:cp:b3',
          value: {
            bubbleId: 'b3',
            type: 1,
            text: 'lets plan',
            unifiedMode: 5,
            createdAt: '2026-05-21T04:00:02.000Z',
          },
        },
        // Assistant's bubble (unifiedMode=2 like always) must inherit plan, NOT exit.
        {
          key: 'bubbleId:cp:b4',
          value: {
            bubbleId: 'b4',
            type: 2,
            text: 'here is the plan',
            unifiedMode: 2,
            createdAt: '2026-05-21T04:00:03.000Z',
          },
        },
        // Another in-plan user turn — no transition.
        {
          key: 'bubbleId:cp:b5',
          value: {
            bubbleId: 'b5',
            type: 1,
            text: 'tweak it',
            unifiedMode: 5,
            createdAt: '2026-05-21T04:00:04.000Z',
          },
        },
        {
          key: 'bubbleId:cp:b6',
          value: {
            bubbleId: 'b6',
            type: 2,
            text: 'updated plan',
            unifiedMode: 2,
            createdAt: '2026-05-21T04:00:05.000Z',
          },
        },
        // User toggles back — exit emitted at this user bubble.
        {
          key: 'bubbleId:cp:b7',
          value: {
            bubbleId: 'b7',
            type: 1,
            text: 'go ahead',
            unifiedMode: 2,
            createdAt: '2026-05-21T04:00:06.000Z',
          },
        },
        // Subsequent assistant inherits default; isPlanExecution stays default (no extra emit).
        {
          key: 'bubbleId:cp:b8',
          value: {
            bubbleId: 'b8',
            type: 2,
            text: 'executing',
            unifiedMode: 2,
            isPlanExecution: true,
            createdAt: '2026-05-21T04:00:07.000Z',
          },
        },
      ],
    );

    process.env.CURSOR_GLOBAL_DB = dbPath;
    process.env.CURSOR_WORKSPACE_STORAGE_DIR = wsStorage;

    const events = [];
    for await (const ev of cursorAdapter.iterEvents(`${dbPath}#composer=cp`)) events.push(ev);
    const modeChanges = events.filter((e) => e.kind === 'mode_change');

    expect(modeChanges).toEqual([
      {
        ts: Date.parse('2026-05-21T04:00:02.000Z'),
        kind: 'mode_change',
        mode: 'plan',
        prevMode: 'default',
      },
      {
        ts: Date.parse('2026-05-21T04:00:06.000Z'),
        kind: 'mode_change',
        mode: 'default',
        prevMode: 'plan',
      },
    ]);
  });

  it('does not emit any mode_change for a session that never enters plan mode', async () => {
    const dir = await makeTempDir();
    const dbPath = join(dir, 'state.vscdb');
    const wsStorage = join(dir, 'workspaceStorage');
    await writeWorkspace(wsStorage, 'ws-3', '/repo', ['cp']);

    writeGlobalDb(
      dbPath,
      [
        {
          key: 'composerData:cp',
          value: {
            composerId: 'cp',
            fullConversationHeadersOnly: [
              { bubbleId: 'b1', type: 1 },
              { bubbleId: 'b2', type: 2 },
              { bubbleId: 'b3', type: 1 },
            ],
          },
        },
      ],
      [
        {
          key: 'bubbleId:cp:b1',
          value: {
            bubbleId: 'b1',
            type: 1,
            text: 'hi',
            unifiedMode: 1,
            createdAt: '2026-05-21T04:00:00.000Z',
          },
        },
        {
          key: 'bubbleId:cp:b2',
          value: {
            bubbleId: 'b2',
            type: 2,
            text: 'hello',
            unifiedMode: 2,
            createdAt: '2026-05-21T04:00:01.000Z',
          },
        },
        {
          key: 'bubbleId:cp:b3',
          value: {
            bubbleId: 'b3',
            type: 1,
            text: 'do it',
            unifiedMode: 2,
            createdAt: '2026-05-21T04:00:02.000Z',
          },
        },
      ],
    );

    process.env.CURSOR_GLOBAL_DB = dbPath;
    process.env.CURSOR_WORKSPACE_STORAGE_DIR = wsStorage;

    const events = [];
    for await (const ev of cursorAdapter.iterEvents(`${dbPath}#composer=cp`)) events.push(ev);
    expect(events.filter((e) => e.kind === 'mode_change')).toEqual([]);
  });
});

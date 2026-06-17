import { execFile } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const scriptPath = new URL('../../../skills/chain/chain-sessions.sh', import.meta.url);
const tempRoots: string[] = [];

interface FakeSession {
  id: string;
  firstPrompt: string;
  modifiedAt?: number;
}

function session(overrides: FakeSession): FakeSession {
  return {
    modifiedAt: 1,
    ...overrides,
  };
}

async function runChain(opts: {
  firstItems: FakeSession[];
  afterIndexItems?: FakeSession[];
  env?: Record<string, string | undefined>;
  indexBehavior?: 'success' | 'fail' | 'hang';
  listBehavior?: 'success' | 'fail' | 'hang';
}): Promise<{ stdout: string; callLog: string }> {
  const root = mkdtempSync(join(tmpdir(), 'superdense-chain-'));
  tempRoots.push(root);
  const binDir = join(root, 'bin');
  const workspace = join(root, 'workspace');
  mkdirSync(binDir);
  mkdirSync(workspace);

  const indexedMarker = join(root, 'indexed');
  const callLog = join(root, 'calls.log');
  const fakeSuperdense = join(binDir, 'superdense');
  writeFileSync(
    fakeSuperdense,
    `#!/bin/bash
set -euo pipefail
echo "$*" >> "$FAKE_CALL_LOG"
if [ "$1" = "index" ]; then
  case "$FAKE_INDEX_BEHAVIOR" in
    success)
      touch "$FAKE_INDEXED_MARKER"
      exit 0
      ;;
    fail)
      exit 42
      ;;
    hang)
      sleep 30
      exit 0
      ;;
  esac
fi
if [ "$1" = "session" ] && [ "$2" = "list" ]; then
  case "$FAKE_LIST_BEHAVIOR" in
    fail)
      exit 43
      ;;
    hang)
      sleep 30
      exit 0
      ;;
  esac
  if [ -f "$FAKE_INDEXED_MARKER" ] && [ -n "\${FAKE_AFTER_INDEX_JSON:-}" ]; then
    printf '%s\\n' "$FAKE_AFTER_INDEX_JSON"
  else
    printf '%s\\n' "$FAKE_FIRST_JSON"
  fi
  exit 0
fi
exit 1
`,
  );
  chmodSync(fakeSuperdense, 0o755);

  const { stdout } = await execFileAsync('bash', [scriptPath.pathname], {
    cwd: workspace,
    env: {
      ...process.env,
      PATH: `${binDir}:${process.env.PATH ?? ''}`,
      FAKE_CALL_LOG: callLog,
      FAKE_INDEXED_MARKER: indexedMarker,
      FAKE_INDEX_BEHAVIOR: opts.indexBehavior ?? 'success',
      FAKE_LIST_BEHAVIOR: opts.listBehavior ?? 'success',
      FAKE_FIRST_JSON: JSON.stringify({ items: opts.firstItems, total: opts.firstItems.length }),
      FAKE_AFTER_INDEX_JSON:
        opts.afterIndexItems == null
          ? undefined
          : JSON.stringify({ items: opts.afterIndexItems, total: opts.afterIndexItems.length }),
      SUPERDENSE_CHAIN_INDEX_TIMEOUT_SECONDS: '1',
      SUPERDENSE_CHAIN_LIST_TIMEOUT_SECONDS: '1',
      ...opts.env,
    },
    timeout: 6000,
  });

  return { stdout, callLog: readFileSync(callLog, 'utf8') };
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('chain-sessions.sh', () => {
  it('excludes the current Codex session from the env', async () => {
    const { stdout } = await runChain({
      firstItems: [
        session({
          id: 'codex:self',
          firstPrompt: '/chain found any sessions ?',
        }),
        session({ id: 'codex:old', firstPrompt: 'Fix the dashboard' }),
      ],
      env: {
        CODEX_THREAD_ID: 'self',
      },
    });

    expect(stdout).toContain('(most recent) session #1 : codex:old');
    expect(stdout).toContain('superdense compactor run salience codex:old');
    expect(stdout).not.toContain('codex:self');
  });

  it('excludes Claude Code local and remote current sessions', async () => {
    const { stdout } = await runChain({
      firstItems: [
        session({ id: 'claude-code:local', firstPrompt: 'Current local session' }),
        session({ id: 'claude-code:remote', firstPrompt: 'Current remote session' }),
      ],
      env: {
        CLAUDE_CODE_SESSION_ID: 'local',
        CLAUDE_CODE_REMOTE_SESSION_ID: 'remote',
      },
    });

    expect(stdout).toContain('No sessions found for workspace:');
    expect(stdout).not.toContain('claude-code:local');
    expect(stdout).not.toContain('claude-code:remote');
  });

  it('excludes explicit extra session ids from the env', async () => {
    const { stdout } = await runChain({
      firstItems: [
        session({ id: 'codex:skip-a', firstPrompt: 'Skipped session A' }),
        session({ id: 'codex:keep', firstPrompt: 'Keep session' }),
        session({ id: 'codex:skip-b', firstPrompt: 'Skipped session B' }),
      ],
      env: {
        SUPERDENSE_EXCLUDE_SESSION_IDS: 'codex:skip-a,codex:skip-b',
      },
    });

    expect(stdout).toContain('(most recent) session #1 : codex:keep');
    expect(stdout).not.toContain('codex:skip-a');
    expect(stdout).not.toContain('codex:skip-b');
  });

  it('prints at most three sessions', async () => {
    const { stdout } = await runChain({
      firstItems: [
        session({ id: 'codex:one', firstPrompt: 'One' }),
        session({ id: 'codex:two', firstPrompt: 'Two' }),
        session({ id: 'codex:three', firstPrompt: 'Three' }),
        session({ id: 'codex:four', firstPrompt: 'Four' }),
      ],
    });

    expect(stdout).toContain('(most recent) session #1 : codex:one');
    expect(stdout).toContain('session #2 : codex:two');
    expect(stdout).toContain('session #3 : codex:three');
    expect(stdout).not.toContain('codex:four');
  });

  it('indexes once before filtering when only excluded current sessions exist', async () => {
    const { stdout, callLog } = await runChain({
      firstItems: [session({ id: 'codex:self', firstPrompt: '/chain found any sessions ?' })],
      env: {
        CODEX_THREAD_ID: 'self',
      },
    });

    expect(callLog.match(/^index$/gm)).toHaveLength(1);
    expect(stdout).toContain('No sessions found for workspace:');
    expect(stdout).not.toContain('codex:self');
  });

  it('filters sessions after the upfront index', async () => {
    const { stdout, callLog } = await runChain({
      firstItems: [],
      afterIndexItems: [
        session({ id: 'codex:self', firstPrompt: '/chain found any sessions ?' }),
        session({ id: 'codex:prior', firstPrompt: 'Prior implementation session' }),
      ],
      env: {
        CODEX_THREAD_ID: 'self',
      },
    });

    expect(callLog.match(/^index$/gm)).toHaveLength(1);
    expect(stdout).toContain('(most recent) session #1 : codex:prior');
    expect(stdout).not.toContain('codex:self');
  });

  it('attempts index before listing sessions', async () => {
    const { callLog } = await runChain({
      firstItems: [session({ id: 'codex:old', firstPrompt: 'Fix the dashboard' })],
    });

    expect(callLog.trim().split('\n').slice(0, 2)).toEqual([
      'index',
      expect.stringMatching(/^session list --pwd .* --limit 25$/),
    ]);
  });

  it('fails open when index fails after still attempting to list sessions', async () => {
    const { stdout, callLog } = await runChain({
      firstItems: [session({ id: 'codex:old', firstPrompt: 'Fix the dashboard' })],
      indexBehavior: 'fail',
    });

    expect(callLog).toContain('index\n');
    expect(callLog).toMatch(/session list --pwd .* --limit 25/);
    expect(stdout).toContain('<past_sessions>');
    expect(stdout).toContain('Session context unavailable for workspace:');
    expect(stdout).toContain('(index/list blocked, timed out, or sandboxed)');
    expect(stdout).toContain('</past_sessions>');
    expect(stdout).not.toContain('codex:old');
  });

  it('fails open when index hangs', async () => {
    const { stdout, callLog } = await runChain({
      firstItems: [session({ id: 'codex:old', firstPrompt: 'Fix the dashboard' })],
      indexBehavior: 'hang',
    });

    expect(callLog).toContain('index\n');
    expect(callLog).toMatch(/session list --pwd .* --limit 25/);
    expect(stdout).toContain('Session context unavailable for workspace:');
    expect(stdout).toContain('</past_sessions>');
  });

  it('fails open when listing fails', async () => {
    const { stdout, callLog } = await runChain({
      firstItems: [session({ id: 'codex:old', firstPrompt: 'Fix the dashboard' })],
      listBehavior: 'fail',
    });

    expect(callLog).toMatch(/session list --pwd .* --limit 25/);
    expect(stdout).toContain('Session context unavailable for workspace:');
    expect(stdout).toContain('</past_sessions>');
  });

  it('fails open when listing hangs', async () => {
    const { stdout, callLog } = await runChain({
      firstItems: [session({ id: 'codex:old', firstPrompt: 'Fix the dashboard' })],
      listBehavior: 'hang',
    });

    expect(callLog).toMatch(/session list --pwd .* --limit 25/);
    expect(stdout).toContain('Session context unavailable for workspace:');
    expect(stdout).toContain('</past_sessions>');
  });
});

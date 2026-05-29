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
  touch "$FAKE_INDEXED_MARKER"
  exit 0
fi
if [ "$1" = "session" ] && [ "$2" = "list" ]; then
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
      FAKE_FIRST_JSON: JSON.stringify({ items: opts.firstItems, total: opts.firstItems.length }),
      FAKE_AFTER_INDEX_JSON:
        opts.afterIndexItems == null
          ? undefined
          : JSON.stringify({ items: opts.afterIndexItems, total: opts.afterIndexItems.length }),
      ...opts.env,
    },
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
});

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { claudeCodeAdapter, decodeProjectDir, scanJsonlHead } from '../claude-code.js';

const ORIGINAL_PROJECTS_DIR = process.env.CLAUDE_PROJECTS_DIR;
let tmpRoot: string;

async function writeTranscript(projectDirName: string, sessionId: string, lines: object[]): Promise<string> {
  const projectDir = join(tmpRoot, projectDirName);
  await mkdir(projectDir, { recursive: true });
  const logPath = join(projectDir, `${sessionId}.jsonl`);
  await writeFile(logPath, lines.map((l) => JSON.stringify(l)).join('\n') + '\n', 'utf8');
  return logPath;
}

beforeEach(async () => {
  tmpRoot = await mkdtemp(join(tmpdir(), 'claude-projects-'));
  process.env.CLAUDE_PROJECTS_DIR = tmpRoot;
});

afterEach(async () => {
  if (ORIGINAL_PROJECTS_DIR === undefined) delete process.env.CLAUDE_PROJECTS_DIR;
  else process.env.CLAUDE_PROJECTS_DIR = ORIGINAL_PROJECTS_DIR;
  await rm(tmpRoot, { recursive: true, force: true });
});

describe('claudeCodeAdapter.discover (cwd extraction)', () => {
  it('prefers the JSONL cwd over the lossy directory-name decoding', async () => {
    await writeTranscript('-Users-foo-codebase-nr-context-frontend', 's1', [
      { type: 'system', cwd: '/Users/foo/codebase-nr/context-frontend' },
      { type: 'user', message: { role: 'user', content: 'hello' } },
    ]);
const found = await claudeCodeAdapter.discover();
    expect(found).toHaveLength(1);
    expect(found[0].pwd).toBe('/Users/foo/codebase-nr/context-frontend');
    expect(found[0].firstPrompt).toBe('hello');
  });

  it('preserves multiple dashed path segments verbatim', async () => {
    await writeTranscript('-a-b-c-d-e-f', 's1', [
      { type: 'system', cwd: '/a/b-c/d-e-f' },
    ]);
const [session] = await claudeCodeAdapter.discover();
    expect(session.pwd).toBe('/a/b-c/d-e-f');
  });

  it('falls back to decodeProjectDir when no cwd field is present', async () => {
    await writeTranscript('-tmp-noslash', 's1', [
      { type: 'user', message: { role: 'user', content: 'hi' } },
    ]);
const [session] = await claudeCodeAdapter.discover();
    expect(session.pwd).toBe('/tmp/noslash');
  });

  it('extracts cwd and firstPrompt in a single scan', async () => {
    const logPath = await writeTranscript('-Users-x-proj', 's1', [
      { type: 'system', cwd: '/Users/x/proj' },
      { type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'first ask' }] } },
    ]);
    const head = await scanJsonlHead(logPath);
    expect(head.cwd).toBe('/Users/x/proj');
    expect(head.firstPrompt).toBe('first ask');
  });

  it('decodeProjectDir is lossy on dashed segments (documents the original bug)', () => {
    expect(decodeProjectDir('-Users-foo-codebase-nr-context-frontend'))
      .toBe('/Users/foo/codebase/nr/context/frontend');
  });
});

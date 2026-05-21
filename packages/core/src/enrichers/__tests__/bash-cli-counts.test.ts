import { describe, it, expect } from 'vitest';
import { clisFromCommand, bashCliCountsEnricher } from '../bash-cli-counts.js';
import type { TranscriptEvent } from '../../types.js';

describe('clisFromCommand', () => {
  it('extracts a simple command', () => {
    expect(clisFromCommand('git status')).toEqual(['git']);
  });

  it('strips sudo', () => {
    expect(clisFromCommand('sudo apt-get install foo')).toEqual(['apt-get']);
  });

  it('strips leading env assignments', () => {
    expect(clisFromCommand('FOO=bar BAZ=qux npm test')).toEqual(['npm']);
  });

  it('strips env command form', () => {
    expect(clisFromCommand('env DEBUG=1 node script.js')).toEqual(['node']);
  });

  it('takes basename of absolute paths', () => {
    expect(clisFromCommand('/usr/local/bin/gh pr list')).toEqual(['gh']);
  });

  it('drops builtins like cd and echo', () => {
    expect(clisFromCommand('cd /tmp')).toEqual([]);
    expect(clisFromCommand('echo hello')).toEqual([]);
  });

  it('splits on ;, &&, ||, |', () => {
    const out = clisFromCommand('git pull && npm test || echo fail');
    expect(out).toEqual(['git', 'npm']);
  });

  it('splits on pipe', () => {
    expect(clisFromCommand('cat file | jq .foo | head')).toEqual(['cat', 'jq', 'head']);
  });

  it('ignores cd at the head of a chain', () => {
    expect(clisFromCommand('cd /foo && git status')).toEqual(['git']);
  });

  it('does not split inside quotes', () => {
    // Single quoted argument containing && should not split.
    expect(clisFromCommand("gh issue list --search 'foo && bar'")).toEqual(['gh']);
  });
});

describe('bashCliCountsEnricher', () => {
  it('counts CLIs across Bash tool events', async () => {
    const events: TranscriptEvent[] = [
      { toolName: 'Bash', inputText: JSON.stringify({ command: 'git status' }) },
      { toolName: 'Bash', inputText: JSON.stringify({ command: 'git diff' }) },
      { toolName: 'Bash', inputText: JSON.stringify({ command: 'gh pr list' }) },
      { toolName: 'Read', inputText: JSON.stringify({ path: '/x' }) },
    ];
    const result = await bashCliCountsEnricher.run({
      session: {} as never,
      logPath: '/tmp/x',
      iterEvents: async function* () { for (const e of events) yield e; },
    });
    expect(result).toEqual({ git: 2, gh: 1 });
  });

  it('handles raw command strings (non-JSON inputText)', async () => {
    const events: TranscriptEvent[] = [
      { toolName: 'Bash', inputText: 'npm install' },
    ];
    const result = await bashCliCountsEnricher.run({
      session: {} as never,
      logPath: '/tmp/x',
      iterEvents: async function* () { for (const e of events) yield e; },
    });
    expect(result).toEqual({ npm: 1 });
  });
});

import { describe, expect, it } from 'vitest';
import { compactSession, getCompactor, listCompactors, registerCompactor } from '../index.js';
import type { Compactor } from '../types.js';
import type { Session } from '../../types.js';

const baseSession: Session = {
  id: 's1',
  agent: 'missing-adapter',
  sessionId: 'abc',
  logPath: '/tmp/abc.jsonl',
  pwd: '/home/user',
  projectKey: '/home/user',
};

describe('compactor registry', () => {
  it('lists built-in compactors', () => {
    expect(listCompactors().map((c) => c.name)).toEqual(
      expect.arrayContaining(['trace', 'salience']),
    );
    expect(getCompactor('trace')?.kind).toBe('structural');
    expect(getCompactor('salience')?.kind).toBe('semantic');
  });

  it('rejects name collisions', () => {
    expect(() =>
      registerCompactor({
        name: 'trace',
        kind: 'structural',
        async run() {
          return {};
        },
      }),
    ).toThrow('compactor name collision');
  });

  it('runs a registered compactor through compactSession without caching', async () => {
    const compactor: Compactor<{ id: string; logPath: string }> = {
      name: 'test_registry_compactor',
      kind: 'structural',
      async run(ctx) {
        return { id: ctx.session.id, logPath: ctx.logPath };
      },
    };
    registerCompactor(compactor);

    await expect(compactSession('test_registry_compactor', baseSession)).resolves.toEqual({
      id: 's1',
      logPath: '/tmp/abc.jsonl',
    });
  });

  it('throws for unknown compactors', async () => {
    await expect(compactSession('missing', baseSession)).rejects.toThrow('unknown compactor');
  });
});

import { describe, expect, it } from 'vitest';
import { sessionFilter } from '../session.js';
import type { FilterContext } from '../types.js';

function makeCtx(projectKey: string): FilterContext {
  return {
    session: {
      id: 's1',
      agent: 'codex',
      sessionId: 's1',
      logPath: '/tmp/x',
      pwd: '/repo',
      projectKey,
    },
    logPath: '/tmp/x',
    iterEvents: async function* () {},
    getSystemEnrichment: () => null,
  };
}

describe('sessionFilter project params', () => {
  it('matches an exact project key', async () => {
    const ctx = makeCtx('/Users/me/projects/superdense');
    expect(await sessionFilter.run(ctx, { project: '/Users/me/projects/superdense' })).toBe(true);
    expect(await sessionFilter.run(ctx, { project: '/Users/me/projects/other' })).toBe(false);
  });

  it('matches a substring on projectContains', async () => {
    const ctx = makeCtx('/Users/me/projects/superdense');
    expect(await sessionFilter.run(ctx, { projectContains: 'superdense' })).toBe(true);
    expect(await sessionFilter.run(ctx, { projectContains: 'nope' })).toBe(false);
  });
});

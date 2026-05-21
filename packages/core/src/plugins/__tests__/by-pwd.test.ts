import { describe, expect, it } from 'vitest';
import { byPwdAndTool } from '../by-pwd-and-tool.js';
import { byPwd } from '../by-pwd.js';
import type { Session } from '../../types.js';

const baseSession: Session = {
  id: 's1',
  agent: 'claude-code',
  sessionId: 'abc',
  logPath: '/tmp/abc.jsonl',
  pwd: '/Users/x/conductor/workspaces/road42/provo-v1/packages/core',
  projectKey: '/Users/x/conductor/workspaces/road42',
};

describe('pwd plugins', () => {
  it('matches sibling Conductor workspaces for by-pwd', () => {
    expect(byPwd.prefilter?.(baseSession, {
      pwd: '/Users/x/conductor/workspaces/road42/provo-v2',
    })).toBe(true);
  });

  it('does not match different Conductor projects for by-pwd', () => {
    expect(byPwd.prefilter?.(baseSession, {
      pwd: '/Users/x/conductor/workspaces/other/provo-v1',
    })).toBe(false);
  });

  it('keeps exact path behavior for non-Conductor paths', () => {
    const session: Session = {
      ...baseSession,
      pwd: '/Users/x/code/foo',
      projectKey: '/Users/x/code/foo',
    };

    expect(byPwd.prefilter?.(session, { pwd: '/Users/x/code/foo' })).toBe(true);
    expect(byPwd.prefilter?.(session, { pwd: '/Users/x/code/foo/subdir' })).toBe(false);
  });

  it('uses the same project prefilter for by-pwd-and-tool', () => {
    expect(byPwdAndTool.prefilter?.(baseSession, {
      pwd: '/Users/x/conductor/workspaces/road42/provo-v2',
      keyword: 'apply_patch',
    })).toBe(true);
  });
});

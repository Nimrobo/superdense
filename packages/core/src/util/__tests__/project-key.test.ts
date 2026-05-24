import { describe, expect, it } from 'vitest';
import { resolveProjectKey } from '../project-key.js';

describe('resolveProjectKey', () => {
  it('strips the workspace from a Conductor workspace root', () => {
    expect(resolveProjectKey('/Users/x/conductor/workspaces/superdense/provo-v1'))
      .toBe('/Users/x/conductor/workspaces/superdense');
  });

  it('strips the workspace and nested path from a Conductor subdirectory', () => {
    expect(resolveProjectKey('/Users/x/conductor/workspaces/superdense/provo-v1/packages/core'))
      .toBe('/Users/x/conductor/workspaces/superdense');
  });

  it('leaves non-Conductor paths unchanged', () => {
    expect(resolveProjectKey('/Users/x/code/foo')).toBe('/Users/x/code/foo');
  });

  it('leaves an empty path unchanged', () => {
    expect(resolveProjectKey('')).toBe('');
  });
});

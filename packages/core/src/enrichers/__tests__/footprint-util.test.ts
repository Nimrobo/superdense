import { describe, it, expect } from 'vitest';
import { classifyRole, resolveFilePath, writePathsFromShell } from '../footprint-util.js';

const PWD = '/home/user/project';

describe('resolveFilePath', () => {
  it('relativizes an absolute in-pwd path', () => {
    expect(resolveFilePath('/home/user/project/src/db.ts', PWD)).toEqual({
      pathAbs: '/home/user/project/src/db.ts',
      pathRel: 'src/db.ts',
    });
  });

  it('collapses worktree copies to the same rel path', () => {
    const a = resolveFilePath(
      '/cdr/workspaces/superdense/las-vegas/src/a.ts',
      '/cdr/workspaces/superdense/las-vegas',
    );
    const b = resolveFilePath(
      '/cdr/workspaces/superdense/casablanca/src/a.ts',
      '/cdr/workspaces/superdense/casablanca',
    );
    expect(a.pathRel).toBe('src/a.ts');
    expect(b.pathRel).toBe('src/a.ts');
  });

  it('keeps an out-of-pwd path absolute', () => {
    const r = resolveFilePath('/etc/hosts', PWD);
    expect(r.pathRel).toBe('/etc/hosts');
  });

  it('resolves a relative path against pwd', () => {
    expect(resolveFilePath('./src/x.ts', PWD)).toEqual({
      pathAbs: '/home/user/project/src/x.ts',
      pathRel: 'src/x.ts',
    });
  });
});

describe('classifyRole', () => {
  const r = (raw: string) => {
    const { pathAbs, pathRel } = resolveFilePath(raw, PWD);
    return classifyRole(pathAbs, pathRel, PWD);
  };

  it('deliverable for an in-pwd source file', () => {
    expect(r('/home/user/project/src/db.ts')).toBe('deliverable');
  });

  it('generated for junk subtrees', () => {
    expect(r('/home/user/project/node_modules/x/index.js')).toBe('generated');
    expect(r('/home/user/project/dist/index.js')).toBe('generated');
  });

  it('scaffold for ~/.claude plumbing', () => {
    expect(r('/home/user/.claude/plans/foo.md')).toBe('scaffold');
  });

  it('external for out-of-pwd paths', () => {
    expect(r('/etc/hosts')).toBe('external');
  });
});

describe('writePathsFromShell', () => {
  it('extracts apply_patch hunk targets', () => {
    const cmd = `apply_patch <<'EOF'
*** Begin Patch
*** Add File: src/new.ts
+console.log(1)
*** Update File: src/old.ts
*** End Patch
EOF`;
    expect(writePathsFromShell(cmd).sort()).toEqual(['src/new.ts', 'src/old.ts']);
  });

  it('extracts redirect targets', () => {
    expect(writePathsFromShell('echo hi > out.txt')).toEqual(['out.txt']);
    expect(writePathsFromShell('cat a >> log.txt')).toEqual(['log.txt']);
  });

  it('ignores /dev/null and fd dups', () => {
    expect(writePathsFromShell('cmd > /dev/null 2>&1')).toEqual([]);
  });

  it('ignores /dev/null even with trailing quotes/parens', () => {
    expect(writePathsFromShell('(find . 2>/dev/null) > "/dev/null"')).toEqual([]);
    expect(writePathsFromShell('x >/dev/null)')).toEqual([]);
  });

  it('drops paths with unexpanded shell variables', () => {
    expect(writePathsFromShell('echo x > "$work/show.json"')).toEqual([]);
  });

  it('strips trailing punctuation from real targets', () => {
    expect(writePathsFromShell('(echo x > out.json)')).toEqual(['out.json']);
  });

  it('extracts tee targets', () => {
    expect(writePathsFromShell('echo x | tee -a build.log')).toEqual(['build.log']);
  });
});

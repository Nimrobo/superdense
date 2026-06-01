import { isAbsolute, join, normalize } from 'node:path';

/** Structured tools whose file_path the agent wrote to. */
export const WRITE_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
/** Structured tools that read a single file. */
export const READ_TOOLS = new Set(['Read', 'NotebookRead']);

/** Generated/throwaway subtrees that should never count as deliverables — IDF for
 *  source files: ubiquitous generated paths carry no artifact identity. */
const GENERATED_SEGMENTS = new Set([
  'node_modules',
  'dist',
  'build',
  'out',
  '.next',
  '.turbo',
  'coverage',
  '.afa_workspaces',
  'workspace',
]);

export type FileRole = 'deliverable' | 'generated' | 'scaffold' | 'external';

/**
 * Resolve a raw tool path against the session's pwd into {pathAbs, pathRel}.
 * Relativizing to pwd is what collapses the same file edited across parallel
 * Conductor worktrees into one identity (Finding 3).
 */
export function resolveFilePath(raw: string, pwd: string): { pathAbs: string; pathRel: string } {
  const cleanPwd = pwd ? normalize(pwd).replace(/\/+$/, '') : '';
  if (isAbsolute(raw)) {
    const abs = normalize(raw);
    if (cleanPwd && (abs === cleanPwd || abs.startsWith(cleanPwd + '/'))) {
      const rel = abs.slice(cleanPwd.length).replace(/^\/+/, '');
      return { pathAbs: abs, pathRel: rel || '.' };
    }
    return { pathAbs: abs, pathRel: abs }; // outside pwd → external; rel stays absolute
  }
  // Already relative — interpret against pwd.
  const rel = normalize(raw).replace(/^\.\//, '');
  const abs = cleanPwd ? normalize(join(cleanPwd, rel)) : rel;
  return { pathAbs: abs, pathRel: rel };
}

/**
 * Classify a path's role. Order matters: scaffold (agent plumbing under
 * ~/.claude) → external (outside pwd) → generated (junk subtree) → deliverable.
 */
export function classifyRole(pathAbs: string, pathRel: string, pwd: string): FileRole {
  if (/(^|\/)\.claude\//.test(pathAbs)) return 'scaffold';
  const cleanPwd = pwd ? normalize(pwd).replace(/\/+$/, '') : '';
  const insidePwd =
    !isAbsolute(pathRel) &&
    (!cleanPwd || pathAbs === cleanPwd || pathAbs.startsWith(cleanPwd + '/'));
  if (!insidePwd) return 'external';
  const segments = pathRel.split('/');
  if (segments.some((s) => GENERATED_SEGMENTS.has(s))) return 'generated';
  return 'deliverable';
}

const APPLY_PATCH_FILE_RE = /^\s*\*\*\*\s+(?:Add|Update|Delete) File:\s*(.+?)\s*$/gm;
const REDIRECT_RE = /(?:^|\s)\d*>{1,2}\s*("[^"]+"|'[^']+'|[^\s;|&<>]+)/g;
const TEE_RE = /(?:^|\s|\|)\s*tee\s+(?:-a\s+)?("[^"]+"|'[^']+'|[^\s;|&<>]+)/g;

/**
 * Clean a token captured next to a redirect/tee/apply_patch into a usable path,
 * or null if it's noise: fd dups (`&2`), /dev/null, flags, or paths with an
 * unexpanded shell variable (`$work/x` — can't be attributed to a repo).
 */
function sanitizeWritePath(raw: string): string | null {
  let s = raw.trim();
  // Drop matching wrapping quotes, then trailing/leading shell punctuation.
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1);
  }
  s = s
    .replace(/^[('"`]+/, '')
    .replace(/[)'"`;,]+$/, '')
    .trim();
  if (!s) return null;
  if (s === '-' || s.startsWith('-') || s.startsWith('&')) return null;
  if (s.includes('$')) return null; // unexpanded variable
  if (s === '/dev/null' || /(^|\/)dev\/null$/.test(s) || s.startsWith('/dev/')) return null;
  if (!/[A-Za-z0-9_.]/.test(s)) return null; // must contain a real name char
  return s;
}

/**
 * Best-effort extraction of written file paths from a shell command string —
 * the codex/shell-agent path (they write via `apply_patch`, redirects, `tee`
 * rather than structured Edit/Write tools). Returns paths only; reads are
 * intentionally ignored (too noisy to attribute as a footprint).
 */
export function writePathsFromShell(cmd: string): string[] {
  if (!cmd) return [];
  const out = new Set<string>();
  const add = (raw: string): void => {
    const p = sanitizeWritePath(raw);
    if (p) out.add(p);
  };
  for (const m of cmd.matchAll(APPLY_PATCH_FILE_RE)) add(m[1]!);
  for (const m of cmd.matchAll(REDIRECT_RE)) add(m[1]!);
  for (const m of cmd.matchAll(TEE_RE)) add(m[1]!);
  return [...out];
}

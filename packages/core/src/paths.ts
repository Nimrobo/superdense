import { homedir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';

export const SUPERDENSE_HOME = process.env.SUPERDENSE_HOME ?? join(homedir(), '.superdense');
export const DB_PATH = join(SUPERDENSE_HOME, 'index.db');
export const GROUPS_DIR = join(SUPERDENSE_HOME, 'queries');
export const USER_FILTERS_DIR = join(SUPERDENSE_HOME, 'filters');
export const LEGACY_USER_FILTERS_DIR = join(SUPERDENSE_HOME, 'plugins');
export const USER_ENRICHERS_DIR = join(SUPERDENSE_HOME, 'enrichers');

export const CLAUDE_SKILLS_DIR =
  process.env.CLAUDE_SKILLS_DIR ?? join(homedir(), '.claude', 'skills');
export const CODEX_SKILLS_DIR = process.env.CODEX_SKILLS_DIR ?? join(homedir(), '.codex', 'skills');

/** Where Claude Code persists named plan files (`<slug>.md`). The slug is a free,
 *  human-readable artifact anchor — sessions citing the same slug are the same work. */
export const CLAUDE_PLANS_DIR = process.env.CLAUDE_PLANS_DIR ?? join(homedir(), '.claude', 'plans');

/** Extract the plan slug from a `~/.claude/plans/<slug>.md` path, else null.
 *  Matches the plans dir anywhere in the string so it works on both absolute
 *  paths and text mentions. */
export function planSlugFromPath(p: string): string | null {
  if (!p) return null;
  const m = p.match(/\.claude\/plans\/([^/\s]+?)\.md\b/);
  return m?.[1] ?? null;
}

export function localClaudeSkillsDir(cwd: string): string {
  return join(cwd, '.claude', 'skills');
}

export function localCodexSkillsDir(cwd: string): string {
  return join(cwd, '.codex', 'skills');
}

export function ensureSuperdenseDirs(): void {
  mkdirSync(SUPERDENSE_HOME, { recursive: true });
  mkdirSync(GROUPS_DIR, { recursive: true });
  mkdirSync(USER_FILTERS_DIR, { recursive: true });
  mkdirSync(LEGACY_USER_FILTERS_DIR, { recursive: true });
  mkdirSync(USER_ENRICHERS_DIR, { recursive: true });
}

import { homedir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';

export const ROAD42_HOME = process.env.ROAD42_HOME ?? join(homedir(), '.road42');
export const DB_PATH = join(ROAD42_HOME, 'index.db');
export const GROUPS_DIR = join(ROAD42_HOME, 'queries');
export const USER_FILTERS_DIR = join(ROAD42_HOME, 'filters');
export const LEGACY_USER_FILTERS_DIR = join(ROAD42_HOME, 'plugins');
export const USER_ENRICHERS_DIR = join(ROAD42_HOME, 'enrichers');

export const CLAUDE_SKILLS_DIR = process.env.CLAUDE_SKILLS_DIR ?? join(homedir(), '.claude', 'skills');
export const CODEX_SKILLS_DIR = process.env.CODEX_SKILLS_DIR ?? join(homedir(), '.codex', 'skills');

export function ensureRoad42Dirs(): void {
  mkdirSync(ROAD42_HOME, { recursive: true });
  mkdirSync(GROUPS_DIR, { recursive: true });
  mkdirSync(USER_FILTERS_DIR, { recursive: true });
  mkdirSync(LEGACY_USER_FILTERS_DIR, { recursive: true });
  mkdirSync(USER_ENRICHERS_DIR, { recursive: true });
}

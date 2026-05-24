import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface InsightRecipe {
  name: string;
  title: string;
  description: string;
  file: string;
}

export const INSIGHT_MARKER_VERSION = 1;

const here = dirname(fileURLToPath(import.meta.url));
const CANDIDATES = [
  join(here, 'insights'),
  join(here, '..', '..', 'insights'),
  join(here, '..', '..', '..', 'insights'),
];

let cachedRoot: string | null = null;

function resolveInsightsRoot(): string {
  if (cachedRoot) return cachedRoot;
  for (const c of CANDIDATES) {
    if (existsSync(join(c, 'index.json'))) {
      cachedRoot = c;
      return c;
    }
  }
  throw new Error(`superdense insights folder not found (looked in: ${CANDIDATES.join(', ')})`);
}

let cachedRecipes: InsightRecipe[] | null = null;

export function listInsightRecipes(): InsightRecipe[] {
  if (cachedRecipes) return cachedRecipes;
  const root = resolveInsightsRoot();
  const raw = readFileSync(join(root, 'index.json'), 'utf8');
  const parsed = JSON.parse(raw) as InsightRecipe[];
  cachedRecipes = parsed;
  return parsed;
}

export function getInsightRecipe(name: string): InsightRecipe | undefined {
  return listInsightRecipes().find((r) => r.name === name);
}

export function loadInsightPromptBody(name: string): string {
  const recipe = getInsightRecipe(name);
  if (!recipe) throw new Error(`insight not found: ${name}`);
  const root = resolveInsightsRoot();
  return readFileSync(join(root, recipe.file), 'utf8');
}

/**
 * Assemble the full prompt to hand to a user's coding agent: marker line first
 * (so the auto-discovery enricher can recognize the run), then the .md body.
 */
export function assembleInsightPrompt(name: string, runId: string): string {
  const recipe = getInsightRecipe(name);
  if (!recipe) throw new Error(`insight not found: ${name}`);
  const body = loadInsightPromptBody(name);
  const marker = `<!-- superdense:insight name="${recipe.name}" run="${runId}" v=${INSIGHT_MARKER_VERSION} -->`;
  return `${marker}\n\n${body}`;
}

const MARKER_RE = /<!--\s*superdense:insight\s+name="([\w-]+)"\s+run="([0-9a-fA-F-]+)"\s+v=(\d+)\s*-->/;

export interface InsightMarker {
  name: string;
  runId: string;
  version: number;
}

export function parseInsightMarker(text: string): InsightMarker | null {
  const m = MARKER_RE.exec(text);
  if (!m) return null;
  return { name: m[1]!, runId: m[2]!, version: Number(m[3]) };
}

const ANSWER_RE = /(^|\n)##\s+Answer\b[^\n]*\n([\s\S]*?)(?=\n##\s+|\n#\s+|$)/i;

export function extractAnswerSection(text: string): string | null {
  const m = ANSWER_RE.exec(text);
  if (!m) return null;
  return m[2]!.trim();
}

/** Test-only helper. */
export function clearInsightCache(): void {
  cachedRoot = null;
  cachedRecipes = null;
}

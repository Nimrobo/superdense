import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { USER_ENRICHERS_DIR } from '../paths.js';
import type { Enricher } from './types.js';

const VALID_RETURNS = new Set(['string', 'int', 'bool', 'json']);

function isEnricher(x: unknown): x is Enricher {
  if (!x || typeof x !== 'object') return false;
  const e = x as Record<string, unknown>;
  return (
    typeof e.name === 'string' &&
    typeof e.version === 'number' &&
    typeof e.returns === 'string' &&
    VALID_RETURNS.has(e.returns as string) &&
    typeof e.run === 'function'
  );
}

export async function readUserEnrichers(dir: string = USER_ENRICHERS_DIR): Promise<Enricher[]> {
  let files: string[] = [];
  try {
    files = (await readdir(dir)).filter((f) => f.endsWith('.js') || f.endsWith('.mjs'));
  } catch {
    return [];
  }
  const out: Enricher[] = [];
  for (const f of files) {
    try {
      const mod = await import(pathToFileURL(join(dir, f)).href);
      const candidate = (mod.default ?? mod.enricher) as unknown;
      if (isEnricher(candidate)) {
        out.push(candidate);
      } else {
        console.warn(
          `[superdense] enricher ${f} missing required fields (name, version, returns, run)`,
        );
      }
    } catch (err) {
      console.warn(`[superdense] failed to load enricher ${f}:`, err);
    }
  }
  return out;
}

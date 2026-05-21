import { claudeCodeAdapter } from '../adapters/claude-code.js';
import { getEnrichment, listQueries, upsertEnrichment } from '../db.js';
import { collectReferencedEnrichers } from '../query/validate.js';
import type { Session } from '../types.js';
import { eventCountEnricher } from './event-count.js';
import { hasErrorsEnricher } from './has-errors.js';
import { readUserEnrichers } from './loader.js';
import { toolCountsEnricher } from './tool-counts.js';
import type { Enricher } from './types.js';

const BUILTINS: Enricher[] = [toolCountsEnricher, eventCountEnricher, hasErrorsEnricher];

const registry: Enricher[] = [...BUILTINS];
let userLoaded = false;
let activeNames: Set<string> = new Set();

export function registerEnricher(e: Enricher): void {
  const existing = registry.find((x) => x.name === e.name);
  if (existing) {
    if (existing === e) return;
    throw new Error(`enricher name collision: "${e.name}" is already registered`);
  }
  registry.push(e);
}

export function listEnrichers(): Enricher[] {
  return registry.slice();
}

export function getEnricher(name: string): Enricher | undefined {
  return registry.find((e) => e.name === name);
}

export function getActiveEnricherNames(): Set<string> {
  return new Set(activeNames);
}

/** Recompute the set of enrichers referenced by at least one live query. */
export function refreshActiveEnricherNames(): Set<string> {
  const next = new Set<string>();
  for (const q of listQueries()) {
    for (const name of collectReferencedEnrichers(q.predicate)) next.add(name);
  }
  activeNames = next;
  return new Set(activeNames);
}

/** Load user-supplied enrichers from ~/.road42/enrichers. Idempotent. */
export async function loadUserEnrichers(): Promise<void> {
  if (userLoaded) return;
  userLoaded = true;
  const user = await readUserEnrichers();
  for (const e of user) {
    try {
      registerEnricher(e);
    } catch (err) {
      console.error(`[road42] ${(err as Error).message}`);
    }
  }
}

/** Test helper: drop user enrichers and force re-discovery on next loadUserEnrichers. */
export function clearEnricherCache(): void {
  userLoaded = false;
  for (let i = registry.length - 1; i >= 0; i--) {
    if (!BUILTINS.includes(registry[i]!)) registry.splice(i, 1);
  }
  activeNames = new Set();
}

function shouldRun(stored: ReturnType<typeof getEnrichment>, enricher: Enricher, session: Session): boolean {
  if (!stored) return true;
  if (stored.version < enricher.version) return true;
  if (session.fileMtime != null && session.fileMtime > stored.computedAt) return true;
  return false;
}

async function runOne(enricher: Enricher, session: Session): Promise<void> {
  const stored = getEnrichment(session.id, enricher.name);
  if (!shouldRun(stored, enricher, session)) return;
  try {
    const value = await enricher.run({
      session,
      logPath: session.logPath,
      iterEvents: (p) => claudeCodeAdapter.iterEvents(p),
    });
    upsertEnrichment(session.id, enricher.name, enricher.version, value, Date.now());
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[enricher] ${enricher.name} failed for ${session.id}: ${msg}`);
  }
}

/** Run only the enrichers that are referenced by at least one live query. */
export async function runEnrichersForSession(session: Session): Promise<void> {
  if (activeNames.size === 0) return;
  for (const enricher of registry) {
    if (!activeNames.has(enricher.name)) continue;
    await runOne(enricher, session);
  }
}

/** Run a specific enricher for a session (used by query backfill). */
export async function runEnricherByNameForSession(name: string, session: Session): Promise<void> {
  const enricher = getEnricher(name);
  if (!enricher) return;
  await runOne(enricher, session);
}

export type { Enricher, EnricherContext } from './types.js';

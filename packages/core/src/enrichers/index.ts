import { claudeCodeAdapter } from '../adapters/claude-code.js';
import { getEnrichment, upsertEnrichment } from '../db.js';
import type { Session } from '../types.js';
import { eventCountEnricher } from './event-count.js';
import { hasErrorsEnricher } from './has-errors.js';
import { toolCountsEnricher } from './tool-counts.js';
import type { Enricher } from './types.js';

const registry: Enricher[] = [];

export function registerEnricher(e: Enricher): void {
  if (registry.some((x) => x.name === e.name)) return;
  registry.push(e);
}

export function listEnrichers(): Enricher[] {
  return registry.slice();
}

registerEnricher(toolCountsEnricher);
registerEnricher(eventCountEnricher);
registerEnricher(hasErrorsEnricher);

function shouldRun(stored: ReturnType<typeof getEnrichment>, enricher: Enricher, session: Session): boolean {
  if (!stored) return true;
  if (stored.version < enricher.version) return true;
  if (session.fileMtime != null && session.fileMtime > stored.computedAt) return true;
  return false;
}

export async function runEnrichersForSession(session: Session): Promise<void> {
  for (const enricher of registry) {
    const stored = getEnrichment(session.id, enricher.name);
    if (!shouldRun(stored, enricher, session)) continue;
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
}

export type { Enricher, EnricherContext } from './types.js';

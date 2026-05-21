import { iterSessionEvents } from '../adapters/index.js';
import type { Session } from '../types.js';
import { salienceCompactor } from './salience.js';
import { traceCompactor } from './trace.js';
import type { Compactor } from './types.js';

const BUILTINS: Compactor[] = [traceCompactor, salienceCompactor];
const registry: Compactor[] = [...BUILTINS];

export function registerCompactor(c: Compactor): void {
  const existing = registry.find((x) => x.name === c.name);
  if (existing) {
    if (existing === c) return;
    throw new Error(`compactor name collision: "${c.name}" is already registered`);
  }
  registry.push(c);
}

export function listCompactors(): Compactor[] {
  return registry.slice();
}

export function getCompactor(name: string): Compactor | undefined {
  return registry.find((c) => c.name === name);
}

/** Run a compactor on a session and return its output. No caching. */
export async function compactSession(name: string, session: Session): Promise<unknown> {
  const compactor = getCompactor(name);
  if (!compactor) throw new Error(`unknown compactor: "${name}"`);
  return compactor.run({
    session,
    logPath: session.logPath,
    iterEvents: () => iterSessionEvents(session),
  });
}

export { traceCompactor, salienceCompactor };
export type { Compactor, CompactorContext } from './types.js';

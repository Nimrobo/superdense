import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { adapters } from './adapters/index.js';
import { getQuery, getSession, listQueryMatches, markIndexed, upsertSession } from './db.js';
import {
  loadUserEnrichers,
  refreshActiveEnricherNames,
  runEnrichersForSession,
} from './enrichers/index.js';
import { GROUPS_DIR } from './paths.js';
import { runQueryEvaluation } from './queryeval.js';
import type { Session } from './types.js';
import { resolveProjectKey } from './util/project-key.js';

export interface IndexProgress {
  phase: 'discover' | 'evaluate' | 'idle';
  total: number;
  done: number;
  startedAt: number;
  finishedAt?: number;
}

let progress: IndexProgress = { phase: 'idle', total: 0, done: 0, startedAt: 0 };

export function getProgress(): IndexProgress {
  return progress;
}

export async function runDiscovery(): Promise<{ discovered: number }> {
  progress = { phase: 'discover', total: 0, done: 0, startedAt: Date.now() };
  await loadUserEnrichers();
  refreshActiveEnricherNames();

  let count = 0;
  for (const adapter of adapters) {
    const found = await adapter.discover();
    progress.total += found.length;
    for (const d of found) {
      const id = `${adapter.name}:${d.sessionId}`;
      const fileMtime = (await adapter.sourceMtime?.(d)) ?? d.modifiedAt ?? null;
      const session: Session = {
        id,
        agent: adapter.name,
        sessionId: d.sessionId,
        logPath: d.logPath,
        pwd: d.pwd,
        projectKey: resolveProjectKey(d.pwd),
        firstPrompt: d.firstPrompt ?? null,
        summary: d.summary ?? null,
        messageCount: d.messageCount ?? null,
        gitBranch: d.gitBranch ?? null,
        createdAt: d.createdAt ?? null,
        modifiedAt: d.modifiedAt ?? null,
        isSidechain: d.isSidechain ?? false,
        fileMtime,
        lastIndexedAt: null,
      };
      const existing = getSession(id);
      if (existing && fileMtime && existing.fileMtime && fileMtime <= existing.fileMtime) {
        session.lastIndexedAt = existing.lastIndexedAt ?? null;
      }
      upsertSession(session);
      await runEnrichersForSession(session);
      markIndexed(session.id, Date.now());
      count++;
      progress.done++;
    }
  }
  progress = { ...progress, phase: 'idle' };
  return { discovered: count };
}

export async function indexAll(opts: { full?: boolean } = {}): Promise<void> {
  await runDiscovery();
  await runQueryEvaluation(opts);
}

export async function writeQueryJson(queryId: string): Promise<void> {
  const q = getQuery(queryId);
  if (!q) return;
  const members = listQueryMatches(queryId);
  const payload = {
    id: q.id,
    name: q.name,
    filters: q.filters,
    enrichers: q.enrichers,
    createdAt: q.createdAt,
    lastRunAt: q.lastRunAt ?? Date.now(),
    sessionIds: members.map((m) => m.id),
  };
  await writeFile(join(GROUPS_DIR, `${q.id}.json`), JSON.stringify(payload, null, 2), 'utf8');
}

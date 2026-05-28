import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { adapters } from './adapters/index.js';
import {
  getQuery,
  getSession,
  listQueryMatches,
  markIndexed,
  upsertSession,
  upsertSessionLink,
} from './db.js';
import {
  loadUserEnrichers,
  refreshActiveEnricherNames,
  runEnrichersForSession,
} from './enrichers/index.js';
import { GROUPS_DIR } from './paths.js';
import { runQueryEvaluation } from './queryeval.js';
import type { Adapter, Session } from './types.js';
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

const MAX_SUBAGENT_DEPTH = 10;

async function indexSubagentsRecursive(
  adapter: Adapter,
  parentId: string,
  parentSessionId: string,
  depth: number,
  visited: Set<string>,
): Promise<number> {
  if (depth > MAX_SUBAGENT_DEPTH || visited.has(parentSessionId)) return 0;
  visited.add(parentSessionId);

  let count = 0;
  const children = await adapter.discoverSubAgentSessions(parentSessionId);
  const now = Date.now();

  for (const { session: d, relation, metadata } of children) {
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
      isSidechain: false,
      isSubagent: true,
      parentSessionId: parentId,
      fileMtime,
      lastIndexedAt: null,
    };
    const existing = getSession(id);
    if (existing && fileMtime && existing.fileMtime && fileMtime <= existing.fileMtime) {
      session.lastIndexedAt = existing.lastIndexedAt ?? null;
    }
    upsertSession(session);
    upsertSessionLink(parentId, id, relation, metadata ?? null, now);
    await runEnrichersForSession(session);
    markIndexed(session.id, Date.now());
    count++;

    count += await indexSubagentsRecursive(adapter, id, d.sessionId, depth + 1, visited);
  }

  return count;
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
        isSubagent: false,
        parentSessionId: null,
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

      // Recursively discover and index sub-agent children.
      const visited = new Set<string>();
      const subCount = await indexSubagentsRecursive(adapter, id, d.sessionId, 1, visited);
      count += subCount;
      progress.total += subCount;
      progress.done += subCount;
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

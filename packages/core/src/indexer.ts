import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { adapters } from './adapters/index.js';
import { claudeCodeAdapter, statLogFile } from './adapters/claude-code.js';
import {
  dropGroupItem,
  getDirtySessions,
  getSession,
  isGroupMember,
  listAllSessionsForBackfill,
  listGroupMembers,
  listGroups,
  markGroupRun,
  markIndexed,
  upsertGroupItem,
  upsertSession,
} from './db.js';
import { GROUPS_DIR } from './paths.js';
import { loadPlugins } from './plugins/index.js';
import { runEnrichersForSession } from './enrichers/index.js';
import type { Adapter, Group, GroupingPlugin, PluginHelpers, Session } from './types.js';

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

function adapterFor(agent: string): Adapter | undefined {
  return adapters.find((a) => a.name === agent);
}

const helpers: PluginHelpers = {
  iterEvents(jsonlPath) {
    return claudeCodeAdapter.iterEvents(jsonlPath);
  },
};

export async function runDiscovery(): Promise<{ discovered: number }> {
  progress = { phase: 'discover', total: 0, done: 0, startedAt: Date.now() };
  let count = 0;
  for (const adapter of adapters) {
    const found = await adapter.discover();
    progress.total += found.length;
    for (const d of found) {
      const id = `${adapter.name}:${d.sessionId}`;
      const fileMtime = (await statLogFile(d.logPath)) ?? d.modifiedAt ?? null;
      const session: Session = {
        id,
        agent: adapter.name,
        sessionId: d.sessionId,
        logPath: d.logPath,
        pwd: d.pwd,
        firstPrompt: d.firstPrompt ?? null,
        summary: d.summary ?? null,
        messageCount: d.messageCount ?? null,
        gitBranch: d.gitBranch ?? null,
        createdAt: d.createdAt ?? null,
        modifiedAt: d.modifiedAt ?? null,
        isSidechain: d.isSidechain ?? false,
        fileMtime,
        // Note: we don't reset last_indexed_at — upsertSession overwrites only known columns.
        // To preserve last_indexed_at, fetch existing first.
        lastIndexedAt: null,
      };
      const existing = getSession(id);
      if (existing && fileMtime && existing.fileMtime && fileMtime <= existing.fileMtime) {
        session.lastIndexedAt = existing.lastIndexedAt ?? null;
      }
      upsertSession(session);
      await runEnrichersForSession(session);
      count++;
      progress.done++;
    }
  }
  progress = { ...progress, phase: 'idle' };
  return { discovered: count };
}

export async function runGroupEvaluation(opts: { full?: boolean } = {}): Promise<{ evaluated: number }> {
  const groups = listGroups();
  if (groups.length === 0) return { evaluated: 0 };
  const sessions = opts.full ? listAllSessionsForBackfill() : getDirtySessions();
  if (sessions.length === 0) return { evaluated: 0 };

  const plugins = await loadPlugins();
  const pluginByName = new Map(plugins.map((p) => [p.name, p] as const));

  progress = { phase: 'evaluate', total: sessions.length, done: 0, startedAt: Date.now() };
  const now = Date.now();
  for (const session of sessions) {
    for (const g of groups) {
      const plugin = pluginByName.get(g.pluginName);
      if (!plugin) continue;
      await evaluateOne(plugin, g, session, now);
    }
    markIndexed(session.id, now);
    progress.done++;
  }
  for (const g of groups) {
    markGroupRun(g.id, now);
    await writeGroupJson(g);
  }
  progress = { ...progress, phase: 'idle', finishedAt: Date.now() };
  return { evaluated: sessions.length };
}

async function evaluateOne(
  plugin: GroupingPlugin,
  group: Group,
  session: Session,
  now: number,
): Promise<void> {
  try {
    if (plugin.prefilter && !plugin.prefilter(session, group.pluginConfig)) {
      if (isGroupMember(group.id, session.id)) dropGroupItem(group.id, session.id);
      return;
    }
    const result = await plugin.matches(session, session.logPath, group.pluginConfig, helpers);
    const matched = result === true || (typeof result === 'object' && result.match === true);
    if (matched) {
      const evidence = typeof result === 'object' ? result.evidence ?? null : null;
      upsertGroupItem({ groupId: group.id, sessionId: session.id, addedAt: now, evidence });
    } else if (isGroupMember(group.id, session.id)) {
      dropGroupItem(group.id, session.id);
    }
  } catch (err) {
    console.error(`[road42] plugin "${plugin.name}" failed on ${session.id}:`, err);
  }
}

export async function backfillGroup(groupId: string): Promise<void> {
  const groups = listGroups().filter((g) => g.id === groupId);
  if (groups.length === 0) return;
  const group = groups[0]!;
  const plugins = await loadPlugins();
  const plugin = plugins.find((p) => p.name === group.pluginName);
  if (!plugin) return;
  const sessions = listAllSessionsForBackfill();
  const now = Date.now();
  for (const s of sessions) {
    await evaluateOne(plugin, group, s, now);
  }
  markGroupRun(group.id, now);
  await writeGroupJson(group);
}

async function writeGroupJson(group: Group): Promise<void> {
  const members = listGroupMembers(group.id);
  const payload = {
    id: group.id,
    name: group.name,
    pluginName: group.pluginName,
    pluginConfig: group.pluginConfig,
    createdAt: group.createdAt,
    lastRunAt: group.lastRunAt ?? Date.now(),
    sessionIds: members.map((m) => m.id),
  };
  await writeFile(join(GROUPS_DIR, `${group.id}.json`), JSON.stringify(payload, null, 2), 'utf8');
}

export async function previewPlugin(
  pluginName: string,
  config: Record<string, unknown>,
  opts: { limit?: number } = {},
): Promise<{ sessionId: string; evidence?: string | null }[]> {
  const plugins = await loadPlugins();
  const plugin = plugins.find((p) => p.name === pluginName);
  if (!plugin) throw new Error(`plugin not found: ${pluginName}`);
  const sessions = listAllSessionsForBackfill();
  const out: { sessionId: string; evidence?: string | null }[] = [];
  const limit = opts.limit ?? 500;
  for (const s of sessions) {
    if (plugin.prefilter && !plugin.prefilter(s, config)) continue;
    try {
      const r = await plugin.matches(s, s.logPath, config, helpers);
      const matched = r === true || (typeof r === 'object' && r.match === true);
      if (matched) {
        out.push({ sessionId: s.id, evidence: typeof r === 'object' ? r.evidence ?? null : null });
        if (out.length >= limit) break;
      }
    } catch (err) {
      console.error('preview error', err);
    }
  }
  return out;
}

export async function indexAll(opts: { full?: boolean } = {}): Promise<void> {
  await runDiscovery();
  await runGroupEvaluation(opts);
}

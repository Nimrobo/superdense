#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';
import semver from 'semver';
import {
  assembleInsightPrompt,
  applyCurationBatch,
  applyProjectProfilePatch,
  CLAUDE_SKILLS_DIR,
  compactSession,
  CODEX_SKILLS_DIR,
  countQueryMatches,
  countSessions,
  createQuery,
  deleteQuery,
  ensureSuperdenseDirs,
  finalizeArtifact,
  getArtifact,
  getCompactor,
  getCurationContext,
  getEnrichment,
  getProjectContext,
  getProjectProfileResolution,
  getQuery,
  SYSTEM_RUN_ID,
  getSession,
  getSessionChildren,
  getSessionTree,
  getWorkThread,
  indexAll,
  listArtifacts,
  listCompactors,
  listCurationInbox,
  listEnrichers,
  listFilterCatalog,
  listFilters,
  listInsightRecipes,
  listQueries,
  listProjectProfiles,
  listQueryMatchDetails,
  listSessionEnrichments,
  listSessions,
  listWorkThreads,
  loadUserEnrichers,
  localClaudeSkillsDir,
  localCodexSkillsDir,
  runAdHocQuery,
  runDiscovery,
  runQueryEvaluation,
  runSavedQuery,
  setProjectAttention,
  markSessionForCuration,
  validateQueryDefinition,
  type AdHocQueryResult,
  type Compactor,
  type QueryMatchDetail,
  type QueryDefinition,
  type Session,
} from '@nimrobo/superdense-core';
import { startServer } from '@nimrobo/superdense-server';
import open from 'open';

const CLI_PACKAGE_NAME = '@nimrobo/superdense';
const NPM_REGISTRY_PACKAGE_URL = `https://registry.npmjs.org/${CLI_PACKAGE_NAME.replace('/', '%2f')}`;
const SKIP_UPDATE_CHECK_ENV = 'SUPERDENSE_SKIP_UPDATE_CHECK';
const REQUIRED_STUDIO_SKILLS = [
  'superdense',
  'chain',
  'superdense-project-profile',
  'superdense-session-curate',
  'superdense-artifact-finalize',
];

interface CliIo {
  stdout: Pick<typeof console, 'log'>;
  stderr: Pick<typeof console, 'error'>;
  isTty?: boolean;
}

type SkillScope = 'global' | 'local';
type SkillInstallStatus = 'missing' | 'current' | 'outdated';

interface SkillInstallMarker {
  version: string;
  installedAt: string;
  scope: SkillScope;
}

interface SkillInstallTarget {
  scope: SkillScope;
  claudeRoot: string;
  codexRoot: string;
}

interface CliPackageJson {
  name?: string;
  version?: string;
}

function parseArgs(argv: string[]): {
  cmd: string;
  args: string[];
  flags: Record<string, string | boolean>;
} {
  const flags: Record<string, string | boolean> = {};
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq > -1) flags[a.slice(2, eq)] = a.slice(eq + 1);
      else if (argv[i + 1] && !argv[i + 1]!.startsWith('--')) {
        flags[a.slice(2)] = argv[++i]!;
      } else flags[a.slice(2)] = true;
    } else {
      positional.push(a);
    }
  }
  return { cmd: positional[0] ?? 'help', args: positional.slice(1), flags };
}

function printJson(value: unknown, io: CliIo): void {
  io.stdout.log(JSON.stringify(value, null, io.isTty ? 2 : 0));
}

function printErrorJson(err: unknown, io: CliIo): void {
  io.stderr.error(
    JSON.stringify({
      error: err instanceof Error ? err.message : String(err),
      code: err instanceof Error ? err.name : 'Error',
    }),
  );
}

function intFlag(
  flags: Record<string, string | boolean>,
  name: string,
  fallback: number,
  max?: number,
): number {
  const raw = flags[name];
  if (raw == null || typeof raw === 'boolean') return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  const value = Math.max(0, Math.floor(parsed));
  return max == null ? value : Math.min(value, max);
}

function includePath(flags: Record<string, string | boolean>): boolean {
  return flags['include-path'] === true;
}

function serializeSession(
  session: Session,
  opts: { includePath?: boolean } = {},
): Record<string, unknown> {
  const out: Record<string, unknown> = {
    id: session.id,
    agent: session.agent,
    sessionId: session.sessionId,
    pwd: session.pwd,
    projectKey: session.projectKey,
    firstPrompt: session.firstPrompt ?? null,
    summary: session.summary ?? null,
    messageCount: session.messageCount ?? null,
    gitBranch: session.gitBranch ?? null,
    createdAt: session.createdAt ?? null,
    modifiedAt: session.modifiedAt ?? null,
    isSidechain: !!session.isSidechain,
    isSubagent: !!session.isSubagent,
    parentSessionId: session.parentSessionId ?? null,
    fileMtime: session.fileMtime ?? null,
    lastIndexedAt: session.lastIndexedAt ?? null,
    curationStatus: session.curationStatus ?? 'pending',
    curatedRevision: session.curatedRevision ?? null,
    curatedAt: session.curatedAt ?? null,
    curationNote: session.curationNote ?? null,
    curationPriorityAt: session.curationPriorityAt ?? null,
  };
  if (opts.includePath) out.logPath = session.logPath;
  return out;
}

function serializeQueryMatch(
  match: QueryMatchDetail,
  opts: { includePath?: boolean; enrichments?: Record<string, unknown> } = {},
): Record<string, unknown> {
  return {
    session: serializeSession(match.session, opts),
    addedAt: match.addedAt,
    evidence: match.evidence ?? null,
    enrichments: opts.enrichments ?? {},
  };
}

function serializeCompactor(compactor: Compactor): Record<string, unknown> {
  return {
    name: compactor.name,
    kind: compactor.kind,
    targetBytes: compactor.targetBytes ?? null,
    description: compactor.description ?? null,
  };
}

async function readQueryDefinition(input: string | boolean | undefined): Promise<QueryDefinition> {
  if (typeof input !== 'string' || !input.trim()) throw new Error('--query is required');
  const raw = input.startsWith('@') ? await readFile(input.slice(1), 'utf8') : input;
  return JSON.parse(raw) as QueryDefinition;
}

async function readJsonObject(
  input: string | boolean | undefined,
  flag: string,
): Promise<Record<string, unknown>> {
  if (typeof input !== 'string' || !input.trim()) throw new Error(`--${flag} is required`);
  const raw = input.startsWith('@') ? await readFile(input.slice(1), 'utf8') : input;
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`--${flag} must contain a JSON object`);
  }
  return parsed as Record<string, unknown>;
}

async function validateCliQueryDefinition(definition: QueryDefinition): Promise<void> {
  await loadUserEnrichers();
  validateQueryDefinition(definition, { filters: await listFilters(), enrichers: listEnrichers() });
}

function getExistingQuery(id: string) {
  const q = getQuery(id);
  if (!q) throw new Error(`query not found: ${id}`);
  return q;
}

function getExistingSession(id: string): Session {
  const session = getSession(id);
  if (!session) throw new Error(`session not found: ${id}`);
  return session;
}

function serializeQueryResult(
  result: AdHocQueryResult,
  opts: { includePath?: boolean } = {},
): Record<string, unknown> {
  return {
    matched: result.matched,
    total: result.total,
    limit: result.limit,
    offset: result.offset,
    enrichers: result.enrichers,
    items: result.items.map((item) => {
      const session = getSession(item.sessionId);
      return {
        sessionId: item.sessionId,
        session: session ? serializeSession(session, { includePath: opts.includePath }) : null,
        evidence: item.evidence ?? null,
        enrichments: item.enrichments ?? {},
      };
    }),
  };
}

async function runAdHocQueryCommand(
  flags: Record<string, string | boolean>,
  io: CliIo,
  opts: { defaultLimit: number } = { defaultLimit: 20 },
): Promise<void> {
  const definition = await readQueryDefinition(flags.query);
  await validateCliQueryDefinition(definition);
  const limit = intFlag(flags, 'limit', opts.defaultLimit, 1000);
  const offset = intFlag(flags, 'offset', 0);
  const result = await runAdHocQuery(definition, { limit, offset });
  printJson(serializeQueryResult(result, { includePath: includePath(flags) }), io);
}

async function saveQueryCommand(flags: Record<string, string | boolean>, io: CliIo): Promise<void> {
  if (typeof flags.name !== 'string' || !flags.name.trim()) throw new Error('--name is required');
  const definition = await readQueryDefinition(flags.query);
  await validateCliQueryDefinition(definition);
  const id = randomUUID();
  createQuery({
    id,
    name: flags.name.trim(),
    filters: definition.filters,
    enrichers: definition.enrichers ?? [],
    createdAt: Date.now(),
  });
  printJson(getQuery(id), io);
}

async function runSavedQueryCommand(
  id: string | undefined,
  flags: Record<string, string | boolean>,
  io: CliIo,
  commandName: string,
): Promise<void> {
  if (!id) throw new Error(`${commandName} requires <id>`);
  await loadUserEnrichers();
  const result = await runSavedQuery(id);
  if (!result) throw new Error(`query not found: ${id}`);
  const q = getExistingQuery(id);
  const limit = intFlag(flags, 'limit', 200, 1000);
  const offset = intFlag(flags, 'offset', 0);
  const details = listQueryMatchDetails(id, { limit, offset });
  const resultBySession = new Map(result.items.map((item) => [item.sessionId, item] as const));
  printJson(
    {
      query: q,
      matched: result.matched,
      total: countQueryMatches(id),
      limit,
      offset,
      items: details.map((m) =>
        serializeQueryMatch(m, {
          includePath: includePath(flags),
          enrichments: resultBySession.get(m.session.id)?.enrichments ?? {},
        }),
      ),
    },
    io,
  );
}

async function handleSavedQuery(
  args: string[],
  flags: Record<string, string | boolean>,
  io: CliIo,
): Promise<boolean> {
  const action = args[0] ?? 'list';
  if (action === 'list') {
    printJson({ items: listQueries() }, io);
    return true;
  }
  if (action === 'show') {
    const id = args[1];
    if (!id) throw new Error('saved-query show requires <id>');
    const q = getExistingQuery(id);
    const limit = intFlag(flags, 'limit', 200, 1000);
    const offset = intFlag(flags, 'offset', 0);
    const details = listQueryMatchDetails(id, { limit, offset });
    printJson(
      {
        ...q,
        total: countQueryMatches(id),
        limit,
        offset,
        items: details.map((m) => serializeQueryMatch(m, { includePath: includePath(flags) })),
        members: details.map((m) =>
          serializeSession(m.session, { includePath: includePath(flags) }),
        ),
      },
      io,
    );
    return true;
  }
  if (action === 'save' || action === 'create') {
    await saveQueryCommand(flags, io);
    return true;
  }
  if (action === 'run') {
    await runSavedQueryCommand(args[1], flags, io, 'saved-query run');
    return true;
  }
  if (action === 'delete') {
    const id = args[1];
    if (!id) throw new Error('saved-query delete requires <id>');
    deleteQuery(id);
    printJson({ ok: true }, io);
    return true;
  }
  throw new Error(`unknown saved-query command: ${action}`);
}

async function handleQuery(
  args: string[],
  flags: Record<string, string | boolean>,
  io: CliIo,
): Promise<boolean> {
  if (args.length === 0 && flags.query !== undefined) {
    await runAdHocQueryCommand(flags, io);
    return true;
  }
  const action = args[0] ?? 'help';
  if (action === 'list') {
    printJson({ items: listQueries() }, io);
    return true;
  }
  if (action === 'show') {
    const id = args[1];
    if (!id) throw new Error('query show requires <id>');
    const q = getExistingQuery(id);
    const limit = intFlag(flags, 'limit', 200, 1000);
    const offset = intFlag(flags, 'offset', 0);
    const details = listQueryMatchDetails(id, { limit, offset });
    printJson(
      {
        ...q,
        total: countQueryMatches(id),
        limit,
        offset,
        items: details.map((m) => serializeQueryMatch(m, { includePath: includePath(flags) })),
        members: details.map((m) =>
          serializeSession(m.session, { includePath: includePath(flags) }),
        ),
      },
      io,
    );
    return true;
  }
  if (action === 'create' || action === 'save') {
    await saveQueryCommand(flags, io);
    return true;
  }
  if (action === 'preview') {
    await runAdHocQueryCommand(flags, io, { defaultLimit: 5 });
    return true;
  }
  if (action === 'delete') {
    const id = args[1];
    if (!id) throw new Error('query delete requires <id>');
    deleteQuery(id);
    printJson({ ok: true }, io);
    return true;
  }
  if (action === 'run') {
    await runSavedQueryCommand(args[1], flags, io, 'query run');
    return true;
  }
  if (action === 'help') throw new Error('query requires --query or a legacy subcommand');
  throw new Error(`unknown query command: ${action}`);
}

async function handleSession(
  args: string[],
  flags: Record<string, string | boolean>,
  io: CliIo,
): Promise<boolean> {
  const action = args[0] ?? 'list';
  if (action === 'list') {
    const limit = intFlag(flags, 'limit', 200, 1000);
    const offset = intFlag(flags, 'offset', 0);
    const filter = {
      agent: typeof flags.agent === 'string' ? flags.agent : undefined,
      pwd: typeof flags.pwd === 'string' ? flags.pwd : undefined,
      q: typeof flags.q === 'string' ? flags.q : undefined,
      includeSubagents: flags['include-subagents'] === true,
      limit,
      offset,
    };
    printJson(
      {
        items: listSessions(filter).map((s) =>
          serializeSession(s, { includePath: includePath(flags) }),
        ),
        total: countSessions(filter),
        limit,
        offset,
      },
      io,
    );
    return true;
  }
  if (action === 'show') {
    const id = args[1];
    if (!id) throw new Error('session show requires <session-id>');
    const session = getExistingSession(id);
    const children = getSessionChildren(id);
    const serialized = serializeSession(session, { includePath: includePath(flags) });
    serialized.isSubagent = !!session.isSubagent;
    serialized.parentSessionId = session.parentSessionId ?? null;
    serialized.hasSubagents = children.length > 0;
    serialized.subagentCount = children.length;
    serialized.subagentIds = children.map((c) => c.childId);
    printJson({ session: serialized }, io);
    return true;
  }
  if (action === 'children') {
    const id = args[1];
    if (!id) throw new Error('session children requires <session-id>');
    getExistingSession(id); // validate session exists
    const children = getSessionChildren(id);
    if (flags.full === true) {
      printJson(
        {
          parentId: id,
          items: children.map((c) => ({
            id: c.childId,
            relation: c.relation,
            metadata: c.metadata,
            session: (() => {
              const s = getSession(c.childId);
              return s ? serializeSession(s, { includePath: includePath(flags) }) : null;
            })(),
          })),
        },
        io,
      );
    } else {
      printJson(
        {
          parentId: id,
          items: children.map((c) => ({ id: c.childId, relation: c.relation })),
        },
        io,
      );
    }
    return true;
  }
  if (action === 'tree') {
    const id = args[1];
    if (!id) throw new Error('session tree requires <session-id>');
    getExistingSession(id); // validate session exists
    const depth = intFlag(flags, 'depth', 1, 20);
    const tree = getSessionTree(id, depth);
    printJson({ tree }, io);
    return true;
  }
  if (action === 'path') {
    const id = args[1];
    if (!id) throw new Error('session path requires <session-id>');
    const session = getExistingSession(id);
    printJson(
      {
        id: session.id,
        agent: session.agent,
        sessionId: session.sessionId,
        logPath: session.logPath,
      },
      io,
    );
    return true;
  }
  if (action === 'fields') {
    await loadUserEnrichers();
    printJson(
      {
        filters: await listFilterCatalog(),
        enrichers: listEnrichers().map(({ name, version, returns, jsonSchema, description }) => ({
          name,
          version,
          returns,
          jsonSchema,
          description,
        })),
      },
      io,
    );
    return true;
  }
  if (action === 'enrichments') {
    const id = args[1];
    if (!id) throw new Error('session enrichments requires <session-id>');
    const session = getExistingSession(id);
    let items;
    if (typeof flags.name === 'string' && flags.name.trim()) {
      const item = getEnrichment(id, SYSTEM_RUN_ID, flags.name.trim());
      items = item ? [{ name: flags.name.trim(), ...item }] : [];
    } else {
      items = listSessionEnrichments(id, SYSTEM_RUN_ID);
    }
    printJson(
      {
        session: serializeSession(session, { includePath: includePath(flags) }),
        items,
      },
      io,
    );
    return true;
  }
  throw new Error(`unknown session command: ${action}`);
}

async function handleCompactor(
  args: string[],
  flags: Record<string, string | boolean>,
  io: CliIo,
): Promise<boolean> {
  const action = args[0] ?? 'list';
  if (action === 'list') {
    printJson({ items: listCompactors().map(serializeCompactor) }, io);
    return true;
  }
  if (action === 'show') {
    const name = args[1];
    if (!name) throw new Error('compactor show requires <name>');
    const compactor = getCompactor(name);
    if (!compactor) throw new Error(`compactor not found: ${name}`);
    printJson(serializeCompactor(compactor), io);
    return true;
  }
  if (action === 'run') {
    const name = args[1];
    const sessionId = args[2];
    if (!name || !sessionId) throw new Error('compactor run requires <name> <session-id>');
    const compactor = getCompactor(name);
    if (!compactor) throw new Error(`compactor not found: ${name}`);
    const session = getExistingSession(sessionId);
    const result = await compactSession(name, session);
    printJson(
      {
        session: serializeSession(session, { includePath: includePath(flags) }),
        compactor: serializeCompactor(compactor),
        result,
      },
      io,
    );
    return true;
  }
  throw new Error(`unknown compactor command: ${action}`);
}

async function handleEnricher(args: string[], io: CliIo): Promise<boolean> {
  const action = args[0] ?? 'list';
  await loadUserEnrichers();
  if (action === 'list') {
    printJson(
      {
        items: listEnrichers().map(({ name, version, returns, jsonSchema, description }) => ({
          name,
          version,
          returns,
          jsonSchema,
          description,
        })),
      },
      io,
    );
    return true;
  }
  if (action === 'show') {
    const name = args[1];
    if (!name) throw new Error('enricher show requires <name>');
    const e = listEnrichers().find((x) => x.name === name);
    if (!e) throw new Error(`enricher not found: ${name}`);
    const { run: _run, ...serializable } = e;
    printJson(serializable, io);
    return true;
  }
  throw new Error(`unknown enricher command: ${action}`);
}

async function handleProject(
  args: string[],
  flags: Record<string, string | boolean>,
  io: CliIo,
): Promise<boolean> {
  const action = args[0] ?? 'list';
  if (action === 'list') {
    printJson(
      {
        items: listProjectProfiles({ needsAction: flags['needs-action'] === true }),
      },
      io,
    );
    return true;
  }
  const id = args[1];
  if (!id) throw new Error(`project ${action} requires <id>`);
  if (action === 'show') {
    const result = getProjectProfileResolution(id);
    if (!result) throw new Error(`project not found: ${id}`);
    printJson(result, io);
    return true;
  }
  if (action === 'context') {
    const context = getProjectContext(id);
    if (!context) throw new Error(`project not found: ${id}`);
    printJson(context, io);
    return true;
  }
  if (action === 'apply') {
    const patch = await readJsonObject(flags.patch, 'patch');
    printJson({ project: applyProjectProfilePatch(id, patch) }, io);
    return true;
  }
  if (action === 'attention') {
    if (flags.needed === true) {
      const reasons =
        typeof flags.reasons === 'string'
          ? (JSON.parse(flags.reasons) as unknown)
          : ['Marked for human attention'];
      if (!Array.isArray(reasons) || reasons.some((reason) => typeof reason !== 'string')) {
        throw new Error('--reasons must be a JSON array of strings');
      }
      printJson({ project: setProjectAttention(id, { needed: true, reasons }) }, io);
      return true;
    }
    if (flags.resolved === true) {
      printJson({ project: setProjectAttention(id, { needed: false }) }, io);
      return true;
    }
    throw new Error('project attention requires --needed or --resolved');
  }
  throw new Error(`unknown project command: ${action}`);
}

function resolveCurrentSessionId(env: NodeJS.ProcessEnv = process.env): string {
  if (env.SUPERDENSE_CURRENT_SESSION_ID) return env.SUPERDENSE_CURRENT_SESSION_ID;
  if (env.CODEX_THREAD_ID) return `codex:${env.CODEX_THREAD_ID}`;
  if (env.CLAUDE_CODE_SESSION_ID) return `claude-code:${env.CLAUDE_CODE_SESSION_ID}`;
  if (env.CLAUDE_CODE_REMOTE_SESSION_ID) return `claude-code:${env.CLAUDE_CODE_REMOTE_SESSION_ID}`;
  throw new Error(
    'could not resolve the current session from the environment; use `superdense artifact mark --session <adapter:id>`',
  );
}

async function handleArtifact(
  args: string[],
  flags: Record<string, string | boolean>,
  io: CliIo,
): Promise<boolean> {
  const action = args[0];
  if (action === 'mark-current') {
    printJson({ marker: markSessionForCuration(resolveCurrentSessionId()) }, io);
    return true;
  }
  if (action === 'mark') {
    if (typeof flags.session !== 'string' || !flags.session.trim()) {
      throw new Error('artifact mark requires --session <adapter:id>');
    }
    printJson({ marker: markSessionForCuration(flags.session.trim()) }, io);
    return true;
  }
  if (action === 'finalize') {
    printJson(finalizeArtifact(await readJsonObject(flags.input, 'input')), io);
    return true;
  }
  if (action === 'list') {
    printJson(
      {
        items: listArtifacts({
          projectId: typeof flags.project === 'string' ? flags.project : undefined,
          type: typeof flags.type === 'string' ? flags.type : undefined,
        }),
      },
      io,
    );
    return true;
  }
  if (action === 'show') {
    const id = args[1];
    if (!id) throw new Error('artifact show requires <thread-id>');
    const artifact = getArtifact(id);
    if (!artifact) throw new Error(`artifact not found: ${id}`);
    printJson({ artifact }, io);
    return true;
  }
  throw new Error(`unknown artifact command: ${action ?? '(none)'}`);
}

async function handleCuration(
  args: string[],
  flags: Record<string, string | boolean>,
  io: CliIo,
): Promise<boolean> {
  const action = args[0];
  if (action === 'inbox') {
    printJson(
      listCurationInbox({
        projectId: typeof flags.project === 'string' ? flags.project : undefined,
        limit: intFlag(flags, 'limit', 10, 1000),
      }),
      io,
    );
    return true;
  }
  if (action === 'context') {
    const sessionId = args[1];
    if (!sessionId) throw new Error('curation context requires <root-session-id>');
    printJson(getCurationContext(sessionId), io);
    return true;
  }
  if (action === 'apply') {
    printJson(applyCurationBatch(await readJsonObject(flags.input, 'input')), io);
    return true;
  }
  throw new Error(`unknown curation command: ${action ?? '(none)'}`);
}

function handleThread(args: string[], flags: Record<string, string | boolean>, io: CliIo): boolean {
  const action = args[0] ?? 'list';
  if (action === 'list') {
    printJson(
      {
        items: listWorkThreads({
          projectId: typeof flags.project === 'string' ? flags.project : undefined,
        }),
      },
      io,
    );
    return true;
  }
  if (action === 'show') {
    const id = args[1];
    if (!id) throw new Error('thread show requires <thread-id>');
    const thread = getWorkThread(id);
    if (!thread) throw new Error(`thread not found: ${id}`);
    printJson({ thread }, io);
    return true;
  }
  throw new Error(`unknown thread command: ${action}`);
}

function handleInsight(args: string[], io: CliIo): boolean {
  const action = args[0] ?? 'list';
  if (action === 'list') {
    printJson({ items: listInsightRecipes() }, io);
    return true;
  }
  if (action === 'prompt') {
    const name = args[1];
    if (!name) throw new Error('insight prompt requires <name>');
    const runId = randomUUID();
    const body = assembleInsightPrompt(name, runId);
    io.stdout.log(body);
    return true;
  }
  throw new Error(`unknown insight command: ${action}`);
}

async function handleFilter(args: string[], io: CliIo): Promise<boolean> {
  const action = args[0] ?? 'list';
  if (action === 'list') {
    printJson({ items: await listFilterCatalog() }, io);
    return true;
  }
  if (action === 'show') {
    const name = args[1];
    if (!name) throw new Error('filter show requires <name>');
    const item = (await listFilterCatalog()).find((x) => x.name === name);
    if (!item) throw new Error(`filter not found: ${name}`);
    printJson(item, io);
    return true;
  }
  throw new Error(`unknown filter command: ${action}`);
}

function bundledSkillsRoot(): string {
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const skillsRoot = [join(moduleDir, 'skills'), join(moduleDir, '..', '..', '..', 'skills')].find(
    (candidate) => existsSync(candidate),
  );
  if (!skillsRoot) throw new Error(`skills directory not found: ${join(moduleDir, 'skills')}`);
  return skillsRoot;
}

function readSkillVersion(skillDir: string): string | null {
  const skillPath = join(skillDir, 'SKILL.md');
  if (!existsSync(skillPath)) return null;
  const raw = readFileSync(skillPath, 'utf8');
  const frontmatter = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!frontmatter) return null;
  const version = frontmatter[1].match(/^version:\s*["']?([^"'\s]+)["']?\s*$/m);
  return version?.[1] ?? null;
}

function readInstalledMarker(dest: string): SkillInstallMarker | null {
  const markerPath = join(dest, '.superdense-install.json');
  if (!existsSync(markerPath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(markerPath, 'utf8')) as Partial<SkillInstallMarker>;
    if (
      typeof parsed.version === 'string' &&
      typeof parsed.installedAt === 'string' &&
      (parsed.scope === 'global' || parsed.scope === 'local')
    ) {
      return parsed as SkillInstallMarker;
    }
  } catch {
    return null;
  }
  return null;
}

function compareVersions(a: string, b: string): number {
  const left = a.split('.').map((part) => Number.parseInt(part, 10));
  const right = b.split('.').map((part) => Number.parseInt(part, 10));
  const len = Math.max(left.length, right.length);
  for (let i = 0; i < len; i++) {
    const l = Number.isFinite(left[i]) ? left[i]! : 0;
    const r = Number.isFinite(right[i]) ? right[i]! : 0;
    if (l !== r) return l > r ? 1 : -1;
  }
  return 0;
}

function skillInstallTarget(scope: SkillScope, cwd: string): SkillInstallTarget {
  if (scope === 'local') {
    return { scope, claudeRoot: localClaudeSkillsDir(cwd), codexRoot: localCodexSkillsDir(cwd) };
  }
  return {
    scope,
    claudeRoot: process.env.CLAUDE_SKILLS_DIR ?? CLAUDE_SKILLS_DIR,
    codexRoot: process.env.CODEX_SKILLS_DIR ?? CODEX_SKILLS_DIR,
  };
}

function writeInstallMarker(dest: string, version: string, scope: SkillScope): void {
  const marker: SkillInstallMarker = {
    version,
    installedAt: new Date().toISOString(),
    scope,
  };
  writeFileSync(join(dest, '.superdense-install.json'), `${JSON.stringify(marker, null, 2)}\n`);
}

function classifySkillInstall(
  dest: string,
  sourceVersion: string,
): { status: SkillInstallStatus; version: string | null } {
  if (!existsSync(dest)) return { status: 'missing', version: null };
  const marker = readInstalledMarker(dest);
  if (!marker) return { status: 'outdated', version: readSkillVersion(dest) };
  return compareVersions(marker.version, sourceVersion) >= 0
    ? { status: 'current', version: marker.version }
    : { status: 'outdated', version: marker.version };
}

function installSkills(
  names: string[],
  opts: { scope: SkillScope; cwd: string },
): Array<{ name: string; claude: string; codex: string }> {
  const skillsRoot = bundledSkillsRoot();
  const targetNames = names.length
    ? names
    : readdirSync(skillsRoot).filter((entry) => statSync(join(skillsRoot, entry)).isDirectory());

  const target = skillInstallTarget(opts.scope, opts.cwd);
  const installed: Array<{ name: string; claude: string; codex: string }> = [];

  for (const name of targetNames) {
    const src = join(skillsRoot, name);
    if (!existsSync(src) || !statSync(src).isDirectory()) {
      throw new Error(`skill not found: ${name}`);
    }
    const version = readSkillVersion(src);
    if (!version) throw new Error(`skill version not found: ${name}`);

    const claudeDest = join(target.claudeRoot, name);
    mkdirSync(claudeDest, { recursive: true });
    cpSync(src, claudeDest, { recursive: true });
    rmSync(join(claudeDest, 'SKILL.codex.md'), { force: true });
    writeInstallMarker(claudeDest, version, target.scope);

    const codexDest = join(target.codexRoot, name);
    mkdirSync(codexDest, { recursive: true });
    cpSync(src, codexDest, { recursive: true });
    const codexSkillPath = join(codexDest, 'SKILL.codex.md');
    if (existsSync(codexSkillPath)) {
      cpSync(codexSkillPath, join(codexDest, 'SKILL.md'));
      rmSync(codexSkillPath, { force: true });
    }
    writeInstallMarker(codexDest, version, target.scope);

    installed.push({ name, claude: claudeDest, codex: codexDest });
  }

  return installed;
}

function handleSkillInstall(
  args: string[],
  flags: Record<string, string | boolean>,
  io: CliIo,
): void {
  const installed = installSkills(args, {
    scope: flags.locally === true ? 'local' : 'global',
    cwd: process.cwd(),
  });
  printJson({ installed }, io);
}

function studioSkillSummary(
  name: string,
  cwd: string,
): {
  sourceVersion: string;
  global: {
    claude: ReturnType<typeof classifySkillInstall>;
    codex: ReturnType<typeof classifySkillInstall>;
  };
  local: {
    claude: ReturnType<typeof classifySkillInstall>;
    codex: ReturnType<typeof classifySkillInstall>;
  };
} {
  const src = join(bundledSkillsRoot(), name);
  const sourceVersion = readSkillVersion(src);
  if (!sourceVersion) throw new Error(`skill version not found: ${name}`);
  const globalTarget = skillInstallTarget('global', cwd);
  const localTarget = skillInstallTarget('local', cwd);
  return {
    sourceVersion,
    global: {
      claude: classifySkillInstall(join(globalTarget.claudeRoot, name), sourceVersion),
      codex: classifySkillInstall(join(globalTarget.codexRoot, name), sourceVersion),
    },
    local: {
      claude: classifySkillInstall(join(localTarget.claudeRoot, name), sourceVersion),
      codex: classifySkillInstall(join(localTarget.codexRoot, name), sourceVersion),
    },
  };
}

function scopeStatus(
  summary: ReturnType<typeof studioSkillSummary>,
  scope: SkillScope,
): { status: SkillInstallStatus; version: string | null } {
  const entry = summary[scope];
  if (entry.claude.status === 'current' && entry.codex.status === 'current') {
    return { status: 'current', version: entry.claude.version ?? entry.codex.version };
  }
  if (entry.claude.status === 'outdated' || entry.codex.status === 'outdated') {
    return { status: 'outdated', version: entry.claude.version ?? entry.codex.version };
  }
  return { status: 'missing', version: null };
}

function chooseStudioSkillAction(summary: ReturnType<typeof studioSkillSummary>): {
  scope: SkillScope;
  status: Exclude<SkillInstallStatus, 'current'>;
  version: string | null;
} | null {
  const local = scopeStatus(summary, 'local');
  const global = scopeStatus(summary, 'global');
  if (local.status === 'current') return null;
  if (local.status === 'outdated')
    return { scope: 'local', status: 'outdated', version: local.version };
  if (global.status === 'current') return null;
  if (global.status === 'outdated')
    return { scope: 'global', status: 'outdated', version: global.version };
  return { scope: 'global', status: 'missing', version: null };
}

function chooseRequiredStudioSkillAction(
  names: string[],
  cwd: string,
): {
  scope: SkillScope;
  status: Exclude<SkillInstallStatus, 'current'>;
  names: string[];
} | null {
  const actions = names.flatMap((name) => {
    const action = chooseStudioSkillAction(studioSkillSummary(name, cwd));
    return action ? [{ name, ...action }] : [];
  });
  if (actions.length === 0) return null;

  const scope: SkillScope = actions.some((action) => action.scope === 'local') ? 'local' : 'global';
  return {
    scope,
    status: actions.some((action) => action.status === 'outdated') ? 'outdated' : 'missing',
    names: actions.map((action) => action.name),
  };
}

async function confirm(prompt: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(prompt);
    return answer.trim() === '' || answer.trim().toLowerCase().startsWith('y');
  } finally {
    rl.close();
  }
}

function cliPackageVersion(): string {
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const packageJsonPath = [
    join(moduleDir, '..', 'package.json'),
    join(moduleDir, 'package.json'),
  ].find((candidate) => existsSync(candidate));
  if (!packageJsonPath) throw new Error('CLI package.json not found');

  const parsed = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as CliPackageJson;
  if (parsed.name !== CLI_PACKAGE_NAME)
    throw new Error(`unexpected CLI package name: ${parsed.name ?? '(missing)'}`);
  if (typeof parsed.version !== 'string' || !semver.valid(parsed.version)) {
    throw new Error(`invalid CLI package version: ${parsed.version ?? '(missing)'}`);
  }
  return parsed.version;
}

async function fetchLatestCliVersion(): Promise<string> {
  const response = await fetch(NPM_REGISTRY_PACKAGE_URL, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(2500),
  });
  if (!response.ok) throw new Error(`npm registry returned ${response.status}`);

  const body = (await response.json()) as { 'dist-tags'?: { latest?: unknown } };
  const latest = body['dist-tags']?.latest;
  if (typeof latest !== 'string' || !semver.valid(latest)) {
    throw new Error('npm registry response did not include a valid latest version');
  }
  return latest;
}

function spawnAndWait(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', env });
    child.once('error', reject);
    child.once('close', (code) => resolve(code ?? 1));
  });
}

async function checkNpmUpdateForStudio(
  argv: string[],
  io: CliIo,
): Promise<{ restarted: boolean; exitCode: number }> {
  let current: string;
  let latest: string;
  try {
    current = cliPackageVersion();
    latest = await fetchLatestCliVersion();
  } catch (err) {
    io.stderr.error(
      `[superdense] update check skipped: ${err instanceof Error ? err.message : String(err)}`,
    );
    return { restarted: false, exitCode: 0 };
  }

  if (!semver.gt(latest, current)) return { restarted: false, exitCode: 0 };

  const installCommand = `npm install -g ${CLI_PACKAGE_NAME}@latest`;
  if (!io.isTty || !process.stdin.isTTY) {
    io.stdout.log(
      `[superdense] update available: ${current} -> ${latest}. Run \`${installCommand}\` to update.`,
    );
    return { restarted: false, exitCode: 0 };
  }

  if (!(await confirm(`Update Superdense ${current} -> ${latest} with npm? [Y/n] `))) {
    return { restarted: false, exitCode: 0 };
  }

  io.stdout.log(`[superdense] updating with \`${installCommand}\`...`);
  try {
    const updateCode = await spawnAndWait('npm', ['install', '-g', `${CLI_PACKAGE_NAME}@latest`]);
    if (updateCode !== 0) {
      io.stderr.error(
        `[superdense] npm update failed with exit code ${updateCode}; continuing with ${current}.`,
      );
      return { restarted: false, exitCode: 0 };
    }
  } catch (err) {
    io.stderr.error(
      `[superdense] npm update failed: ${err instanceof Error ? err.message : String(err)}; continuing with ${current}.`,
    );
    return { restarted: false, exitCode: 0 };
  }

  io.stdout.log('[superdense] update installed; restarting studio...');
  const restartEnv = { ...process.env, [SKIP_UPDATE_CHECK_ENV]: '1' };
  const exitCode = await spawnAndWait('superdense', argv, restartEnv);
  return { restarted: true, exitCode };
}

async function checkSkillsForStudio(io: CliIo, opts: { cwd: string }): Promise<void> {
  const action = chooseRequiredStudioSkillAction(REQUIRED_STUDIO_SKILLS, opts.cwd);
  if (!action) return;

  const scopeLabel = action.scope === 'global' ? 'globally' : 'locally';
  if (!io.isTty || !process.stdin.isTTY) {
    const detail =
      action.status === 'outdated' ? 'required skills outdated' : 'required skills missing';
    const command =
      action.scope === 'local' ? 'superdense skill install --locally' : 'superdense skill install';
    io.stdout.log(`[superdense] hint: ${detail}. Run \`${command}\` to update.`);
    return;
  }

  const prompt =
    action.status === 'outdated'
      ? `Update Superdense skills ${scopeLabel}? [Y/n] `
      : `Install Superdense skills ${scopeLabel}? [Y/n] `;
  if (await confirm(prompt)) {
    installSkills(action.names, { scope: action.scope, cwd: opts.cwd });
    io.stdout.log(
      `[superdense] ${action.status === 'outdated' ? 'updated' : 'installed'} Superdense skills ${scopeLabel}.`,
    );
  }
}

export async function runCli(
  argv: string[],
  io: CliIo = {
    stdout: console,
    stderr: console,
    isTty: process.stdout.isTTY,
  },
): Promise<number> {
  ensureSuperdenseDirs();
  const { cmd, args, flags } = parseArgs(argv);

  if (cmd === 'skill') {
    const action = args[0];
    if (action !== 'install') throw new Error(`unknown skill command: ${action ?? '(none)'}`);
    handleSkillInstall(args.slice(1), flags, io);
    return 0;
  }

  if (cmd === 'query') {
    await handleQuery(args, flags, io);
    return 0;
  }

  if (cmd === 'saved-query') {
    await handleSavedQuery(args, flags, io);
    return 0;
  }

  if (cmd === 'session') {
    await handleSession(args, flags, io);
    return 0;
  }

  if (cmd === 'compactor') {
    await handleCompactor(args, flags, io);
    return 0;
  }

  if (cmd === 'enricher') {
    await handleEnricher(args, io);
    return 0;
  }

  if (cmd === 'filter') {
    await handleFilter(args, io);
    return 0;
  }

  if (cmd === 'project') {
    await handleProject(args, flags, io);
    return 0;
  }

  if (cmd === 'artifact') {
    await handleArtifact(args, flags, io);
    return 0;
  }

  if (cmd === 'curation') {
    await handleCuration(args, flags, io);
    return 0;
  }

  if (cmd === 'thread') {
    handleThread(args, flags, io);
    return 0;
  }

  if (cmd === 'insight') {
    handleInsight(args, io);
    return 0;
  }

  if (cmd === 'index') {
    io.stdout.log('[superdense] running incremental index...');
    await indexAll({ full: !!flags.full });
    io.stdout.log('[superdense] done.');
    return 0;
  }

  if (cmd === 'reindex') {
    io.stdout.log('[superdense] running full reindex...');
    await indexAll({ full: true });
    io.stdout.log('[superdense] done.');
    return 0;
  }

  if (cmd === 'discover') {
    const r = await runDiscovery();
    io.stdout.log(`[superdense] discovered ${r.discovered} sessions.`);
    return 0;
  }

  if (cmd === 'help') {
    io.stdout.log(
      [
        'Usage: superdense <command> [options]',
        '',
        'Commands:',
        '  start|studio        Start the Superdense web UI',
        '  session list        List indexed sessions (root sessions only by default)',
        '      --include-subagents  Include sub-agent sessions in listing',
        '  session show <id>   Show session metadata (includes hasSubagents, subagentIds)',
        '  session children <id>  List direct sub-agent children of a session',
        '      --full          Include full session metadata for each child',
        '  session tree <id>   Show recursive sub-agent tree (--depth N, default 1)',
        '  session path <id>   Get raw log file path',
        '  session fields      List filters and enrichers',
        '  session enrichments <id>  Get computed enrichments',
        '  filter list         List available filters',
        '  filter show <n>     Show filter params and examples',
        '  query --query <json|@file>  Run an unsaved ad hoc query',
        '  saved-query list          List saved queries',
        '  saved-query show <id>     Show saved query with matching sessions',
        '  saved-query save          Save a query without running it',
        '  saved-query run <id>      Evaluate a saved query and return results',
        '  saved-query delete <id>   Delete a saved query',
        '  compactor list      List available compactors',
        '  compactor show <n>  Show compactor details',
        '  compactor run <n> <id>  Run a compactor on a session',
        '  enricher list       List available enrichers',
        '  enricher show <n>   Show enricher details',
        '  insight list        List available insight recipes',
        '  insight prompt <n>  Print a copy-pasteable insight prompt for your coding agent',
        '  project list        List detected projects',
        '      --needs-action  Show unprofiled and human-attention projects only',
        '  project show <id>   Show a canonical project profile',
        '  project context <id>  Gather bounded evidence for profiling',
        '  project apply <id>  Apply an atomic profile merge patch (--patch <json|@file>)',
        '  project attention <id>  Mark attention --needed [--reasons <json>] or --resolved',
        '  artifact mark-current  Mark the current agent session for curation',
        '  artifact mark --session <adapter:id>  Mark an explicit session for curation',
        '  curation inbox      Get a bounded root-session review batch [--project <id>] [--limit N]',
        '  curation context <root-session-id>  Load root and linked sub-agent review hints',
        '  curation apply --input <json|@file>  Apply an atomic batch of reversible actions',
        '  thread list         List mutable work threads [--project <id>]',
        '  thread show <id>    Show a work thread and session memberships',
        '  artifact finalize --input <json|@file>  Extract an immutable artifact from a finalized thread',
        '  artifact list       List finalized artifacts [--project <id>] [--type <t>]',
        '  artifact show <thread-id>  Show a finalized artifact and its frozen lineage',
        '  skill install [n]   Install skills into Claude and Codex',
        '      --locally       Install skills into ./.claude and ./.codex for this cwd',
        '  index               Incremental session index',
        '  reindex             Full session reindex',
        '  discover            Discover sessions from adapters',
        '',
        'Studio options:',
        '  --no-update-check   Skip the startup npm version check',
        '  --no-skill-check    Skip the startup skill freshness check',
      ].join('\n'),
    );
    return 0;
  }

  if (cmd !== 'studio' && cmd !== 'start') {
    throw new Error(`unknown command: ${cmd}`);
  }

  const explicitPort = flags.port != null;
  const port = explicitPort ? parseInt(String(flags.port), 10) : 4242;

  if (!flags['no-update-check'] && process.env[SKIP_UPDATE_CHECK_ENV] !== '1') {
    const update = await checkNpmUpdateForStudio(argv, io);
    if (update.restarted) return update.exitCode;
  }

  if (!flags['no-skill-check']) {
    await checkSkillsForStudio(io, { cwd: process.cwd() });
  }

  // Run discovery synchronously so the UI immediately shows sessions.
  io.stdout.log('[superdense] discovering sessions...');
  const d = await runDiscovery();
  io.stdout.log(`[superdense] discovered ${d.discovered} sessions.`);

  const { url } = await startServer({
    port,
    host: '127.0.0.1',
    ...(explicitPort ? {} : { portFallbackAttempts: 50 }),
  });
  io.stdout.log(`[superdense] ${url}`);

  // Background: run query evaluation if any queries exist.
  runQueryEvaluation().catch((e) => io.stderr.error('[superdense] query eval failed:', e));

  if (!flags['no-open']) {
    open(url).catch(() => {
      /* ignore */
    });
  }

  return 0;
}

async function main(): Promise<void> {
  try {
    process.exitCode = await runCli(process.argv.slice(2));
  } catch (err) {
    printErrorJson(err, { stdout: console, stderr: console, isTty: process.stderr.isTTY });
    process.exitCode = 1;
  }
}

function isMainModule(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  const here = fileURLToPath(import.meta.url);
  if (entry === here) return true;
  try {
    return realpathSync(entry) === here;
  } catch {
    return false;
  }
}

if (isMainModule()) {
  main();
}

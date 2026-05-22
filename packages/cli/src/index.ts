#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { cpSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  backfillQuery,
  CLAUDE_SKILLS_DIR,
  compactSession,
  CODEX_SKILLS_DIR,
  countQueryMatches,
  countSessions,
  createQuery,
  deleteQuery,
  ensureRoad42Dirs,
  getCompactor,
  getEnrichment,
  getQuery,
  getSession,
  indexAll,
  listCompactors,
  listEnrichers,
  listFilterCatalog,
  listFilters,
  listQueries,
  listQueryMatchDetails,
  listSessionEnrichments,
  listSessions,
  loadUserEnrichers,
  previewQuery,
  runDiscovery,
  runQueryEvaluation,
  validateQueryDefinition,
  type Compactor,
  type QueryMatchDetail,
  type QueryDefinition,
  type Session,
} from '@road42/core';
import { startServer } from '@road42/server';
import open from 'open';

interface CliIo {
  stdout: Pick<typeof console, 'log'>;
  stderr: Pick<typeof console, 'error'>;
  isTty?: boolean;
}

function parseArgs(argv: string[]): { cmd: string; args: string[]; flags: Record<string, string | boolean> } {
  const flags: Record<string, string | boolean> = {};
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq > -1) flags[a.slice(2, eq)] = a.slice(eq + 1);
      else if (argv[i + 1] && !argv[i + 1]!.startsWith('--')) { flags[a.slice(2)] = argv[++i]!; }
      else flags[a.slice(2)] = true;
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
  io.stderr.error(JSON.stringify({
    error: err instanceof Error ? err.message : String(err),
    code: err instanceof Error ? err.name : 'Error',
  }));
}

function intFlag(flags: Record<string, string | boolean>, name: string, fallback: number, max?: number): number {
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

function serializeSession(session: Session, opts: { includePath?: boolean } = {}): Record<string, unknown> {
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
    fileMtime: session.fileMtime ?? null,
    lastIndexedAt: session.lastIndexedAt ?? null,
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

async function handleQuery(args: string[], flags: Record<string, string | boolean>, io: CliIo): Promise<boolean> {
  const action = args[0] ?? 'list';
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
    printJson({
      ...q,
      total: countQueryMatches(id),
      limit,
      offset,
      items: details.map((m) => serializeQueryMatch(m, { includePath: includePath(flags) })),
      members: details.map((m) => serializeSession(m.session, { includePath: includePath(flags) })),
    }, io);
    return true;
  }
  if (action === 'create') {
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
    await backfillQuery(id);
    printJson(getQuery(id), io);
    return true;
  }
  if (action === 'preview') {
    const definition = await readQueryDefinition(flags.query);
    await validateCliQueryDefinition(definition);
    const limit = intFlag(flags, 'limit', 500, 1000);
    const result = await previewQuery(definition, { limit });
    printJson({
      ...result,
      limit,
      items: result.items.map((item) => {
        const session = getSession(item.sessionId);
        return {
          sessionId: item.sessionId,
          session: session ? serializeSession(session, { includePath: includePath(flags) }) : null,
          evidence: item.evidence ?? null,
          enrichments: item.enrichments ?? {},
        };
      }),
    }, io);
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
    const id = args[1];
    if (!id) throw new Error('query run requires <id>');
    await loadUserEnrichers();
    const result = await backfillQuery(id);
    if (!result) throw new Error(`query not found: ${id}`);
    const q = getExistingQuery(id);
    const limit = intFlag(flags, 'limit', 200, 1000);
    const offset = intFlag(flags, 'offset', 0);
    const details = listQueryMatchDetails(id, { limit, offset });
    const resultBySession = new Map(result.items.map((item) => [item.sessionId, item] as const));
    printJson({
      query: q,
      matched: result.matched,
      total: countQueryMatches(id),
      limit,
      offset,
      items: details.map((m) => serializeQueryMatch(m, {
        includePath: includePath(flags),
        enrichments: resultBySession.get(m.session.id)?.enrichments ?? {},
      })),
    }, io);
    return true;
  }
  throw new Error(`unknown query command: ${action}`);
}

async function handleSession(args: string[], flags: Record<string, string | boolean>, io: CliIo): Promise<boolean> {
  const action = args[0] ?? 'list';
  if (action === 'list') {
    const limit = intFlag(flags, 'limit', 200, 1000);
    const offset = intFlag(flags, 'offset', 0);
    const filter = {
      agent: typeof flags.agent === 'string' ? flags.agent : undefined,
      pwd: typeof flags.pwd === 'string' ? flags.pwd : undefined,
      q: typeof flags.q === 'string' ? flags.q : undefined,
      limit,
      offset,
    };
    printJson({
      items: listSessions(filter).map((s) => serializeSession(s, { includePath: includePath(flags) })),
      total: countSessions(filter),
      limit,
      offset,
    }, io);
    return true;
  }
  if (action === 'show') {
    const id = args[1];
    if (!id) throw new Error('session show requires <session-id>');
    printJson({ session: serializeSession(getExistingSession(id), { includePath: includePath(flags) }) }, io);
    return true;
  }
  if (action === 'path') {
    const id = args[1];
    if (!id) throw new Error('session path requires <session-id>');
    const session = getExistingSession(id);
    printJson({
      id: session.id,
      agent: session.agent,
      sessionId: session.sessionId,
      logPath: session.logPath,
    }, io);
    return true;
  }
  if (action === 'fields') {
    await loadUserEnrichers();
    printJson({
      filters: await listFilterCatalog(),
      enrichers: listEnrichers().map(({ name, version, returns, jsonSchema, description }) => ({
        name,
        version,
        returns,
        jsonSchema,
        description,
      })),
    }, io);
    return true;
  }
  if (action === 'enrichments') {
    const id = args[1];
    if (!id) throw new Error('session enrichments requires <session-id>');
    const session = getExistingSession(id);
    let items;
    if (typeof flags.name === 'string' && flags.name.trim()) {
      const item = getEnrichment(id, flags.name.trim());
      items = item ? [{ name: flags.name.trim(), ...item }] : [];
    } else {
      items = listSessionEnrichments(id);
    }
    printJson({
      session: serializeSession(session, { includePath: includePath(flags) }),
      items,
    }, io);
    return true;
  }
  throw new Error(`unknown session command: ${action}`);
}

async function handleCompactor(args: string[], flags: Record<string, string | boolean>, io: CliIo): Promise<boolean> {
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
    printJson({
      session: serializeSession(session, { includePath: includePath(flags) }),
      compactor: serializeCompactor(compactor),
      result,
    }, io);
    return true;
  }
  throw new Error(`unknown compactor command: ${action}`);
}

async function handleEnricher(args: string[], io: CliIo): Promise<boolean> {
  const action = args[0] ?? 'list';
  await loadUserEnrichers();
  if (action === 'list') {
    printJson({
      items: listEnrichers().map(({ name, version, returns, jsonSchema, description }) => ({
        name,
        version,
        returns,
        jsonSchema,
        description,
      })),
    }, io);
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

function handleSkillInstall(args: string[], io: CliIo): void {
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const skillsRoot = [
    join(moduleDir, 'skills'),
    join(moduleDir, '..', '..', '..', 'skills'),
  ].find((candidate) => existsSync(candidate));
  if (!skillsRoot) throw new Error(`skills directory not found: ${join(moduleDir, 'skills')}`);

  const targetNames = args[0]
    ? [args[0]]
    : readdirSync(skillsRoot).filter((entry) => statSync(join(skillsRoot, entry)).isDirectory());

  const installed: Array<{ name: string; claude: string; codex: string }> = [];

  for (const name of targetNames) {
    const src = join(skillsRoot, name);
    if (!existsSync(src) || !statSync(src).isDirectory()) {
      throw new Error(`skill not found: ${name}`);
    }

    const claudeDest = join(process.env.CLAUDE_SKILLS_DIR ?? CLAUDE_SKILLS_DIR, name);
    mkdirSync(claudeDest, { recursive: true });
    cpSync(src, claudeDest, { recursive: true });

    const codexDest = join(process.env.CODEX_SKILLS_DIR ?? CODEX_SKILLS_DIR, name);
    cpSync(src, codexDest, { recursive: true });

    installed.push({ name, claude: claudeDest, codex: codexDest });
  }

  printJson({ installed }, io);
}

export async function runCli(argv: string[], io: CliIo = {
  stdout: console,
  stderr: console,
  isTty: process.stdout.isTTY,
}): Promise<number> {
  ensureRoad42Dirs();
  const { cmd, args, flags } = parseArgs(argv);

  if (cmd === 'skill') {
    const action = args[0];
    if (action !== 'install') throw new Error(`unknown skill command: ${action ?? '(none)'}`);
    handleSkillInstall(args.slice(1), io);
    return 0;
  }

  if (cmd === 'query') {
    await handleQuery(args, flags, io);
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

  if (cmd === 'index') {
    io.stdout.log('[road42] running incremental index...');
    await indexAll({ full: !!flags.full });
    io.stdout.log('[road42] done.');
    return 0;
  }

  if (cmd === 'reindex') {
    io.stdout.log('[road42] running full reindex...');
    await indexAll({ full: true });
    io.stdout.log('[road42] done.');
    return 0;
  }

  if (cmd === 'discover') {
    const r = await runDiscovery();
    io.stdout.log(`[road42] discovered ${r.discovered} sessions.`);
    return 0;
  }

  if (cmd === 'help') {
    io.stdout.log([
      'Usage: road42 <command> [options]',
      '',
      'Commands:',
      '  start|studio        Start the Road42 web UI',
      '  session list        List indexed sessions',
      '  session show <id>   Show session metadata',
      '  session path <id>   Get raw log file path',
      '  session fields      List filters and enrichers',
      '  session enrichments <id>  Get computed enrichments',
      '  filter list         List available filters',
      '  filter show <n>     Show filter params and examples',
      '  query list          List saved queries',
      '  query show <id>     Show query with matching sessions',
      '  query create        Create a new query',
      '  query preview       Preview matching sessions',
      '  query run <id>      Evaluate and return results',
      '  query delete <id>   Delete a query',
      '  compactor list      List available compactors',
      '  compactor show <n>  Show compactor details',
      '  compactor run <n> <id>  Run a compactor on a session',
      '  enricher list       List available enrichers',
      '  enricher show <n>   Show enricher details',
      '  skill install [n]   Install skills into Claude and Codex',
      '  index               Incremental session index',
      '  reindex             Full session reindex',
      '  discover            Discover sessions from adapters',
    ].join('\n'));
    return 0;
  }

  if (cmd !== 'studio' && cmd !== 'start') {
    throw new Error(`unknown command: ${cmd}`);
  }

  const port = flags.port ? parseInt(String(flags.port), 10) : 4242;

  // Run discovery synchronously so the UI immediately shows sessions.
  io.stdout.log('[road42] discovering sessions...');
  const d = await runDiscovery();
  io.stdout.log(`[road42] discovered ${d.discovered} sessions.`);

  const { url } = await startServer({ port, host: '127.0.0.1' });
  io.stdout.log(`[road42] ${url}`);

  // Background: run query evaluation if any queries exist.
  runQueryEvaluation().catch((e) => io.stderr.error('[road42] query eval failed:', e));

  if (!flags['no-open']) {
    open(url).catch(() => { /* ignore */ });
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

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}

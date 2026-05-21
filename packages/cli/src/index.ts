#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import {
  backfillQuery,
  createQuery,
  deleteQuery,
  ensureRoad42Dirs,
  getQuery,
  indexAll,
  listEnrichers,
  listQueries,
  listQueryMatches,
  loadUserEnrichers,
  previewPredicate,
  runDiscovery,
  runQueryEvaluation,
  validatePredicate,
  type Predicate,
} from '@road42/core';
import { startServer } from '@road42/server';
import open from 'open';

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
  return { cmd: positional[0] ?? 'start', args: positional.slice(1), flags };
}

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, process.stdout.isTTY ? 2 : 0));
}

async function readPredicate(input: string | boolean | undefined): Promise<Predicate> {
  if (typeof input !== 'string' || !input.trim()) throw new Error('--predicate is required');
  const raw = input.startsWith('@') ? await readFile(input.slice(1), 'utf8') : input;
  return JSON.parse(raw) as Predicate;
}

async function validateCliPredicate(predicate: Predicate): Promise<void> {
  await loadUserEnrichers();
  validatePredicate(predicate, { enrichers: listEnrichers() });
}

async function handleQuery(args: string[], flags: Record<string, string | boolean>): Promise<boolean> {
  const action = args[0] ?? 'list';
  if (action === 'list') {
    printJson({ items: listQueries() });
    return true;
  }
  if (action === 'show') {
    const id = args[1];
    if (!id) throw new Error('query show requires <id>');
    const q = getQuery(id);
    if (!q) throw new Error(`query not found: ${id}`);
    printJson({ ...q, members: listQueryMatches(id) });
    return true;
  }
  if (action === 'create') {
    if (typeof flags.name !== 'string' || !flags.name.trim()) throw new Error('--name is required');
    const predicate = await readPredicate(flags.predicate);
    await validateCliPredicate(predicate);
    const id = randomUUID();
    createQuery({ id, name: flags.name.trim(), predicate, createdAt: Date.now() });
    await backfillQuery(id);
    printJson(getQuery(id));
    return true;
  }
  if (action === 'preview') {
    const predicate = await readPredicate(flags.predicate);
    await validateCliPredicate(predicate);
    printJson(await previewPredicate(predicate, {
      limit: typeof flags.limit === 'string' ? Number(flags.limit) : undefined,
    }));
    return true;
  }
  if (action === 'delete') {
    const id = args[1];
    if (!id) throw new Error('query delete requires <id>');
    deleteQuery(id);
    printJson({ ok: true });
    return true;
  }
  if (action === 'run') {
    const id = args[1];
    if (!id) throw new Error('query run requires <id>');
    const result = await backfillQuery(id);
    if (!result) throw new Error(`query not found: ${id}`);
    printJson(result);
    return true;
  }
  throw new Error(`unknown query command: ${action}`);
}

async function handleEnricher(args: string[]): Promise<boolean> {
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
    });
    return true;
  }
  if (action === 'show') {
    const name = args[1];
    if (!name) throw new Error('enricher show requires <name>');
    const e = listEnrichers().find((x) => x.name === name);
    if (!e) throw new Error(`enricher not found: ${name}`);
    const { run: _run, ...serializable } = e;
    printJson(serializable);
    return true;
  }
  throw new Error(`unknown enricher command: ${action}`);
}

async function main(): Promise<void> {
  ensureRoad42Dirs();
  const { cmd, args, flags } = parseArgs(process.argv.slice(2));

  if (cmd === 'query') {
    await handleQuery(args, flags);
    return;
  }

  if (cmd === 'enricher') {
    await handleEnricher(args);
    return;
  }

  if (cmd === 'index') {
    console.log('[road42] running incremental index...');
    await indexAll({ full: !!flags.full });
    console.log('[road42] done.');
    return;
  }

  if (cmd === 'reindex') {
    console.log('[road42] running full reindex...');
    await indexAll({ full: true });
    console.log('[road42] done.');
    return;
  }

  if (cmd === 'discover') {
    const r = await runDiscovery();
    console.log(`[road42] discovered ${r.discovered} sessions.`);
    return;
  }

  if (cmd !== 'start') {
    console.error(`unknown command: ${cmd}`);
    process.exit(1);
  }

  const port = flags.port ? parseInt(String(flags.port), 10) : 4242;

  // Run discovery synchronously so the UI immediately shows sessions.
  console.log('[road42] discovering sessions...');
  const d = await runDiscovery();
  console.log(`[road42] discovered ${d.discovered} sessions.`);

  const { url } = await startServer({ port, host: '127.0.0.1' });
  console.log(`[road42] ${url}`);

  // Background: run query evaluation if any queries exist.
  runQueryEvaluation().catch((e) => console.error('[road42] query eval failed:', e));

  if (!flags['no-open']) {
    open(url).catch(() => { /* ignore */ });
  }
}

main().catch((err) => {
  if (process.stderr.isTTY) console.error(err);
  else console.error(JSON.stringify({ error: err instanceof Error ? err.message : String(err), code: err?.name ?? 'Error' }));
  process.exit(1);
});

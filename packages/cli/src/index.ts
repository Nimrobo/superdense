#!/usr/bin/env node
import { ensureRoad42Dirs, indexAll, runDiscovery, runGroupEvaluation } from '@road42/core';
import { startServer } from '@road42/server';
import open from 'open';

function parseArgs(argv: string[]): { cmd: string; flags: Record<string, string | boolean> } {
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
  return { cmd: positional[0] ?? 'start', flags };
}

async function main(): Promise<void> {
  ensureRoad42Dirs();
  const { cmd, flags } = parseArgs(process.argv.slice(2));

  if (cmd === 'index') {
    console.log('[road42] running incremental index…');
    await indexAll({ full: !!flags.full });
    console.log('[road42] done.');
    return;
  }

  if (cmd === 'reindex') {
    console.log('[road42] running full reindex…');
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
  console.log('[road42] discovering sessions…');
  const d = await runDiscovery();
  console.log(`[road42] discovered ${d.discovered} sessions.`);

  const { url } = await startServer({ port, host: '127.0.0.1' });
  console.log(`[road42] ${url}`);

  // Background: run group evaluation if any groups exist.
  runGroupEvaluation().catch((e) => console.error('[road42] group eval failed:', e));

  if (!flags['no-open']) {
    open(url).catch(() => { /* ignore */ });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

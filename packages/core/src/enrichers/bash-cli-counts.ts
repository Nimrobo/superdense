import type { Enricher } from './types.js';

const BUILTINS = new Set([
  'cd', 'echo', 'export', 'unset', 'set', 'source', '.',
  'if', 'then', 'else', 'elif', 'fi',
  'for', 'while', 'do', 'done', 'case', 'esac', 'select', 'until',
  'function', 'return', 'break', 'continue',
  'true', 'false', ':',
  'read', 'eval', 'exec', 'shift', 'test', '[', '[[',
  'alias', 'unalias', 'local', 'declare', 'typeset', 'readonly',
  'pwd', 'time', 'trap', 'wait', 'jobs', 'bg', 'fg', 'kill',
]);

function extractCli(command: string): string | null {
  let s = command.trim();
  if (!s) return null;

  // Strip leading sudo (with optional flags)
  while (/^sudo(\s|$)/.test(s)) {
    s = s.replace(/^sudo(\s+-[A-Za-z]+)*\s*/, '');
  }

  // Strip leading "env [VAR=val ...]"
  if (/^env(\s|$)/.test(s)) {
    s = s.replace(/^env\s+/, '');
    while (/^[A-Za-z_][A-Za-z0-9_]*=\S*/.test(s)) {
      s = s.replace(/^[A-Za-z_][A-Za-z0-9_]*=\S*\s*/, '');
    }
  }

  // Strip leading inline assignments e.g. "FOO=bar baz cmd …"
  while (/^[A-Za-z_][A-Za-z0-9_]*=\S*\s/.test(s)) {
    s = s.replace(/^[A-Za-z_][A-Za-z0-9_]*=\S*\s+/, '');
  }

  const first = s.split(/\s+/)[0];
  if (!first) return null;

  // Basename of any absolute or relative path
  const base = first.split('/').pop() ?? first;

  if (!base || BUILTINS.has(base)) return null;
  // Reject things that don't look like command names
  if (!/^[A-Za-z0-9_.+-]+$/.test(base)) return null;

  return base;
}

function splitSegments(command: string): string[] {
  // Split on ; && || | — character-by-character to avoid breaking inside quotes.
  const out: string[] = [];
  let buf = '';
  let inSingle = false;
  let inDouble = false;
  let i = 0;
  while (i < command.length) {
    const c = command[i]!;
    const n = command[i + 1];
    if (!inDouble && c === "'") { inSingle = !inSingle; buf += c; i++; continue; }
    if (!inSingle && c === '"') { inDouble = !inDouble; buf += c; i++; continue; }
    if (!inSingle && !inDouble) {
      if (c === '\\' && n) { buf += c + n; i += 2; continue; }
      if (c === ';') { out.push(buf); buf = ''; i++; continue; }
      if (c === '&' && n === '&') { out.push(buf); buf = ''; i += 2; continue; }
      if (c === '|' && n === '|') { out.push(buf); buf = ''; i += 2; continue; }
      if (c === '|') { out.push(buf); buf = ''; i++; continue; }
    }
    buf += c;
    i++;
  }
  if (buf.trim()) out.push(buf);
  return out;
}

export function clisFromCommand(command: string): string[] {
  const found: string[] = [];
  for (const seg of splitSegments(command)) {
    const cli = extractCli(seg);
    if (cli) found.push(cli);
  }
  return found;
}

export const bashCliCountsEnricher: Enricher = {
  name: 'bash_cli_counts',
  version: 1,
  returns: 'json',
  alwaysRun: true,
  description: 'Map from CLI program (e.g. "git", "gh", "npm") to invocation count across Bash tool calls in the session.',
  async run(ctx) {
    const counts: Record<string, number> = {};
    for await (const ev of ctx.iterEvents(ctx.logPath)) {
      if (ev.toolName !== 'Bash' || !ev.inputText) continue;
      let cmd: string | null = null;
      try {
        const parsed = JSON.parse(ev.inputText) as { command?: unknown };
        if (typeof parsed.command === 'string') cmd = parsed.command;
      } catch {
        // inputText may be the raw command string itself
        cmd = ev.inputText;
      }
      if (!cmd) continue;
      for (const cli of clisFromCommand(cmd)) {
        counts[cli] = (counts[cli] ?? 0) + 1;
      }
    }
    return counts;
  },
};

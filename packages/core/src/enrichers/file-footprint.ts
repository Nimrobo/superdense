import type { TranscriptEvent } from '../types.js';
import { extractPath } from './fingerprint.js';
import {
  classifyRole,
  READ_TOOLS,
  resolveFilePath,
  WRITE_TOOLS,
  writePathsFromShell,
  type FileRole,
} from './footprint-util.js';
import type { Enricher, EnricherContext } from './types.js';

/** Tool names (across adapters) that carry a shell command string we parse for writes. */
const SHELL_TOOLS = new Set([
  'Bash',
  'shell',
  'exec',
  'exec_command',
  'local_shell',
  'run_terminal_cmd',
]);

export interface FootprintEntry {
  pathRel: string;
  pathAbs: string;
  role: FileRole;
  writes: number;
  reads: number;
  ops: Record<string, number>;
  firstTs: number | null;
  lastTs: number | null;
}

export interface Footprint {
  v: 1;
  files: FootprintEntry[];
}

function commandFromEvent(ev: TranscriptEvent): string | null {
  if (!ev.inputText) return null;
  try {
    const p = JSON.parse(ev.inputText) as Record<string, unknown>;
    if (typeof p.command === 'string') return p.command;
    if (Array.isArray(p.command)) return p.command.join(' ');
    if (typeof p.cmd === 'string') return p.cmd;
    if (typeof p.input === 'string') return p.input;
    return ev.inputText;
  } catch {
    return ev.inputText;
  }
}

/**
 * Walk a session's events into a per-path write/read footprint. Structured
 * Edit/Write/Read tools (claude-code) give exact paths; shell agents (codex)
 * write via apply_patch/redirects which we best-effort parse. Paths are
 * pwd-relativized so worktree copies collapse to one identity.
 */
export async function collectFootprint(ctx: EnricherContext): Promise<Footprint> {
  const pwd = ctx.session.pwd ?? '';
  const byRel = new Map<string, FootprintEntry>();

  const touch = (raw: string, op: string, isWrite: boolean, ts?: number): void => {
    if (!raw) return;
    const { pathAbs, pathRel } = resolveFilePath(raw, pwd);
    let e = byRel.get(pathRel);
    if (!e) {
      e = {
        pathRel,
        pathAbs,
        role: classifyRole(pathAbs, pathRel, pwd),
        writes: 0,
        reads: 0,
        ops: {},
        firstTs: null,
        lastTs: null,
      };
      byRel.set(pathRel, e);
    }
    if (isWrite) e.writes++;
    else e.reads++;
    e.ops[op] = (e.ops[op] ?? 0) + 1;
    if (ts != null) {
      if (e.firstTs == null || ts < e.firstTs) e.firstTs = ts;
      if (e.lastTs == null || ts > e.lastTs) e.lastTs = ts;
    }
  };

  for await (const ev of ctx.iterEvents(ctx.logPath)) {
    if (ev.kind !== 'tool_call' || !ev.toolName) continue;
    const tool = ev.toolName;
    if (WRITE_TOOLS.has(tool)) {
      const p = extractPath(ev);
      if (p) touch(p, tool, true, ev.ts);
    } else if (READ_TOOLS.has(tool)) {
      const p = extractPath(ev);
      if (p) touch(p, tool, false, ev.ts);
    } else if (SHELL_TOOLS.has(tool) || tool === 'apply_patch') {
      const cmd = commandFromEvent(ev);
      if (cmd) {
        for (const p of writePathsFromShell(cmd)) touch(p, 'shell', true, ev.ts);
      }
    }
  }

  return { v: 1, files: [...byRel.values()] };
}

export const fileFootprintEnricher: Enricher = {
  name: 'file_footprint',
  version: 3,
  returns: 'json',
  alwaysRun: true,
  description:
    'Per-session write/read footprint: each touched file with a pwd-relativized path, role (deliverable/generated/scaffold/external), write/read counts, and op breakdown. The join surface for artifact discovery.',
  async run(ctx) {
    return collectFootprint(ctx);
  },
};

import { homedir } from 'node:os';
import { join } from 'node:path';
import { readdir, readFile, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import type { Adapter, DiscoveredSession, DiscoveredSubAgent, TranscriptEvent } from '../types.js';
import { extractFirstMeaningfulPrompt, extractMeaningfulPrompt } from './prompt.js';

function claudeProjectsDir(): string {
  return process.env.CLAUDE_PROJECTS_DIR ?? join(homedir(), '.claude', 'projects');
}

interface IndexEntry {
  sessionId: string;
  fullPath: string;
  fileMtime?: number;
  firstPrompt?: string;
  summary?: string;
  messageCount?: number;
  created?: string;
  modified?: string;
  gitBranch?: string;
  projectPath?: string;
  isSidechain?: boolean;
}

interface IndexFile {
  version: number;
  entries: IndexEntry[];
}

function toMs(s?: string): number | undefined {
  if (!s) return undefined;
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : undefined;
}

export function decodeProjectDir(dir: string): string {
  // Claude Code encodes a project path by replacing "/" with "-". This is
  // lossy whenever the original path contains hyphens. Prefer the real cwd
  // from inside the JSONL transcript (see scanJsonlHead); only use this as a
  // last-resort fallback.
  if (!dir.startsWith('-')) return dir;
  return '/' + dir.slice(1).split('-').join('/');
}

interface JsonlHead {
  firstPrompt?: string;
  cwd?: string;
  agentId?: string;
  slug?: string;
  gitBranch?: string;
}

export async function scanJsonlHead(logPath: string, maxLines = 50): Promise<JsonlHead> {
  return new Promise((resolve) => {
    let lines = 0;
    const result: JsonlHead = {};
    let stream;
    try {
      stream = createReadStream(logPath, { encoding: 'utf8' });
    } catch {
      resolve(result);
      return;
    }
    const rl = createInterface({ input: stream, crlfDelay: Infinity });
    const done = (): void => {
      try {
        rl.close();
        stream.destroy();
      } catch {
        /* ignore */
      }
      resolve(result);
    };
    rl.on('line', (line) => {
      if (++lines > maxLines) {
        done();
        return;
      }
      if (!line.trim()) return;
      try {
        const obj = JSON.parse(line);
        if (!result.cwd && typeof obj?.cwd === 'string' && obj.cwd.startsWith('/')) {
          result.cwd = obj.cwd;
        }
        if (!result.agentId && typeof obj?.agentId === 'string' && obj.agentId) {
          result.agentId = obj.agentId;
        }
        if (!result.slug && typeof obj?.slug === 'string' && obj.slug) {
          result.slug = obj.slug;
        }
        // gitBranch rides on each message line (same line as cwd) — the
        // historical branch at session time, present far more often than
        // sessions-index.json captures it.
        if (!result.gitBranch && typeof obj?.gitBranch === 'string' && obj.gitBranch) {
          result.gitBranch = obj.gitBranch;
        }
        if (!result.firstPrompt) {
          const m = obj?.message;
          if (obj?.type === 'user' || m?.role === 'user') {
            const content = m?.content;
            if (typeof content === 'string') {
              result.firstPrompt = extractMeaningfulPrompt(content);
            } else if (Array.isArray(content)) {
              result.firstPrompt = extractFirstMeaningfulPrompt(
                content.map((part) =>
                  part?.type === 'text' && typeof part.text === 'string' ? part.text : undefined,
                ),
              );
            }
          }
        }
        if (result.cwd && result.firstPrompt) done();
      } catch {
        /* ignore */
      }
    });
    rl.on('close', () => resolve(result));
    rl.on('error', () => resolve(result));
  });
}

export const claudeCodeAdapter: Adapter = {
  name: 'claude-code',

  async discover(): Promise<DiscoveredSession[]> {
    const out: DiscoveredSession[] = [];
    const seen = new Set<string>();
    const projectsDir = claudeProjectsDir();
    let projectDirs: string[];
    try {
      projectDirs = await readdir(projectsDir);
    } catch {
      return out;
    }
    for (const dir of projectDirs) {
      const projectPath = join(projectsDir, dir);
      const pwdGuess = decodeProjectDir(dir);
      // Resolved once per project dir from the first JSONL we successfully
      // scan: every transcript under a Claude Code project dir shares the
      // same cwd, so we don't need to re-derive it per file.
      let projectCwd: string | undefined;

      // 1) sessions-index.json (Claude Code's own index, when present)
      try {
        const raw = await readFile(join(projectPath, 'sessions-index.json'), 'utf8');
        const parsed = JSON.parse(raw) as IndexFile;
        for (const e of parsed.entries ?? []) {
          if (!e.sessionId || !e.fullPath) continue;
          // Skip sub-agent transcripts — they live inside a subagents/ directory.
          if (e.fullPath.includes('/subagents/')) continue;
          seen.add(e.sessionId);
          let pwd = e.projectPath;
          let firstPrompt = extractMeaningfulPrompt(e.firstPrompt);
          let gitBranch = e.gitBranch;
          // Scan the transcript head when the index is missing pwd, the prompt,
          // or the branch — the branch is absent from the index for ~84% of
          // claude-code sessions but rides on the transcript message lines.
          if (!pwd || !firstPrompt || !gitBranch) {
            const head = await scanJsonlHead(e.fullPath);
            if (!projectCwd && head.cwd) projectCwd = head.cwd;
            if (!pwd) pwd = projectCwd ?? pwdGuess;
            firstPrompt = firstPrompt ?? head.firstPrompt;
            gitBranch = gitBranch ?? head.gitBranch;
          }
          out.push({
            sessionId: e.sessionId,
            logPath: e.fullPath,
            pwd,
            firstPrompt,
            summary: e.summary,
            messageCount: e.messageCount,
            gitBranch,
            createdAt: toMs(e.created),
            modifiedAt: toMs(e.modified) ?? e.fileMtime,
            isSidechain: e.isSidechain,
            raw: e,
          });
        }
      } catch {
        /* no index file — fall through */
      }

      // 2) Any top-level *.jsonl files in the project dir that weren't covered.
      let files: string[];
      try {
        files = await readdir(projectPath);
      } catch {
        continue;
      }
      for (const f of files) {
        if (!f.endsWith('.jsonl')) continue;
        const sessionId = f.slice(0, -'.jsonl'.length);
        if (seen.has(sessionId)) continue;
        const logPath = join(projectPath, f);
        let mtime: number | undefined;
        try {
          mtime = (await stat(logPath)).mtimeMs;
        } catch {
          continue;
        }
        const head = await scanJsonlHead(logPath);
        if (!projectCwd && head.cwd) projectCwd = head.cwd;
        out.push({
          sessionId,
          logPath,
          pwd: head.cwd ?? projectCwd ?? pwdGuess,
          firstPrompt: head.firstPrompt,
          gitBranch: head.gitBranch,
          createdAt: mtime,
          modifiedAt: mtime,
        });
        seen.add(sessionId);
      }
    }
    return out;
  },

  async discoverSubAgentSessions(parentSessionId: string): Promise<DiscoveredSubAgent[]> {
    const projectsDir = claudeProjectsDir();
    let projectDirs: string[];
    try {
      projectDirs = await readdir(projectsDir);
    } catch {
      return [];
    }

    for (const dir of projectDirs) {
      const projectPath = join(projectsDir, dir);
      const subagentsDir = join(projectPath, parentSessionId, 'subagents');
      let agentFiles: string[];
      try {
        agentFiles = await readdir(subagentsDir);
      } catch {
        continue;
      }

      const pwdGuess = decodeProjectDir(dir);
      const out: DiscoveredSubAgent[] = [];

      for (const f of agentFiles) {
        if (!f.endsWith('.jsonl')) continue;
        const logPath = join(subagentsDir, f);
        let mtime: number | undefined;
        try {
          mtime = (await stat(logPath)).mtimeMs;
        } catch {
          continue;
        }
        const head = await scanJsonlHead(logPath);
        // agentId from filename: "agent-<id>.jsonl" → "<id>"; also from JSONL head
        const filenameAgentId = f.startsWith('agent-')
          ? f.slice('agent-'.length, -'.jsonl'.length)
          : f.slice(0, -'.jsonl'.length);
        const agentId = head.agentId ?? filenameAgentId;
        const slug = head.slug;
        // Child sessionId: "<parentSessionId>:agent-<agentId>"
        const sessionId = `${parentSessionId}:agent-${agentId}`;
        out.push({
          session: {
            sessionId,
            logPath,
            pwd: head.cwd ?? pwdGuess,
            firstPrompt: head.firstPrompt,
            gitBranch: head.gitBranch,
            createdAt: mtime,
            modifiedAt: mtime,
          },
          relation: 'subagent',
          metadata: slug ? { agentId, slug } : { agentId },
        });
      }

      if (out.length > 0) return out;
    }

    return [];
  },

  iterEvents(logPath: string): AsyncIterable<TranscriptEvent> {
    return iterJsonlEvents(logPath);
  },

  sourceMtime(session: DiscoveredSession): Promise<number | undefined> {
    return statLogFile(session.logPath);
  },
};

export async function statLogFile(logPath: string): Promise<number | undefined> {
  try {
    const s = await stat(logPath);
    return s.mtimeMs;
  } catch {
    return undefined;
  }
}

async function* iterJsonlEvents(logPath: string): AsyncIterable<TranscriptEvent> {
  let stream;
  try {
    stream = createReadStream(logPath, { encoding: 'utf8' });
  } catch {
    return;
  }
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  let lastMode: string | undefined;
  // Some Claude rows carry permissionMode without a timestamp (e.g. dedicated
  // {"type":"permission-mode",...} rows). Defer emitting mode_change until we
  // have a real timestamp to anchor the enricher's duration math; if the
  // session ends with a pending transition, flush it at EOF using the last
  // observed timestamp so the exit is not lost.
  let pendingMode: string | undefined;
  let lastTs: number | undefined;
  // Supplemental detector: Claude Code SDK-entrypoint sessions never flip
  // permissionMode even when the user approves an ExitPlanMode call. The
  // authoritative signal is the row's top-level `toolUseResult` field: an
  // object `{ plan: string, ... }` on approval, a string on rejection.
  const exitPlanModeIds = new Set<string>();
  let currentMode: 'plan' | 'default' = 'default';
  try {
    for await (const line of rl) {
      if (!line.trim()) continue;
      let obj: any;
      try {
        obj = JSON.parse(line);
      } catch {
        continue;
      }
      const mode = typeof obj?.permissionMode === 'string' ? obj.permissionMode : undefined;
      const ts = obj?.timestamp ? Date.parse(obj.timestamp) : undefined;
      if (ts != null) lastTs = ts;
      if (mode) {
        if (mode !== lastMode) pendingMode = mode;
        else pendingMode = undefined;
      }
      if (pendingMode != null && ts != null) {
        yield { ts, kind: 'mode_change', mode: pendingMode, prevMode: lastMode };
        currentMode = pendingMode === 'plan' ? 'plan' : 'default';
        lastMode = pendingMode;
        pendingMode = undefined;
      }

      const tur = obj?.toolUseResult;
      const isApproval =
        tur != null &&
        typeof tur === 'object' &&
        !Array.isArray(tur) &&
        typeof (tur as any).plan === 'string';
      let resultIsExitPlanMode = false;
      const content = obj?.message?.content;
      if (Array.isArray(content)) {
        for (const part of content) {
          if (!part || typeof part !== 'object') continue;
          if (
            part.type === 'tool_result' &&
            typeof part.tool_use_id === 'string' &&
            exitPlanModeIds.has(part.tool_use_id)
          ) {
            resultIsExitPlanMode = true;
            break;
          }
        }
      }

      for (const ev of extractEvents(obj)) {
        if (
          ev.kind === 'tool_call' &&
          ev.toolName === 'ExitPlanMode' &&
          typeof ev.toolCallId === 'string'
        ) {
          exitPlanModeIds.add(ev.toolCallId);
          if (currentMode === 'default') {
            yield { ts: ev.ts, kind: 'mode_change', mode: 'plan', prevMode: 'default' };
            currentMode = 'plan';
            lastMode = 'plan';
          }
        }
        yield ev;
      }

      if (resultIsExitPlanMode && isApproval && currentMode === 'plan') {
        yield { ts, kind: 'mode_change', mode: 'default', prevMode: 'plan' };
        currentMode = 'default';
        lastMode = 'default';
      }
    }
    if (pendingMode != null && lastTs != null) {
      yield { ts: lastTs, kind: 'mode_change', mode: pendingMode, prevMode: lastMode };
    }
  } catch (err: any) {
    if (err?.code !== 'ENOENT') throw err;
  }
}

function* extractEvents(obj: any): Generator<TranscriptEvent> {
  const ts = obj?.timestamp ? Date.parse(obj.timestamp) : undefined;
  const role: TranscriptEvent['role'] | undefined =
    obj?.type === 'user'
      ? 'user'
      : obj?.type === 'assistant'
        ? 'assistant'
        : obj?.type === 'system'
          ? 'system'
          : undefined;
  const message = obj?.message;
  const content = message?.content;
  // Text content
  if (typeof content === 'string') {
    yield { ts, kind: 'text', role, text: content, raw: obj };
    return;
  }
  if (Array.isArray(content)) {
    for (const part of content) {
      if (!part || typeof part !== 'object') continue;
      if (part.type === 'text' && typeof part.text === 'string') {
        yield { ts, kind: 'text', role, text: part.text };
      } else if (part.type === 'tool_use') {
        let inputText = '';
        try {
          inputText = JSON.stringify(part.input ?? {});
        } catch {
          inputText = '';
        }
        yield {
          ts,
          kind: 'tool_call',
          role,
          toolCallId: typeof part.id === 'string' ? part.id : undefined,
          toolName: typeof part.name === 'string' ? part.name : undefined,
          inputText,
        };
      } else if (part.type === 'tool_result') {
        let text = '';
        if (typeof part.content === 'string') text = part.content;
        else if (Array.isArray(part.content)) {
          text = part.content
            .map((c: any) => (typeof c?.text === 'string' ? c.text : ''))
            .join('\n');
        }
        yield {
          ts,
          kind: 'tool_result',
          role,
          toolCallId: typeof part.tool_use_id === 'string' ? part.tool_use_id : undefined,
          text,
          isError: typeof part.is_error === 'boolean' ? part.is_error : undefined,
        };
      }
    }
    return;
  }
}

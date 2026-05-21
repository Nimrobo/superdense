import type { TranscriptEvent } from '../types.js';
import type { Enricher } from './types.js';

const ERROR_RE = /\b([A-Za-z]+Error|error|exception|traceback|failed|fatal)\b/i;
const VERB_RE = /\b(add|fix|edit|update|refactor|test|commit|remove|delete|rename|implement|debug|review|investigate|create|write|build|run|check|merge|rebase|deploy|migrate|optimi[sz]e|document)\b/gi;

interface Fingerprint {
  v: 1;
  events: { text: number; tool_call: number; tool_result: number };
  tools: Record<string, number>;
  toolErrors: Record<string, number>;
  roles: { user: number; assistant: number; system: number };
  bytesByRole: { user: number; assistant: number; system: number };
  uniquePaths: number;
  verbs: Record<string, number>;
  durationMs: number;
  turns: number;
}

function extractPath(ev: TranscriptEvent): string | null {
  if (!ev.inputText) return null;
  try {
    const parsed = JSON.parse(ev.inputText) as Record<string, unknown>;
    const candidate = parsed.file_path ?? parsed.path ?? parsed.filePath ?? parsed.notebook_path;
    if (typeof candidate === 'string' && candidate.length > 0) return candidate;
  } catch {
    // not JSON, skip
  }
  return null;
}

export const fingerprintEnricher: Enricher = {
  name: 'fingerprint',
  version: 1,
  returns: 'json',
  alwaysRun: true,
  description: 'Fixed-shape statistical fingerprint of a session: event/tool counts, error counts, role byte totals, unique paths, verb mentions, duration, and turn count. Designed for cross-session aggregation.',
  async run(ctx) {
    const fp: Fingerprint = {
      v: 1,
      events: { text: 0, tool_call: 0, tool_result: 0 },
      tools: {},
      toolErrors: {},
      roles: { user: 0, assistant: 0, system: 0 },
      bytesByRole: { user: 0, assistant: 0, system: 0 },
      uniquePaths: 0,
      verbs: {},
      durationMs: 0,
      turns: 0,
    };

    const paths = new Set<string>();
    const callIdToTool = new Map<string, string>();
    let firstTs: number | undefined;
    let lastTs: number | undefined;

    for await (const ev of ctx.iterEvents(ctx.logPath)) {
      if (ev.ts != null) {
        if (firstTs == null || ev.ts < firstTs) firstTs = ev.ts;
        if (lastTs == null || ev.ts > lastTs) lastTs = ev.ts;
      }

      if (ev.kind === 'text') fp.events.text++;
      else if (ev.kind === 'tool_call') fp.events.tool_call++;
      else if (ev.kind === 'tool_result') fp.events.tool_result++;

      if (ev.role && ev.role in fp.roles) {
        fp.roles[ev.role]++;
        const bytes = (ev.text?.length ?? 0) + (ev.inputText?.length ?? 0);
        fp.bytesByRole[ev.role] += bytes;
      }

      if (ev.kind === 'tool_call' && ev.toolName) {
        fp.tools[ev.toolName] = (fp.tools[ev.toolName] ?? 0) + 1;
        if (ev.toolCallId) callIdToTool.set(ev.toolCallId, ev.toolName);
        const p = extractPath(ev);
        if (p) paths.add(p);
      }

      if (ev.kind === 'tool_result' && ev.text && ERROR_RE.test(ev.text)) {
        const tool = ev.toolCallId ? callIdToTool.get(ev.toolCallId) : undefined;
        const key = tool ?? '_unknown';
        fp.toolErrors[key] = (fp.toolErrors[key] ?? 0) + 1;
      }

      if (ev.role === 'user' && ev.kind === 'text') {
        fp.turns++;
        if (ev.text) {
          const matches = ev.text.match(VERB_RE);
          if (matches) {
            for (const m of matches) {
              const v = m.toLowerCase();
              fp.verbs[v] = (fp.verbs[v] ?? 0) + 1;
            }
          }
        }
      }
    }

    fp.uniquePaths = paths.size;
    fp.durationMs = firstTs != null && lastTs != null ? lastTs - firstTs : 0;
    return fp;
  },
};

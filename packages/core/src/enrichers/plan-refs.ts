import { planSlugFromPath } from '../paths.js';
import { extractPath } from './fingerprint.js';
import { WRITE_TOOLS } from './footprint-util.js';
import type { Enricher } from './types.js';

export interface PlanRef {
  slug: string;
  kind: 'wrote' | 'referenced';
}

const PLAN_PATH_RE = /\.claude\/plans\/([^/\s"']+?)\.md\b/g;

function slugsInText(text: string | null | undefined): string[] {
  if (!text) return [];
  const out: string[] = [];
  for (const m of text.matchAll(PLAN_PATH_RE)) out.push(m[1]!);
  return out;
}

/**
 * Extract named-plan anchors (`~/.claude/plans/<slug>.md`). Only claude-code
 * persists plan slugs; codex/cursor/opencode have plan-mode transitions but no
 * plan artifact, so they return nothing.
 */
export const planRefsEnricher: Enricher = {
  name: 'plan_refs',
  version: 1,
  returns: 'json',
  alwaysRun: true,
  description:
    'Named-plan anchors per session: slugs of ~/.claude/plans/<slug>.md the session wrote or referenced. Sessions sharing a slug are the same artifact.',
  async run(ctx) {
    if (ctx.session.agent !== 'claude-code') return { v: 1, refs: [] as PlanRef[] };

    const kinds = new Map<string, Set<'wrote' | 'referenced'>>();
    const add = (slug: string | null, kind: 'wrote' | 'referenced'): void => {
      if (!slug) return;
      const set = kinds.get(slug) ?? new Set();
      set.add(kind);
      kinds.set(slug, set);
    };

    for (const slug of slugsInText(ctx.session.firstPrompt)) add(slug, 'referenced');

    for await (const ev of ctx.iterEvents(ctx.logPath)) {
      if (ev.kind === 'tool_call' && ev.toolName && WRITE_TOOLS.has(ev.toolName)) {
        add(planSlugFromPath(extractPath(ev) ?? ''), 'wrote');
      }
      for (const slug of slugsInText(ev.inputText)) add(slug, 'referenced');
      for (const slug of slugsInText(ev.text)) add(slug, 'referenced');
    }

    const refs: PlanRef[] = [];
    for (const [slug, set] of kinds) {
      for (const kind of set) refs.push({ slug, kind });
    }
    return { v: 1, refs };
  },
};

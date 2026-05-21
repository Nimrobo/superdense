import { iterSessionEvents } from '../adapters/index.js';
import { listAllSessionsForBackfill } from '../db.js';
import { loadPlugins } from './index.js';

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
      const helpers = { iterEvents: () => iterSessionEvents(s) };
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

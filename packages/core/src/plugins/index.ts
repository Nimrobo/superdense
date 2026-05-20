import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { GroupingPlugin } from '../types.js';
import { USER_PLUGINS_DIR } from '../paths.js';
import { byPwd } from './by-pwd.js';
import { byToolKeyword } from './by-tool-keyword.js';
import { byPwdAndTool } from './by-pwd-and-tool.js';

const builtins: GroupingPlugin[] = [byPwd, byToolKeyword, byPwdAndTool];

let cache: GroupingPlugin[] | null = null;

export async function loadPlugins(): Promise<GroupingPlugin[]> {
  if (cache) return cache;
  const all: GroupingPlugin[] = [...builtins];
  let userFiles: string[] = [];
  try {
    userFiles = (await readdir(USER_PLUGINS_DIR)).filter((f) => f.endsWith('.js') || f.endsWith('.mjs'));
  } catch {
    userFiles = [];
  }
  for (const f of userFiles) {
    try {
      const mod = await import(pathToFileURL(join(USER_PLUGINS_DIR, f)).href);
      const plugin = (mod.default ?? mod.plugin) as GroupingPlugin | undefined;
      if (plugin?.name && typeof plugin.matches === 'function') {
        all.push(plugin);
      }
    } catch (err) {
      console.error(`[road42] failed to load plugin ${f}:`, err);
    }
  }
  cache = all;
  return all;
}

export function clearPluginCache(): void {
  cache = null;
}

export async function getPlugin(name: string): Promise<GroupingPlugin | undefined> {
  const ps = await loadPlugins();
  return ps.find((p) => p.name === name);
}

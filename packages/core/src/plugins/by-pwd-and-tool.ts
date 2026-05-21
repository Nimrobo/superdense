import type { GroupingPlugin } from '../types.js';
import { resolveProjectKey } from '../util/project-key.js';

export const byPwdAndTool: GroupingPlugin = {
  name: 'by-pwd-and-tool',
  title: 'Sessions in a pwd that also contain a tool keyword',
  description: 'Cheap pwd prefilter, then streams the jsonl to check for a matching tool call.',
  configSchema: [
    { name: 'pwd', type: 'string', required: true, description: 'Absolute project path to match' },
    { name: 'keyword', type: 'string', required: true, description: 'Substring to search for in the tool input' },
    { name: 'toolName', type: 'string', required: false, description: 'Optional: restrict to a specific tool' },
  ],
  prefilter(session, config) {
    const target = String(config.pwd ?? '');
    return !!target && session.projectKey === resolveProjectKey(target);
  },
  async matches(_session, jsonlPath, config, helpers) {
    const keyword = String(config.keyword ?? '');
    if (!keyword) return false;
    const toolName = config.toolName ? String(config.toolName) : undefined;
    for await (const ev of helpers.iterEvents(jsonlPath)) {
      if (!ev.toolName) continue;
      if (toolName && ev.toolName !== toolName) continue;
      if (ev.inputText && ev.inputText.includes(keyword)) {
        return { match: true, evidence: `${ev.toolName}: ${ev.inputText.slice(0, 200)}` };
      }
    }
    return false;
  },
};

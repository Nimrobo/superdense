import type { GroupingPlugin } from '../types.js';

export const byToolKeyword: GroupingPlugin = {
  name: 'by-tool-keyword',
  title: 'Sessions containing a tool call matching a keyword',
  description: 'Streams the transcript; matches if any tool call (optionally restricted to a tool name) contains the keyword in its input.',
  configSchema: [
    { name: 'keyword', type: 'string', required: true, description: 'Substring to search for in the tool input' },
    { name: 'toolName', type: 'string', required: false, description: 'Optional: restrict to a specific tool (e.g. Bash, Read)' },
  ],
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

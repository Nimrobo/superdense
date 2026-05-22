import type { GroupingPlugin } from '../types.js';

export const byUserPromptKeyword: GroupingPlugin = {
  name: 'by-user-prompt-keyword',
  title: 'Sessions where any user prompt contains a keyword',
  description: 'Streams the transcript; matches if any user-role message text contains the keyword.',
  configSchema: [
    { name: 'keyword', type: 'string', required: true, description: 'Substring to search for in user prompts' },
  ],
  async matches(_session, jsonlPath, config, helpers) {
    const keyword = String(config.keyword ?? '');
    if (!keyword) return false;
    for await (const ev of helpers.iterEvents(jsonlPath)) {
      if (ev.role !== 'user') continue;
      if (ev.text && ev.text.includes(keyword)) {
        return { match: true, evidence: ev.text.slice(0, 200) };
      }
    }
    return false;
  },
};

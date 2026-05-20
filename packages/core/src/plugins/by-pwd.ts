import type { GroupingPlugin } from '../types.js';

export const byPwd: GroupingPlugin = {
  name: 'by-pwd',
  title: 'Sessions in a specific working directory',
  description: 'Includes every session whose project path matches the given pwd.',
  configSchema: [
    { name: 'pwd', type: 'string', required: true, description: 'Absolute project path to match' },
  ],
  prefilter(session, config) {
    const target = String(config.pwd ?? '');
    return !!target && session.pwd === target;
  },
  async matches() {
    return true;
  },
};

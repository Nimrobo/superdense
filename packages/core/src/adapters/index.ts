import type { Adapter } from '../types.js';
import { claudeCodeAdapter } from './claude-code.js';

export const adapters: Adapter[] = [claudeCodeAdapter];

export function getAdapter(name: string): Adapter | undefined {
  return adapters.find((a) => a.name === name);
}

export { claudeCodeAdapter };

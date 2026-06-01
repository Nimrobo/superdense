import { extractFirstMeaningfulPrompt } from '../adapters/prompt.js';
import type { Enricher } from './types.js';

const MAX_USER_TURNS = 25;

/**
 * The de-polluted first task: the first content-bearing user turn, skipping
 * `/model` switches, slash-commands, and attachment-only turns that pollute the
 * raw first_prompt. Used for naming and intent similarity.
 */
export const firstIntentEnricher: Enricher = {
  name: 'first_intent',
  version: 1,
  returns: 'json',
  alwaysRun: true,
  description:
    'The first content-bearing user task, with leading /model, slash-commands, and attachment-only turns skipped. Cleaner than first_prompt for naming/intent.',
  async run(ctx) {
    const turns: string[] = [];
    for await (const ev of ctx.iterEvents(ctx.logPath)) {
      if (ev.role === 'user' && ev.kind === 'text' && ev.text) {
        turns.push(ev.text);
        if (turns.length >= MAX_USER_TURNS) break;
      }
    }
    const intent =
      extractFirstMeaningfulPrompt(turns) ?? ctx.session.firstPrompt ?? null;
    return { v: 1, intent };
  },
};

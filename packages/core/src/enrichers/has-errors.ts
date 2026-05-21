import type { Enricher } from './types.js';

const ERROR_RE = /\b([A-Za-z]+Error|error|exception|traceback|failed|fatal)\b/i;

export const hasErrorsEnricher: Enricher = {
  name: 'has_errors',
  version: 1,
  returns: 'bool',
  alwaysRun: true,
  description: 'True if any transcript event text matches a common error/exception keyword.',
  async run(ctx) {
    for await (const ev of ctx.iterEvents(ctx.logPath)) {
      if (ev.text && ERROR_RE.test(ev.text)) return true;
      if (ev.inputText && ERROR_RE.test(ev.inputText)) return true;
    }
    return false;
  },
};

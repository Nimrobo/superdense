import { extractAnswerSection, parseInsightMarker } from '../insights/index.js';
import type { Enricher } from './types.js';

interface InsightRunValue {
  name: string;
  runId: string;
  version: number;
  answer: string | null;
}

export const insightRunEnricher: Enricher = {
  name: 'insight_run',
  version: 1,
  returns: 'json',
  alwaysRun: true,
  description:
    'Detects sessions that were started by pasting a Road42 insight prompt. Stores the insight name, run id, and the final `## Answer` block from the last assistant message.',
  async run(ctx) {
    let firstUserTextSeen: string | null = null;
    let marker: ReturnType<typeof parseInsightMarker> | null = null;
    let lastAssistantText: string | null = null;

    for await (const ev of ctx.iterEvents(ctx.logPath)) {
      if (!marker && ev.role === 'user' && ev.kind === 'text' && typeof ev.text === 'string') {
        if (firstUserTextSeen == null) {
          firstUserTextSeen = ev.text;
          marker = parseInsightMarker(ev.text);
          if (!marker) return null;
        }
      }
      if (marker && ev.role === 'assistant' && ev.kind === 'text' && typeof ev.text === 'string') {
        lastAssistantText = ev.text;
      }
    }

    if (!marker) return null;
    const answer = lastAssistantText ? extractAnswerSection(lastAssistantText) : null;
    const value: InsightRunValue = {
      name: marker.name,
      runId: marker.runId,
      version: marker.version,
      answer,
    };
    return value;
  },
};

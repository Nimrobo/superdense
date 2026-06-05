import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../paths.js', () => ({
  DB_PATH: ':memory:',
  SUPERDENSE_HOME: '/tmp/superdense-session-cost-test',
  GROUPS_DIR: '/tmp/superdense-session-cost-test/queries',
  USER_FILTERS_DIR: '/tmp/superdense-session-cost-test/filters',
  LEGACY_USER_FILTERS_DIR: '/tmp/superdense-session-cost-test/plugins',
  USER_ENRICHERS_DIR: '/tmp/superdense-session-cost-test/enrichers',
  ensureSuperdenseDirs: vi.fn(),
}));

import {
  SYSTEM_RUN_ID,
  _resetDbForTests,
  upsertEnrichment,
  upsertSession,
  upsertSessionLink,
} from '../../db.js';
import { getSessionCost } from '../../session-cost.js';
import { buildSessionCost, sessionCostEnricher } from '../session-cost.js';
import { resolveTokenPrices } from '../session-cost-pricing.js';
import type { Session, TranscriptEvent } from '../../types.js';

const base: Session = {
  id: 'root',
  agent: 'codex',
  sessionId: 'root',
  logPath: '/tmp/root.jsonl',
  pwd: '/repo',
  projectKey: '/repo',
};

beforeEach(() => {
  _resetDbForTests();
});

function usageEvent(event: Partial<TranscriptEvent>): TranscriptEvent {
  return { kind: 'usage', ...event };
}

describe('sessionCostEnricher', () => {
  it('estimates Claude usage including cache reads and writes', async () => {
    const value = buildSessionCost([
      usageEvent({
        modelProvider: 'anthropic',
        model: 'claude-haiku-4-5-20251001',
        tokenUsage: {
          inputTokens: 1000,
          cachedInputTokens: 200,
          cacheCreationInputTokens: 300,
          cacheCreation5mInputTokens: 100,
          cacheCreation1hInputTokens: 200,
          outputTokens: 50,
        },
      }),
    ]);

    expect(value.pricingStatus).toBe('estimated');
    expect(value.estimatedCostUsd).toBe(0.001795);
    expect(value.tokenTotals).toMatchObject({
      inputTokens: 1000,
      cachedInputTokens: 200,
      cacheCreationInputTokens: 300,
      outputTokens: 50,
      totalTokens: 1550,
    });
  });

  it('uses the latest Codex cumulative usage row instead of double-counting token_count rows', async () => {
    const value = buildSessionCost([
      usageEvent({
        modelProvider: 'openai',
        model: 'gpt-5.4',
        tokenUsage: { inputTokens: 1000, cachedInputTokens: 100, outputTokens: 100 },
        cumulativeTokenUsage: {
          inputTokens: 1000,
          cachedInputTokens: 100,
          outputTokens: 100,
          totalTokens: 1100,
        },
      }),
      usageEvent({
        modelProvider: 'openai',
        model: 'gpt-5.4',
        tokenUsage: { inputTokens: 1000, cachedInputTokens: 100, outputTokens: 100 },
        cumulativeTokenUsage: {
          inputTokens: 2000,
          cachedInputTokens: 200,
          outputTokens: 200,
          totalTokens: 2200,
        },
      }),
    ]);

    expect(value.tokenTotals).toMatchObject({
      inputTokens: 2000,
      cachedInputTokens: 200,
      outputTokens: 200,
      totalTokens: 2200,
    });
    expect(value.estimatedCostUsd).toBe(0.00755);
    expect(value.usageEventCount).toBe(2);
  });

  it('attributes Codex cumulative deltas to the active model instead of the final model only', async () => {
    const value = buildSessionCost([
      usageEvent({
        modelProvider: 'openai',
        model: 'gpt-5.4',
        tokenUsage: { inputTokens: 1000, cachedInputTokens: 100, outputTokens: 100 },
        cumulativeTokenUsage: {
          inputTokens: 1000,
          cachedInputTokens: 100,
          outputTokens: 100,
          totalTokens: 1100,
        },
      }),
      usageEvent({
        modelProvider: 'openai',
        model: 'gpt-5.5',
        tokenUsage: { inputTokens: 500, cachedInputTokens: 50, outputTokens: 50 },
        cumulativeTokenUsage: {
          inputTokens: 1500,
          cachedInputTokens: 150,
          outputTokens: 150,
          totalTokens: 1650,
        },
      }),
    ]);

    expect(value.modelBreakdown).toHaveLength(2);
    expect(value.modelBreakdown).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          model: 'gpt-5.4',
          tokenTotals: expect.objectContaining({ inputTokens: 1000, totalTokens: 1100 }),
        }),
        expect.objectContaining({
          model: 'gpt-5.5',
          tokenTotals: expect.objectContaining({ inputTokens: 500, totalTokens: 550 }),
        }),
      ]),
    );
    expect(value.tokenTotals).toMatchObject({ inputTokens: 1500, totalTokens: 1650 });
    expect(value.estimatedCostUsd).toBe(0.00755);
  });

  it('ignores duplicate Codex cumulative rows with no positive token delta', async () => {
    const cumulativeTokenUsage = {
      inputTokens: 1000,
      cachedInputTokens: 100,
      outputTokens: 100,
      totalTokens: 1100,
    };
    const value = buildSessionCost([
      usageEvent({
        modelProvider: 'openai',
        model: 'gpt-5.4',
        tokenUsage: { inputTokens: 1000, cachedInputTokens: 100, outputTokens: 100 },
        cumulativeTokenUsage,
      }),
      usageEvent({
        modelProvider: 'openai',
        model: 'gpt-5.4',
        tokenUsage: { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 },
        cumulativeTokenUsage,
      }),
    ]);

    expect(value.tokenTotals).toMatchObject({ inputTokens: 1000, totalTokens: 1100 });
    expect(value.modelBreakdown[0]?.usageEventCount).toBe(1);
    expect(value.usageEventCount).toBe(2);
  });

  it('treats a lower cumulative row as a reset and uses the row usage', async () => {
    const value = buildSessionCost([
      usageEvent({
        modelProvider: 'openai',
        model: 'gpt-5.4',
        tokenUsage: { inputTokens: 1000, outputTokens: 100 },
        cumulativeTokenUsage: {
          inputTokens: 1000,
          outputTokens: 100,
          totalTokens: 1100,
        },
      }),
      usageEvent({
        modelProvider: 'openai',
        model: 'gpt-5.4',
        tokenUsage: { inputTokens: 200, outputTokens: 20, totalTokens: 220 },
        cumulativeTokenUsage: {
          inputTokens: 200,
          outputTokens: 20,
          totalTokens: 220,
        },
      }),
    ]);

    expect(value.tokenTotals).toMatchObject({ inputTokens: 1200, outputTokens: 120 });
    expect(value.tokenTotals.totalTokens).toBe(1320);
  });

  it('uses OpenAI long-context prices when request input crosses the threshold', async () => {
    const value = buildSessionCost([
      usageEvent({
        modelProvider: 'openai',
        model: 'gpt-5.4',
        tokenUsage: {
          inputTokens: 273000,
          cachedInputTokens: 3000,
          outputTokens: 1000,
          totalTokens: 274000,
        },
      }),
    ]);

    expect(value.pricingStatus).toBe('estimated');
    expect(value.estimatedCostUsd).toBe(1.374);
  });

  it('marks long-context-capable cumulative-only rows partial when request usage is unavailable', async () => {
    const value = buildSessionCost([
      usageEvent({
        modelProvider: 'openai',
        model: 'gpt-5.4',
        cumulativeTokenUsage: {
          inputTokens: 300000,
          outputTokens: 1000,
          totalTokens: 301000,
        },
      }),
    ]);

    expect(value.pricingStatus).toBe('partial');
    expect(value.modelBreakdown[0]).toMatchObject({
      model: 'gpt-5.4',
      pricingStatus: 'partial',
      estimatedCostUsd: 0.765,
    });
  });

  it('returns token-only output for unknown models', async () => {
    const value = buildSessionCost([
      usageEvent({
        modelProvider: 'openai',
        model: 'unknown-model',
        tokenUsage: { inputTokens: 100, outputTokens: 50 },
      }),
    ]);

    expect(value).toMatchObject({
      pricingStatus: 'token_only',
      estimatedCostUsd: null,
      unpricedModels: ['openai:unknown-model'],
    });
  });

  it('runs through an enricher context', async () => {
    const session = base;
    const value = await sessionCostEnricher.run({
      session,
      logPath: session.logPath,
      async *iterEvents() {
        yield usageEvent({
          modelProvider: 'openai',
          model: 'gpt-5-codex',
          tokenUsage: { inputTokens: 1000, outputTokens: 100 },
        });
      },
    });

    expect(value).toMatchObject({ pricingStatus: 'estimated', estimatedCostUsd: 0.00225 });
  });

  it('resolves current OpenAI and Claude catalog aliases and snapshots', async () => {
    expect(resolveTokenPrices('gpt-5.4-mini', 'openai')).toMatchObject({
      inputPerMillion: 0.75,
      cachedInputPerMillion: 0.075,
      outputPerMillion: 4.5,
    });
    expect(resolveTokenPrices('gpt-5.4-2026-03-05', 'openai')).toMatchObject({
      inputPerMillion: 2.5,
      longContextInputPerMillion: 5,
    });
    expect(resolveTokenPrices('claude-opus-4-8-20260601', 'anthropic')).toMatchObject({
      inputPerMillion: 5,
      cachedInputPerMillion: 0.5,
      outputPerMillion: 25,
    });
  });

  it('aggregates stored session_cost enrichments across sub-agent trees', async () => {
    const child = { ...base, id: 'child', sessionId: 'child', isSubagent: true };
    const grandchild = { ...base, id: 'grandchild', sessionId: 'grandchild', isSubagent: true };
    upsertSession(base);
    upsertSession({ ...child, parentSessionId: 'root' });
    upsertSession({ ...grandchild, parentSessionId: 'child' });
    upsertSessionLink('root', 'child', 'subagent', null, 1000);
    upsertSessionLink('child', 'grandchild', 'subagent', null, 1001);
    upsertEnrichment('root', SYSTEM_RUN_ID, 'session_cost', 1, costValue(0.01, 100), 1);
    upsertEnrichment('child', SYSTEM_RUN_ID, 'session_cost', 1, costValue(0.02, 200), 1);
    upsertEnrichment('grandchild', SYSTEM_RUN_ID, 'session_cost', 1, costValue(0.03, 300), 1);

    const result = getSessionCost('root', { tree: true, depth: 20 });

    expect(result).toMatchObject({
      sessionId: 'root',
      directSubagents: [{ sessionId: 'child' }],
      totalWithSubagents: {
        estimatedCostUsd: 0.06,
        sessionCount: 3,
        pricedSessionCount: 3,
        tokenTotals: { totalTokens: 600 },
      },
    });
  });
});

function costValue(estimatedCostUsd: number, totalTokens: number) {
  const value = buildSessionCost([
    usageEvent({
      modelProvider: 'openai',
      model: 'gpt-5-codex',
      tokenUsage: { inputTokens: totalTokens, totalTokens },
    }),
  ]);
  return { ...value, estimatedCostUsd };
}

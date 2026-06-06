import type { TokenUsage, TranscriptEvent } from '../types.js';
import type { Enricher } from './types.js';
import {
  PRICING_CATALOG_VERSION,
  PRICING_SOURCES,
  estimateTokenCostUsdWithStatus,
  normalizeProvider,
  resolveTokenPrices,
} from './session-cost-pricing.js';

export type CostPricingStatus = 'estimated' | 'partial' | 'token_only';

export interface TokenTotals {
  inputTokens: number;
  cachedInputTokens: number;
  cacheCreationInputTokens: number;
  cacheCreation5mInputTokens: number;
  cacheCreation1hInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
  totalTokens: number;
}

export interface SessionCostModelBreakdown {
  provider: string;
  model: string;
  tokenTotals: TokenTotals;
  estimatedCostUsd: number | null;
  pricingStatus: CostPricingStatus;
  usageEventCount: number;
}

export interface SessionCostValue {
  v: 1;
  kind: 'api_equivalent_estimate';
  pricingCatalogVersion: string;
  pricingSources: string[];
  pricingStatus: CostPricingStatus;
  estimatedCostUsd: number | null;
  tokenTotals: TokenTotals;
  modelBreakdown: SessionCostModelBreakdown[];
  unpricedModels: string[];
  usageEventCount: number;
}

interface UsageAccumulator {
  provider: string;
  model: string;
  tokenTotals: TokenTotals;
  estimatedCostUsd: number;
  hasPricedUsage: boolean;
  hasUnpricedUsage: boolean;
  hasPartialPricing: boolean;
  usageEventCount: number;
}

const UNKNOWN_MODEL = 'unknown';
const TOKEN_USAGE_FIELDS = [
  'inputTokens',
  'cachedInputTokens',
  'cacheCreationInputTokens',
  'cacheCreation5mInputTokens',
  'cacheCreation1hInputTokens',
  'outputTokens',
  'reasoningOutputTokens',
  'totalTokens',
] as const;

export const sessionCostEnricher: Enricher = {
  name: 'session_cost',
  version: 1,
  returns: 'json',
  alwaysRun: true,
  description:
    'Estimated API-equivalent session cost from normalized Claude Code and Codex token usage.',
  async run(ctx) {
    const events: TranscriptEvent[] = [];
    for await (const ev of ctx.iterEvents(ctx.logPath)) {
      if (ev.kind === 'usage' && (ev.tokenUsage || ev.cumulativeTokenUsage)) events.push(ev);
    }
    return buildSessionCost(events);
  },
};

export function emptyTokenTotals(): TokenTotals {
  return {
    inputTokens: 0,
    cachedInputTokens: 0,
    cacheCreationInputTokens: 0,
    cacheCreation5mInputTokens: 0,
    cacheCreation1hInputTokens: 0,
    outputTokens: 0,
    reasoningOutputTokens: 0,
    totalTokens: 0,
  };
}

export function buildSessionCost(events: TranscriptEvent[]): SessionCostValue {
  const byModel = new Map<string, UsageAccumulator>();
  let previousCumulative: TokenUsage | undefined;

  for (const ev of events) {
    const usage = usageDeltaForEvent(ev, previousCumulative);
    if (ev.cumulativeTokenUsage) previousCumulative = ev.cumulativeTokenUsage;
    if (!usage) continue;
    const provider = normalizeProvider(ev.modelProvider);
    const model = ev.model?.trim() || UNKNOWN_MODEL;
    const key = `${provider}:${model}`;
    let acc = byModel.get(key);
    if (!acc) {
      acc = {
        provider,
        model,
        tokenTotals: emptyTokenTotals(),
        estimatedCostUsd: 0,
        hasPricedUsage: false,
        hasUnpricedUsage: false,
        hasPartialPricing: false,
        usageEventCount: 0,
      };
      byModel.set(key, acc);
    }
    addTokenUsage(acc.tokenTotals, usage, provider);
    const prices = resolveTokenPrices(acc.model, acc.provider);
    if (prices) {
      const estimate = estimateTokenCostUsdWithStatus(usage, prices, {
        requestUsage: ev.tokenUsage ?? usage,
        hasRequestUsage: !!ev.tokenUsage || !ev.cumulativeTokenUsage,
      });
      acc.estimatedCostUsd += estimate.estimatedCostUsd;
      acc.hasPricedUsage = true;
      if (estimate.pricingStatus === 'partial') acc.hasPartialPricing = true;
    } else {
      acc.hasUnpricedUsage = true;
    }
    acc.usageEventCount += 1;
  }

  const modelBreakdown = Array.from(byModel.values()).map((acc) => {
    const estimatedCostUsd = acc.hasPricedUsage ? roundUsd(acc.estimatedCostUsd) : null;
    const pricingStatus: CostPricingStatus = !acc.hasPricedUsage
      ? 'token_only'
      : acc.hasUnpricedUsage || acc.hasPartialPricing
        ? 'partial'
        : 'estimated';
    return {
      provider: acc.provider,
      model: acc.model,
      tokenTotals: acc.tokenTotals,
      estimatedCostUsd,
      pricingStatus,
      usageEventCount: acc.usageEventCount,
    };
  });

  const tokenTotals = modelBreakdown.reduce((totals, item) => {
    addTokenTotals(totals, item.tokenTotals);
    return totals;
  }, emptyTokenTotals());
  const unpricedModels = modelBreakdown
    .filter((item) => item.pricingStatus === 'token_only')
    .map((item) => `${item.provider}:${item.model}`)
    .sort();
  const hasPartialModels = modelBreakdown.some((item) => item.pricingStatus === 'partial');
  const pricedCosts = modelBreakdown
    .map((item) => item.estimatedCostUsd)
    .filter((value): value is number => typeof value === 'number');
  const estimatedCostUsd = pricedCosts.length > 0 ? roundUsd(sum(pricedCosts)) : null;
  const pricingStatus: CostPricingStatus =
    modelBreakdown.length === 0 || unpricedModels.length === modelBreakdown.length
      ? 'token_only'
      : unpricedModels.length > 0 || hasPartialModels
        ? 'partial'
        : 'estimated';

  return {
    v: 1,
    kind: 'api_equivalent_estimate',
    pricingCatalogVersion: PRICING_CATALOG_VERSION,
    pricingSources: PRICING_SOURCES,
    pricingStatus,
    estimatedCostUsd,
    tokenTotals,
    modelBreakdown,
    unpricedModels,
    usageEventCount: events.length,
  };
}

export function addTokenTotals(target: TokenTotals, source: TokenTotals): void {
  target.inputTokens += source.inputTokens;
  target.cachedInputTokens += source.cachedInputTokens;
  target.cacheCreationInputTokens += source.cacheCreationInputTokens;
  target.cacheCreation5mInputTokens += source.cacheCreation5mInputTokens;
  target.cacheCreation1hInputTokens += source.cacheCreation1hInputTokens;
  target.outputTokens += source.outputTokens;
  target.reasoningOutputTokens += source.reasoningOutputTokens;
  target.totalTokens += source.totalTokens;
}

function addTokenUsage(target: TokenTotals, usage: TokenUsage, provider = 'openai'): void {
  target.inputTokens += usage.inputTokens ?? 0;
  target.cachedInputTokens += usage.cachedInputTokens ?? 0;
  target.cacheCreationInputTokens += usage.cacheCreationInputTokens ?? 0;
  target.cacheCreation5mInputTokens += usage.cacheCreation5mInputTokens ?? 0;
  target.cacheCreation1hInputTokens += usage.cacheCreation1hInputTokens ?? 0;
  target.outputTokens += usage.outputTokens ?? 0;
  target.reasoningOutputTokens += usage.reasoningOutputTokens ?? 0;
  target.totalTokens += usage.totalTokens ?? fallbackTotalTokens(usage, provider);
}

function usageDeltaForEvent(
  ev: TranscriptEvent,
  previousCumulative?: TokenUsage,
): TokenUsage | undefined {
  if (!ev.cumulativeTokenUsage) return positiveTokenUsage(ev.tokenUsage);
  if (!previousCumulative || cumulativeReset(ev.cumulativeTokenUsage, previousCumulative)) {
    return positiveTokenUsage(ev.tokenUsage ?? ev.cumulativeTokenUsage);
  }
  return positiveTokenUsage(subtractTokenUsage(ev.cumulativeTokenUsage, previousCumulative));
}

function subtractTokenUsage(current: TokenUsage, previous: TokenUsage): TokenUsage {
  const out: TokenUsage = {};
  for (const field of TOKEN_USAGE_FIELDS) {
    const currentValue = current[field];
    if (currentValue == null) continue;
    const previousValue = previous[field] ?? 0;
    const delta = currentValue - previousValue;
    if (delta > 0) out[field] = delta;
  }
  return out;
}

function cumulativeReset(current: TokenUsage, previous: TokenUsage): boolean {
  return TOKEN_USAGE_FIELDS.some((field) => {
    const currentValue = current[field];
    const previousValue = previous[field];
    return currentValue != null && previousValue != null && currentValue < previousValue;
  });
}

function positiveTokenUsage(usage?: TokenUsage): TokenUsage | undefined {
  if (!usage) return undefined;
  return TOKEN_USAGE_FIELDS.some((field) => (usage[field] ?? 0) > 0) ? usage : undefined;
}

function fallbackTotalTokens(usage: TokenUsage, provider: string): number {
  const input = usage.inputTokens ?? 0;
  const output = usage.outputTokens ?? 0;
  const cacheCreation = usage.cacheCreationInputTokens ?? 0;
  if (provider === 'anthropic') {
    return input + (usage.cachedInputTokens ?? 0) + cacheCreation + output;
  }
  return input + cacheCreation + output;
}

function roundUsd(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

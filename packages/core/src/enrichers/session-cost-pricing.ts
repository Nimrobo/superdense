import type { TokenUsage } from '../types.js';

export const PRICING_CATALOG_VERSION = '2026-06-05';
export const PRICING_SOURCES = [
  'https://developers.openai.com/api/docs/pricing',
  'https://platform.claude.com/docs/en/about-claude/pricing',
];

export interface TokenPrices {
  provider: string;
  model: string;
  inputPerMillion: number;
  cachedInputPerMillion?: number;
  cacheCreation5mPerMillion?: number;
  cacheCreation1hPerMillion?: number;
  outputPerMillion: number;
  inputIncludesCached?: boolean;
  longContextThresholdInputTokens?: number;
  longContextInputPerMillion?: number;
  longContextCachedInputPerMillion?: number;
  longContextOutputPerMillion?: number;
}

const OPENAI_PRICES: TokenPrices[] = [
  price('openai', 'gpt-5.5', 5, 0.5, 30, true, {
    longContextThresholdInputTokens: 272_000,
    longContextInputPerMillion: 10,
    longContextCachedInputPerMillion: 1,
    longContextOutputPerMillion: 45,
  }),
  price('openai', 'gpt-5.5-pro', 30, undefined, 180, true, {
    longContextThresholdInputTokens: 272_000,
    longContextInputPerMillion: 60,
    longContextOutputPerMillion: 270,
  }),
  price('openai', 'gpt-5.4', 2.5, 0.25, 15, true, {
    longContextThresholdInputTokens: 272_000,
    longContextInputPerMillion: 5,
    longContextCachedInputPerMillion: 0.5,
    longContextOutputPerMillion: 22.5,
  }),
  price('openai', 'gpt-5.4-mini', 0.75, 0.075, 4.5, true),
  price('openai', 'gpt-5.4-nano', 0.2, 0.02, 1.25, true),
  price('openai', 'gpt-5.4-pro', 30, undefined, 180, true, {
    longContextThresholdInputTokens: 272_000,
    longContextInputPerMillion: 60,
    longContextOutputPerMillion: 270,
  }),
  price('openai', 'gpt-5.3-codex', 1.75, 0.175, 14, true),
  price('openai', 'gpt-5.2-codex', 1.75, 0.175, 14, true),
  price('openai', 'gpt-5.2', 1.75, 0.175, 14, true),
  price('openai', 'gpt-5.1-codex', 1.25, 0.125, 10, true),
  price('openai', 'gpt-5-codex', 1.25, 0.125, 10, true),
  price('openai', 'gpt-5.1', 1.25, 0.125, 10, true),
  price('openai', 'gpt-5', 1.25, 0.125, 10, true),
];

const ANTHROPIC_PRICES: TokenPrices[] = [
  claudePrice('claude-opus-4-8', 5, 6.25, 10, 0.5, 25),
  claudePrice('claude-opus-4-7', 5, 6.25, 10, 0.5, 25),
  claudePrice('claude-opus-4-6', 5, 6.25, 10, 0.5, 25),
  claudePrice('claude-opus-4-5', 5, 6.25, 10, 0.5, 25),
  claudePrice('claude-opus-4-1', 15, 18.75, 30, 1.5, 75),
  claudePrice('claude-opus-4', 15, 18.75, 30, 1.5, 75),
  claudePrice('claude-sonnet-4-6', 3, 3.75, 6, 0.3, 15),
  claudePrice('claude-sonnet-4-5', 3, 3.75, 6, 0.3, 15),
  claudePrice('claude-sonnet-4', 3, 3.75, 6, 0.3, 15),
  claudePrice('claude-haiku-4-5', 1, 1.25, 2, 0.1, 5),
  claudePrice('claude-3-5-haiku', 0.8, 1, 1.6, 0.08, 4),
  claudePrice('claude-haiku-3-5', 0.8, 1, 1.6, 0.08, 4),
];

const ALL_PRICES = [...OPENAI_PRICES, ...ANTHROPIC_PRICES];

function price(
  provider: string,
  model: string,
  inputPerMillion: number,
  cachedInputPerMillion: number | undefined,
  outputPerMillion: number,
  inputIncludesCached: boolean,
  extras: Partial<TokenPrices> = {},
): TokenPrices {
  return {
    provider,
    model,
    inputPerMillion,
    cachedInputPerMillion,
    outputPerMillion,
    inputIncludesCached,
    ...extras,
  };
}

function claudePrice(
  model: string,
  inputPerMillion: number,
  cacheCreation5mPerMillion: number,
  cacheCreation1hPerMillion: number,
  cachedInputPerMillion: number,
  outputPerMillion: number,
): TokenPrices {
  return {
    provider: 'anthropic',
    model,
    inputPerMillion,
    cachedInputPerMillion,
    cacheCreation5mPerMillion,
    cacheCreation1hPerMillion,
    outputPerMillion,
    inputIncludesCached: false,
  };
}

export function resolveTokenPrices(model?: string, provider?: string): TokenPrices | undefined {
  const normalizedProvider = normalizeProvider(provider);
  const normalizedModel = normalizeModel(model);
  if (!normalizedModel) return undefined;
  return ALL_PRICES.find(
    (item) =>
      item.provider === normalizedProvider &&
      (normalizedModel === item.model ||
        normalizedModel.startsWith(`${item.model}-20`) ||
        normalizedModel.startsWith(`${item.model}.20`)),
  );
}

export function normalizeProvider(provider?: string): string {
  const lower = (provider ?? '').toLowerCase();
  if (lower.includes('anthropic') || lower.includes('claude')) return 'anthropic';
  return 'openai';
}

export function normalizeModel(model?: string): string | undefined {
  const lower = model?.trim().toLowerCase();
  if (!lower) return undefined;
  const claudeSnapshot = /^claude-(opus|sonnet|haiku)-(\d)-(\d)-/.exec(lower);
  if (claudeSnapshot)
    return `claude-${claudeSnapshot[1]}-${claudeSnapshot[2]}-${claudeSnapshot[3]}`;
  const legacyHaiku = /^claude-3-5-haiku-/.exec(lower);
  if (legacyHaiku) return 'claude-3-5-haiku';
  return lower;
}

export function estimateTokenCostUsd(usage: TokenUsage, prices: TokenPrices): number {
  return estimateTokenCostUsdWithStatus(usage, prices).estimatedCostUsd;
}

export function estimateTokenCostUsdWithStatus(
  usage: TokenUsage,
  prices: TokenPrices,
  opts: { requestUsage?: TokenUsage; hasRequestUsage?: boolean } = {},
): { estimatedCostUsd: number; pricingStatus: 'estimated' | 'partial' } {
  const { prices: effectivePrices, pricingStatus } = effectivePricesForUsage(usage, prices, opts);
  const cachedInput = usage.cachedInputTokens ?? 0;
  const input = usage.inputTokens ?? 0;
  const standardInput = effectivePrices.inputIncludesCached
    ? Math.max(0, input - cachedInput)
    : input;
  const cacheCreation5m = usage.cacheCreation5mInputTokens ?? 0;
  const cacheCreation1h = usage.cacheCreation1hInputTokens ?? 0;
  const cacheCreationKnown = cacheCreation5m + cacheCreation1h;
  const cacheCreationFallback = Math.max(
    0,
    (usage.cacheCreationInputTokens ?? 0) - cacheCreationKnown,
  );
  const cacheCreation5mPrice =
    effectivePrices.cacheCreation5mPerMillion ??
    effectivePrices.cacheCreation1hPerMillion ??
    effectivePrices.inputPerMillion;
  const cacheCreation1hPrice =
    effectivePrices.cacheCreation1hPerMillion ??
    effectivePrices.cacheCreation5mPerMillion ??
    effectivePrices.inputPerMillion;
  const cachedPrice = effectivePrices.cachedInputPerMillion ?? effectivePrices.inputPerMillion;
  const estimatedCostUsd =
    (standardInput * effectivePrices.inputPerMillion +
      cachedInput * cachedPrice +
      (cacheCreation5m + cacheCreationFallback) * cacheCreation5mPrice +
      cacheCreation1h * cacheCreation1hPrice +
      (usage.outputTokens ?? 0) * effectivePrices.outputPerMillion) /
    1_000_000;
  return { estimatedCostUsd, pricingStatus };
}

function effectivePricesForUsage(
  usage: TokenUsage,
  prices: TokenPrices,
  opts: { requestUsage?: TokenUsage; hasRequestUsage?: boolean },
): { prices: TokenPrices; pricingStatus: 'estimated' | 'partial' } {
  if (!prices.longContextThresholdInputTokens) return { prices, pricingStatus: 'estimated' };
  const requestUsage = opts.requestUsage ?? usage;
  if (!opts.hasRequestUsage) return { prices, pricingStatus: 'partial' };
  if ((requestUsage.inputTokens ?? 0) <= prices.longContextThresholdInputTokens) {
    return { prices, pricingStatus: 'estimated' };
  }
  return {
    pricingStatus: 'estimated',
    prices: {
      ...prices,
      inputPerMillion: prices.longContextInputPerMillion ?? prices.inputPerMillion,
      cachedInputPerMillion:
        prices.longContextCachedInputPerMillion ?? prices.cachedInputPerMillion,
      outputPerMillion: prices.longContextOutputPerMillion ?? prices.outputPerMillion,
    },
  };
}

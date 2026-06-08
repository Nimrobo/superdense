import type { ArtifactCost, SessionCostAggregate } from './api.js';

export function formatArtifactCost(cost: ArtifactCost | null | undefined): string | null {
  if (!cost) return null;
  const contributorCount = cost.contributorSessionIds.length;
  const contributorLabel = `${contributorCount} contributor${contributorCount === 1 ? '' : 's'}`;
  if (!cost.totalCostingWithSubagents) return `Cost unavailable | ${contributorLabel}`;
  return [
    `Cost ${formatAggregateCost(cost.totalCostingWithSubagents)}`,
    `${formatTokenCount(cost.totalCostingWithSubagents.tokenTotals.totalTokens)} tokens`,
    contributorLabel,
  ].join(' | ');
}

export function formatArtifactCostBadge(cost: ArtifactCost | null | undefined): string | null {
  if (!cost?.totalCostingWithSubagents) return null;
  return formatAggregateCost(cost.totalCostingWithSubagents);
}

function formatAggregateCost(cost: SessionCostAggregate): string {
  if (typeof cost.estimatedCostUsd === 'number') {
    const formatted = formatUsd(cost.estimatedCostUsd);
    return cost.pricingStatus === 'partial' ? `${formatted} partial` : formatted;
  }
  return cost.tokenTotals.totalTokens > 0 ? 'token-only' : 'unavailable';
}

function formatUsd(value: number): string {
  if (value >= 1) return `$${value.toFixed(2)}`;
  if (value >= 0.01) return `$${value.toFixed(3)}`;
  return `$${value.toFixed(4)}`;
}

function formatTokenCount(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return value.toLocaleString();
}

import { getEnrichment, getSession, getSessionChildren, SYSTEM_RUN_ID } from './db.js';
import {
  addTokenTotals,
  emptyTokenTotals,
  type CostPricingStatus,
  type SessionCostValue,
  type TokenTotals,
} from './enrichers/session-cost.js';

export interface SessionCostTreeChild {
  sessionId: string;
  relation: string;
  self: SessionCostValue | null;
  totalWithSubagents: SessionCostAggregate;
  children?: SessionCostTreeChild[];
}

export interface SessionCostAggregate {
  estimatedCostUsd: number | null;
  pricingStatus: CostPricingStatus;
  tokenTotals: TokenTotals;
  unpricedModels: string[];
  sessionCount: number;
  pricedSessionCount: number;
}

export interface SessionCostResult {
  sessionId: string;
  self: SessionCostValue | null;
  directSubagents: SessionCostTreeChild[];
  totalWithSubagents: SessionCostAggregate;
}

export function getSessionCost(
  sessionId: string,
  opts: { tree?: boolean; depth?: number } = {},
): SessionCostResult | null {
  const session = getSession(sessionId);
  if (!session) return null;
  const depth = Math.max(0, Math.floor(opts.depth ?? 20));
  const self = getSessionCostValue(sessionId);
  const directSubagents = opts.tree
    ? getSessionChildren(sessionId).map((child) =>
        buildChildCost(child.childId, child.relation, depth),
      )
    : [];
  const totalWithSubagents = aggregateCosts(
    [self],
    directSubagents.map((child) => child.totalWithSubagents),
  );
  return { sessionId, self, directSubagents, totalWithSubagents };
}

export function getSessionCostValue(sessionId: string): SessionCostValue | null {
  const value = getEnrichment(sessionId, SYSTEM_RUN_ID, 'session_cost')?.value;
  return isSessionCostValue(value) ? value : null;
}

function buildChildCost(sessionId: string, relation: string, depth: number): SessionCostTreeChild {
  const self = getSessionCostValue(sessionId);
  const children =
    depth > 1
      ? getSessionChildren(sessionId).map((child) =>
          buildChildCost(child.childId, child.relation, depth - 1),
        )
      : [];
  const totalWithSubagents = aggregateCosts(
    [self],
    children.map((child) => child.totalWithSubagents),
  );
  return {
    sessionId,
    relation,
    self,
    totalWithSubagents,
    ...(children.length ? { children } : {}),
  };
}

function aggregateCosts(
  selfCosts: Array<SessionCostValue | null>,
  childAggregates: SessionCostAggregate[],
): SessionCostAggregate {
  const tokenTotals = emptyTokenTotals();
  const unpricedModels = new Set<string>();
  let estimatedCostUsd = 0;
  let hasPricedCost = false;
  let hasTokenOnly = false;
  let hasPartial = false;
  let sessionCount = 0;
  let pricedSessionCount = 0;

  for (const cost of selfCosts) {
    if (!cost) continue;
    sessionCount += 1;
    addTokenTotals(tokenTotals, cost.tokenTotals);
    for (const model of cost.unpricedModels) unpricedModels.add(model);
    if (typeof cost.estimatedCostUsd === 'number') {
      estimatedCostUsd += cost.estimatedCostUsd;
      pricedSessionCount += 1;
      hasPricedCost = true;
    }
    if (cost.pricingStatus === 'token_only') hasTokenOnly = true;
    if (cost.pricingStatus === 'partial') hasPartial = true;
  }

  for (const aggregate of childAggregates) {
    sessionCount += aggregate.sessionCount;
    pricedSessionCount += aggregate.pricedSessionCount;
    addTokenTotals(tokenTotals, aggregate.tokenTotals);
    for (const model of aggregate.unpricedModels) unpricedModels.add(model);
    if (typeof aggregate.estimatedCostUsd === 'number') {
      estimatedCostUsd += aggregate.estimatedCostUsd;
      hasPricedCost = true;
    }
    if (aggregate.pricingStatus === 'token_only') hasTokenOnly = true;
    if (aggregate.pricingStatus === 'partial') hasPartial = true;
  }

  const pricingStatus: CostPricingStatus =
    !hasPricedCost || (hasTokenOnly && !hasPartial && pricedSessionCount === 0)
      ? 'token_only'
      : hasTokenOnly || hasPartial || unpricedModels.size > 0
        ? 'partial'
        : 'estimated';

  return {
    estimatedCostUsd: hasPricedCost ? roundUsd(estimatedCostUsd) : null,
    pricingStatus,
    tokenTotals,
    unpricedModels: [...unpricedModels].sort(),
    sessionCount,
    pricedSessionCount,
  };
}

function isSessionCostValue(value: unknown): value is SessionCostValue {
  return (
    !!value &&
    typeof value === 'object' &&
    (value as { v?: unknown }).v === 1 &&
    (value as { kind?: unknown }).kind === 'api_equivalent_estimate' &&
    typeof (value as { tokenTotals?: unknown }).tokenTotals === 'object'
  );
}

function roundUsd(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

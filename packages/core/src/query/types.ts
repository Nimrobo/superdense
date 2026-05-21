export type EnrichReturn = 'string' | 'int' | 'bool' | 'json';

export type Operator =
  | '='
  | '!='
  | '<'
  | '<='
  | '>'
  | '>='
  | 'startsWith'
  | 'endsWith'
  | 'contains'
  | 'matches'
  | 'in'
  | 'between'
  | 'isNull'
  | 'jsonEq'
  | 'jsonContains'
  | 'jsonAny'
  | 'jsonLength';

export type IntOp = '=' | '!=' | '<' | '<=' | '>' | '>=';

export interface FieldLeaf {
  field: string;
  op: Operator;
  value?: unknown;
  path?: string;
  intOp?: IntOp;
}

export interface PluginLeaf {
  plugin: { name: string; config: Record<string, unknown> };
}

export type PredicateLeaf = FieldLeaf | PluginLeaf;

export type Predicate =
  | { and: Predicate[] }
  | { or: Predicate[] }
  | { not: Predicate }
  | PredicateLeaf;

export function isAnd(p: Predicate): p is { and: Predicate[] } {
  return typeof p === 'object' && p !== null && 'and' in p;
}
export function isOr(p: Predicate): p is { or: Predicate[] } {
  return typeof p === 'object' && p !== null && 'or' in p;
}
export function isNot(p: Predicate): p is { not: Predicate } {
  return typeof p === 'object' && p !== null && 'not' in p;
}
export function isPluginLeaf(p: Predicate): p is PluginLeaf {
  return typeof p === 'object' && p !== null && 'plugin' in p;
}
export function isFieldLeaf(p: Predicate): p is FieldLeaf {
  return typeof p === 'object' && p !== null && 'field' in p;
}

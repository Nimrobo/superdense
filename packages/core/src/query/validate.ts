import type { Enricher } from '../enrichers/types.js';
import {
  type Predicate,
  type Operator,
  type EnrichReturn,
  isAnd,
  isOr,
  isNot,
  isFieldLeaf,
  isPluginLeaf,
} from './types.js';

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

export const SESSION_COLUMNS: Record<string, EnrichReturn> = {
  pwd: 'string',
  agent: 'string',
  gitBranch: 'string',
  firstPrompt: 'string',
  summary: 'string',
  createdAt: 'int',
  modifiedAt: 'int',
  messageCount: 'int',
  isSidechain: 'bool',
};

export const OPS_BY_TYPE: Record<EnrichReturn, Operator[]> = {
  string: ['=', '!=', 'startsWith', 'endsWith', 'contains', 'matches', 'in', 'isNull'],
  int: ['=', '!=', '<', '<=', '>', '>=', 'in', 'between', 'isNull'],
  bool: ['=', 'isNull'],
  json: ['jsonEq', 'jsonContains', 'jsonAny', 'jsonLength', 'isNull'],
};

export interface ValidateOptions {
  enrichers: Enricher[];
}

export function validatePredicate(p: Predicate, opts: ValidateOptions): void {
  const map = new Map(opts.enrichers.map((e) => [e.name, e]));
  walkValidate(p, map);
}

export function collectReferencedEnrichers(p: Predicate): Set<string> {
  const out = new Set<string>();
  walkCollect(p, out);
  return out;
}

function walkCollect(p: Predicate, out: Set<string>): void {
  if (isAnd(p)) {
    for (const c of p.and) walkCollect(c, out);
    return;
  }
  if (isOr(p)) {
    for (const c of p.or) walkCollect(c, out);
    return;
  }
  if (isNot(p)) {
    walkCollect(p.not, out);
    return;
  }
  if (isFieldLeaf(p)) {
    if (p.field.startsWith('enr.')) out.add(p.field.slice(4));
  }
}

function walkValidate(p: Predicate, enrichers: Map<string, Enricher>): void {
  if (p == null || typeof p !== 'object') {
    throw new ValidationError(`predicate must be an object, got ${typeof p}`);
  }
  if (isAnd(p)) {
    if (!Array.isArray(p.and)) throw new ValidationError('and: expected array');
    for (const c of p.and) walkValidate(c, enrichers);
    return;
  }
  if (isOr(p)) {
    if (!Array.isArray(p.or)) throw new ValidationError('or: expected array');
    for (const c of p.or) walkValidate(c, enrichers);
    return;
  }
  if (isNot(p)) {
    walkValidate(p.not, enrichers);
    return;
  }
  if (isPluginLeaf(p)) {
    if (!p.plugin || typeof p.plugin.name !== 'string') {
      throw new ValidationError('plugin leaf: name required');
    }
    return;
  }
  if (isFieldLeaf(p)) {
    if (typeof p.field !== 'string') throw new ValidationError('field leaf: field must be string');
    if (typeof p.op !== 'string') throw new ValidationError(`field "${p.field}": op required`);

    let type: EnrichReturn;
    if (p.field.startsWith('session.')) {
      const col = p.field.slice('session.'.length);
      const t = SESSION_COLUMNS[col];
      if (!t) throw new ValidationError(`unknown session column: ${col}`);
      type = t;
    } else if (p.field.startsWith('enr.')) {
      const name = p.field.slice('enr.'.length);
      const e = enrichers.get(name);
      if (!e) throw new ValidationError(`unknown enricher: ${name}`);
      type = e.returns;
    } else {
      throw new ValidationError(`field must be namespaced session.* or enr.*: ${p.field}`);
    }

    const ops = OPS_BY_TYPE[type];
    if (!ops.includes(p.op)) {
      throw new ValidationError(`op "${p.op}" not valid for ${type} field "${p.field}"`);
    }

    const wantsValue = p.op !== 'isNull';
    if (wantsValue && p.value === undefined) {
      throw new ValidationError(`field "${p.field}" op "${p.op}": value required`);
    }

    if ((p.op === 'jsonEq' || p.op === 'jsonContains' || p.op === 'jsonAny' || p.op === 'jsonLength') && p.path && !p.path.startsWith('$')) {
      throw new ValidationError(`path must start with $: ${p.path}`);
    }
    if ((p.op === 'jsonAny' || p.op === 'jsonLength') && p.intOp) {
      if (!['=', '!=', '<', '<=', '>', '>='].includes(p.intOp)) {
        throw new ValidationError(`intOp invalid: ${p.intOp}`);
      }
    }
    if (p.op === 'in' && !Array.isArray(p.value)) {
      throw new ValidationError(`in: value must be array`);
    }
    if (p.op === 'between' && (!Array.isArray(p.value) || p.value.length !== 2)) {
      throw new ValidationError(`between: value must be [lo, hi]`);
    }
    return;
  }
  throw new ValidationError('predicate must be and/or/not/field-leaf/plugin-leaf');
}

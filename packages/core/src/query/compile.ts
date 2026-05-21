import {
  type Predicate,
  type FieldLeaf,
  isAnd,
  isOr,
  isNot,
  isFieldLeaf,
  isPluginLeaf,
} from './types.js';

const COL_MAP: Record<string, string> = {
  pwd: 'pwd',
  agent: 'agent',
  gitBranch: 'git_branch',
  firstPrompt: 'first_prompt',
  summary: 'summary',
  createdAt: 'created_at',
  modifiedAt: 'modified_at',
  messageCount: 'message_count',
  isSidechain: 'is_sidechain',
};

export interface CompileResult {
  sql: string;
  params: Record<string, unknown>;
  referencedEnrichers: string[];
  containsPluginLeaf: boolean;
}

interface Ctx {
  params: Record<string, unknown>;
  next: number;
  enricherAliases: Map<string, string>;
  referenced: Set<string>;
  containsPlugin: boolean;
}

function bind(ctx: Ctx, value: unknown): string {
  const key = `p${ctx.next++}`;
  ctx.params[key] = value;
  return `@${key}`;
}

function aliasFor(ctx: Ctx, name: string): string {
  const existing = ctx.enricherAliases.get(name);
  if (existing) return existing;
  const a = `qe_${ctx.enricherAliases.size}`;
  ctx.enricherAliases.set(name, a);
  ctx.referenced.add(name);
  return a;
}

function compileScalar(expr: string, leaf: FieldLeaf, ctx: Ctx): string {
  switch (leaf.op) {
    case '=': return `${expr} = ${bind(ctx, leaf.value)}`;
    case '!=': return `${expr} != ${bind(ctx, leaf.value)}`;
    case '<': return `${expr} < ${bind(ctx, leaf.value)}`;
    case '<=': return `${expr} <= ${bind(ctx, leaf.value)}`;
    case '>': return `${expr} > ${bind(ctx, leaf.value)}`;
    case '>=': return `${expr} >= ${bind(ctx, leaf.value)}`;
    case 'startsWith': return `${expr} LIKE ${bind(ctx, `${String(leaf.value)}%`)}`;
    case 'endsWith': return `${expr} LIKE ${bind(ctx, `%${String(leaf.value)}`)}`;
    case 'contains': return `${expr} LIKE ${bind(ctx, `%${String(leaf.value)}%`)}`;
    case 'matches': return `${expr} REGEXP ${bind(ctx, String(leaf.value))}`;
    case 'in': {
      const arr = (leaf.value as unknown[]) ?? [];
      if (arr.length === 0) return '0';
      const placeholders = arr.map((v) => bind(ctx, v)).join(', ');
      return `${expr} IN (${placeholders})`;
    }
    case 'between': {
      const [a, b] = leaf.value as [unknown, unknown];
      return `${expr} BETWEEN ${bind(ctx, a)} AND ${bind(ctx, b)}`;
    }
    case 'isNull': return `${expr} IS NULL`;
    default: throw new Error(`unsupported op for scalar: ${leaf.op}`);
  }
}

function compileField(leaf: FieldLeaf, ctx: Ctx): string {
  if (leaf.field.startsWith('session.')) {
    const col = leaf.field.slice('session.'.length);
    const dbCol = COL_MAP[col];
    if (!dbCol) throw new Error(`unknown session column: ${col}`);
    if (col === 'isSidechain' && leaf.op === '=') {
      return `${dbCol === 'is_sidechain' ? 's.is_sidechain' : `s.${dbCol}`} = ${bind(ctx, leaf.value ? 1 : 0)}`;
    }
    return compileScalar(`s.${dbCol}`, leaf, ctx);
  }
  if (leaf.field.startsWith('enr.')) {
    const enrName = leaf.field.slice('enr.'.length);
    const alias = aliasFor(ctx, enrName);
    const path = leaf.path ?? '$';

    if (leaf.op === 'jsonAny') {
      const intOp = leaf.intOp ?? '=';
      return `EXISTS (SELECT 1 FROM json_each(${alias}.value, ${bind(ctx, path)}) je WHERE je.value ${intOp} ${bind(ctx, leaf.value)})`;
    }
    if (leaf.op === 'jsonLength') {
      const intOp = leaf.intOp ?? '=';
      return `json_array_length(${alias}.value, ${bind(ctx, path)}) ${intOp} ${bind(ctx, leaf.value)}`;
    }
    const valueExpr = `json_extract(${alias}.value, ${bind(ctx, path)})`;
    if (leaf.op === 'jsonContains') {
      return `${valueExpr} LIKE ${bind(ctx, `%${String(leaf.value)}%`)}`;
    }
    if (leaf.op === 'jsonEq') {
      return `${valueExpr} = ${bind(ctx, leaf.value)}`;
    }
    if (leaf.op === 'isNull') {
      return `${valueExpr} IS NULL`;
    }
    return compileScalar(valueExpr, leaf, ctx);
  }
  throw new Error(`bad field namespace: ${leaf.field}`);
}

function walk(p: Predicate, ctx: Ctx): string {
  if (isAnd(p)) {
    if (p.and.length === 0) return '1=1';
    return '(' + p.and.map((c) => walk(c, ctx)).join(' AND ') + ')';
  }
  if (isOr(p)) {
    if (p.or.length === 0) return '1=0';
    return '(' + p.or.map((c) => walk(c, ctx)).join(' OR ') + ')';
  }
  if (isNot(p)) {
    return `NOT (${walk(p.not, ctx)})`;
  }
  if (isPluginLeaf(p)) {
    ctx.containsPlugin = true;
    return '0';
  }
  if (isFieldLeaf(p)) {
    return compileField(p, ctx);
  }
  throw new Error('bad predicate node');
}

export function compilePredicate(p: Predicate): CompileResult {
  const ctx: Ctx = {
    params: {},
    next: 0,
    enricherAliases: new Map(),
    referenced: new Set(),
    containsPlugin: false,
  };
  const whereExpr = walk(p, ctx);
  const joins: string[] = [];
  for (const [enrName, alias] of ctx.enricherAliases) {
    joins.push(
      `LEFT JOIN query_enrich ${alias} ON ${alias}.session_id = s.id AND ${alias}.name = ${bind(ctx, enrName)}`,
    );
  }
  const sql = `SELECT s.id FROM sessions s ${joins.join(' ')} WHERE ${whereExpr}`;
  return {
    sql,
    params: ctx.params,
    referencedEnrichers: Array.from(ctx.referenced),
    containsPluginLeaf: ctx.containsPlugin,
  };
}

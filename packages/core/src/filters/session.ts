import type { IntOp } from '../query/types.js';
import type { Filter } from './types.js';

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function asTimestamp(value: unknown): number | undefined {
  const n = asNumber(value);
  if (n != null) return n;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function contains(source: string | null | undefined, needle: string): boolean {
  return (source ?? '').includes(needle);
}

function countFromRecord(value: unknown, name: string): number {
  if (typeof value !== 'object' || value === null) return 0;
  const raw = (value as Record<string, unknown>)[name];
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : 0;
}

function compareInt(lhs: number, op: IntOp, rhs: number): boolean {
  switch (op) {
    case '=':
      return lhs === rhs;
    case '!=':
      return lhs !== rhs;
    case '<':
      return lhs < rhs;
    case '<=':
      return lhs <= rhs;
    case '>':
      return lhs > rhs;
    case '>=':
      return lhs >= rhs;
  }
}

function matchCountParam(value: unknown, actual: number): boolean {
  if (typeof value !== 'object' || value === null) return false;
  const params = value as Record<string, unknown>;
  const op = (typeof params.op === 'string' ? params.op : '=') as IntOp;
  if (!['=', '!=', '<', '<=', '>', '>='].includes(op)) return false;
  const target = asNumber(params.value);
  return target == null ? false : compareInt(actual, op, target);
}

function matchUsedParam(value: unknown, enrichment: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false;
  const params = value as Record<string, unknown>;
  const name = asString(params.name);
  if (!name) return false;
  const min = Math.max(1, Math.floor(asNumber(params.min) ?? 1));
  return countFromRecord(enrichment, name) >= min;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

export const sessionFilter: Filter = {
  name: 'session',
  title: 'Session',
  description:
    'Filters sessions by metadata and always-on system data such as errors, tool counts, CLI counts, and event count.',
  usesSystemData: true,
  paramsSchema: {
    type: 'object',
    properties: {
      agent: { type: 'string', description: 'Exact adapter/agent name.' },
      pwd: { type: 'string', description: 'Exact working directory.' },
      pwdContains: { type: 'string', description: 'Substring contained in the working directory.' },
      project: { type: 'string', description: 'Exact project key.' },
      projectContains: { type: 'string', description: 'Substring contained in the project key.' },
      firstPromptContains: {
        type: 'string',
        description: 'Substring contained in the first prompt.',
      },
      summaryContains: {
        type: 'string',
        description: 'Substring contained in the session summary.',
      },
      isSubagent: {
        type: 'boolean',
        description:
          'When true, match only sub-agent sessions. When false, match only root sessions. Omitting this param defaults to root-only (false).',
      },
      parent: {
        type: 'string',
        description: 'Exact parent session id (adapter:sessionId). Matches direct children only.',
      },
      hasSubagents: {
        type: 'boolean',
        description: 'Matches the always-on subagent_summary direct-child signal.',
      },
      subagentCount: {
        type: 'object',
        required: ['value'],
        properties: {
          op: { type: 'string', enum: ['=', '!=', '<', '<=', '>', '>='], default: '=' },
          value: { type: 'number' },
        },
      },
      descendantSubagentCount: {
        type: 'object',
        required: ['value'],
        properties: {
          op: { type: 'string', enum: ['=', '!=', '<', '<=', '>', '>='], default: '=' },
          value: { type: 'number' },
        },
      },
      subagentDepth: {
        type: 'object',
        required: ['value'],
        properties: {
          op: { type: 'string', enum: ['=', '!=', '<', '<=', '>', '>='], default: '=' },
          value: { type: 'number' },
        },
      },
      rootSession: {
        type: 'string',
        description: 'Exact root session id for the recursive sub-agent tree.',
      },
      createdAfter: {
        type: ['number', 'string'],
        description: 'Minimum createdAt timestamp or parseable date.',
      },
      createdBefore: {
        type: ['number', 'string'],
        description: 'Maximum createdAt timestamp or parseable date.',
      },
      modifiedAfter: {
        type: ['number', 'string'],
        description: 'Minimum modifiedAt timestamp or parseable date.',
      },
      modifiedBefore: {
        type: ['number', 'string'],
        description: 'Maximum modifiedAt timestamp or parseable date.',
      },
      hasErrors: {
        type: 'boolean',
        description: 'Matches the always-on has_errors system signal.',
      },
      toolUsed: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string' },
          min: { type: 'number', default: 1 },
        },
      },
      cliUsed: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string' },
          min: { type: 'number', default: 1 },
        },
      },
      eventCount: {
        type: 'object',
        required: ['value'],
        properties: {
          op: { type: 'string', enum: ['=', '!=', '<', '<=', '>', '>='], default: '=' },
          value: { type: 'number' },
        },
      },
      enteredPlanMode: {
        type: 'boolean',
        description: 'Matches sessions that entered plan mode at least once.',
      },
      planEnterCount: {
        type: 'object',
        required: ['value'],
        properties: {
          op: { type: 'string', enum: ['=', '!=', '<', '<=', '>', '>='], default: '=' },
          value: { type: 'number' },
        },
      },
      planDurationMs: {
        type: 'object',
        required: ['value'],
        properties: {
          op: { type: 'string', enum: ['=', '!=', '<', '<=', '>', '>='], default: '=' },
          value: { type: 'number' },
        },
      },
      planUnclosed: {
        type: 'boolean',
        description: 'Matches sessions that entered plan mode and never exited it.',
      },
      planFinalized: {
        type: 'boolean',
        description:
          'Matches sessions where a plan was finalized (ExitPlanMode or <proposed_plan>).',
      },
      toolUsedInPlan: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string' },
          min: { type: 'number', default: 1 },
        },
      },
      toolUsedOnlyOutOfPlan: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string' },
        },
      },
      userPromptsInPlan: {
        type: 'object',
        required: ['value'],
        properties: {
          op: { type: 'string', enum: ['=', '!=', '<', '<=', '>', '>='], default: '=' },
          value: { type: 'number' },
        },
      },
    },
    additionalProperties: false,
  },
  examples: [
    { filter: { name: 'session', params: { agent: 'codex', hasErrors: true } } },
    {
      filter: {
        name: 'session',
        params: { pwdContains: 'superdense', toolUsed: { name: 'Bash', min: 1 } },
      },
    },
    { filter: { name: 'session', params: { cliUsed: { name: 'git', min: 2 } } } },
    { filter: { name: 'session', params: { enteredPlanMode: true } } },
    { filter: { name: 'session', params: { planUnclosed: true } } },
    { filter: { name: 'session', params: { toolUsedInPlan: { name: 'Edit', min: 1 } } } },
    { filter: { name: 'session', params: { planFinalized: true } } },
    { filter: { name: 'session', params: { userPromptsInPlan: { op: '>', value: 3 } } } },
    { filter: { name: 'session', params: { hasSubagents: true } } },
    {
      filter: {
        name: 'session',
        params: { isSubagent: true, hasSubagents: true, subagentDepth: { op: '=', value: 1 } },
      },
    },
  ],
  async run(ctx, params) {
    const session = ctx.session;

    const parent = asString(params.parent);
    const rootSession = asString(params.rootSession);

    // Sub-agent filtering: default to root-only when param is omitted, unless
    // a parent or root tree is requested because those filters target relationships.
    if (typeof params.isSubagent === 'boolean') {
      if (!!session.isSubagent !== params.isSubagent) return false;
    } else if (!parent && !rootSession) {
      if (session.isSubagent === true) return false;
    }

    if (parent && session.parentSessionId !== parent) return false;

    const subagentSummary = asRecord(ctx.getSystemEnrichment('subagent_summary')?.value);

    if (typeof params.hasSubagents === 'boolean') {
      const actual = subagentSummary.hasSubagents === true;
      if (actual !== params.hasSubagents) return false;
    }

    if (params.subagentCount !== undefined) {
      const n =
        typeof subagentSummary.subagentCount === 'number' ? subagentSummary.subagentCount : 0;
      if (!matchCountParam(params.subagentCount, n)) return false;
    }

    if (params.descendantSubagentCount !== undefined) {
      const n =
        typeof subagentSummary.descendantSubagentCount === 'number'
          ? subagentSummary.descendantSubagentCount
          : 0;
      if (!matchCountParam(params.descendantSubagentCount, n)) return false;
    }

    if (params.subagentDepth !== undefined) {
      const n =
        typeof subagentSummary.subagentDepth === 'number' ? subagentSummary.subagentDepth : 0;
      if (!matchCountParam(params.subagentDepth, n)) return false;
    }

    if (rootSession && subagentSummary.rootSessionId !== rootSession) return false;

    const agent = asString(params.agent);
    if (agent && session.agent !== agent) return false;

    const pwd = asString(params.pwd);
    if (pwd && session.pwd !== pwd) return false;

    const pwdContains = asString(params.pwdContains);
    if (pwdContains && !contains(session.pwd, pwdContains)) return false;

    const project = asString(params.project);
    if (project && session.projectKey !== project) return false;

    const projectContains = asString(params.projectContains);
    if (projectContains && !contains(session.projectKey, projectContains)) return false;

    const firstPromptContains = asString(params.firstPromptContains);
    if (firstPromptContains && !contains(session.firstPrompt, firstPromptContains)) return false;

    const summaryContains = asString(params.summaryContains);
    if (summaryContains && !contains(session.summary, summaryContains)) return false;

    const createdAfter = asTimestamp(params.createdAfter);
    if (createdAfter != null && (session.createdAt == null || session.createdAt < createdAfter))
      return false;

    const createdBefore = asTimestamp(params.createdBefore);
    if (createdBefore != null && (session.createdAt == null || session.createdAt > createdBefore))
      return false;

    const modifiedAfter = asTimestamp(params.modifiedAfter);
    if (modifiedAfter != null && (session.modifiedAt == null || session.modifiedAt < modifiedAfter))
      return false;

    const modifiedBefore = asTimestamp(params.modifiedBefore);
    if (
      modifiedBefore != null &&
      (session.modifiedAt == null || session.modifiedAt > modifiedBefore)
    )
      return false;

    if (typeof params.hasErrors === 'boolean') {
      const actual = ctx.getSystemEnrichment('has_errors')?.value === true;
      if (actual !== params.hasErrors) return false;
    }

    if (params.toolUsed !== undefined) {
      const tools = ctx.getSystemEnrichment('tool_counts')?.value;
      if (!matchUsedParam(params.toolUsed, tools)) return false;
    }

    if (params.cliUsed !== undefined) {
      const clis = ctx.getSystemEnrichment('bash_cli_counts')?.value;
      if (!matchUsedParam(params.cliUsed, clis)) return false;
    }

    if (params.eventCount !== undefined) {
      const value = ctx.getSystemEnrichment('event_count')?.value;
      const count = typeof value === 'number' ? value : 0;
      if (!matchCountParam(params.eventCount, count)) return false;
    }

    const planParams = [
      'enteredPlanMode',
      'planEnterCount',
      'planDurationMs',
      'planUnclosed',
      'planFinalized',
      'toolUsedInPlan',
      'toolUsedOnlyOutOfPlan',
      'userPromptsInPlan',
    ];
    if (planParams.some((k) => params[k] !== undefined)) {
      const plan = asRecord(ctx.getSystemEnrichment('plan_mode')?.value);

      if (typeof params.enteredPlanMode === 'boolean') {
        const entered = plan.entered === true;
        if (entered !== params.enteredPlanMode) return false;
      }
      if (params.planEnterCount !== undefined) {
        const n = typeof plan.enterCount === 'number' ? plan.enterCount : 0;
        if (!matchCountParam(params.planEnterCount, n)) return false;
      }
      if (params.planDurationMs !== undefined) {
        const n = typeof plan.totalDurationMs === 'number' ? plan.totalDurationMs : 0;
        if (!matchCountParam(params.planDurationMs, n)) return false;
      }
      if (typeof params.planUnclosed === 'boolean') {
        const unclosed = plan.unclosed === true;
        if (unclosed !== params.planUnclosed) return false;
      }
      if (typeof params.planFinalized === 'boolean') {
        const finalized =
          typeof plan.proposedPlanFinalized === 'number' && plan.proposedPlanFinalized > 0;
        if (finalized !== params.planFinalized) return false;
      }
      if (params.toolUsedInPlan !== undefined) {
        if (!matchUsedParam(params.toolUsedInPlan, plan.toolCallsInPlan)) return false;
      }
      if (params.toolUsedOnlyOutOfPlan !== undefined) {
        const p = params.toolUsedOnlyOutOfPlan as { name?: unknown };
        const name = typeof p?.name === 'string' ? p.name : '';
        if (!name) return false;
        const inPlan = countFromRecord(plan.toolCallsInPlan, name);
        const outOfPlan = countFromRecord(plan.toolCallsOutOfPlan, name);
        if (!(inPlan === 0 && outOfPlan > 0)) return false;
      }
      if (params.userPromptsInPlan !== undefined) {
        const n = typeof plan.userPromptsInPlan === 'number' ? plan.userPromptsInPlan : 0;
        if (!matchCountParam(params.userPromptsInPlan, n)) return false;
      }
    }

    return true;
  },
};

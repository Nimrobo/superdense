import { describe, expect, it } from 'vitest';
import type { Enricher } from '../../enrichers/types.js';
import type { Filter } from '../../filters/types.js';
import type { QueryDefinition } from '../types.js';
import { validateQueryDefinition, ValidationError } from '../validate.js';

const filters: Filter[] = [
  {
    name: 'session',
    title: 'Session',
    paramsSchema: {
      type: 'object',
      properties: {
        agent: { type: 'string' },
        hasErrors: { type: 'boolean' },
      },
      additionalProperties: false,
    },
    async run() { return true; },
  },
  {
    name: 'user_prompt_contains',
    title: 'User Prompt Contains',
    paramsSchema: {
      type: 'object',
      required: ['keyword'],
      properties: { keyword: { type: 'string' } },
      additionalProperties: false,
    },
    async run() { return true; },
  },
  {
    name: 'open_implicit',
    title: 'Open Implicit',
    paramsSchema: {
      type: 'object',
      properties: { known: { type: 'string' } },
    },
    async run() { return true; },
  },
  {
    name: 'open_explicit',
    title: 'Open Explicit',
    paramsSchema: {
      type: 'object',
      properties: { known: { type: 'string' } },
      additionalProperties: true,
    },
    async run() { return true; },
  },
  {
    name: 'nested_closed',
    title: 'Nested Closed',
    paramsSchema: {
      type: 'object',
      properties: {
        child: {
          type: 'object',
          properties: { known: { type: 'string' } },
          additionalProperties: false,
        },
      },
      additionalProperties: false,
    },
    async run() { return true; },
  },
];

const enrichers: Enricher[] = [
  { name: 'salience', version: 1, returns: 'json', async run() { return {}; } },
];

function validate(definition: QueryDefinition) {
  return validateQueryDefinition(definition, { filters, enrichers });
}

describe('validateQueryDefinition', () => {
  it('accepts nested filter expressions and post-filter enrichers', () => {
    expect(() => validate({
      filters: {
        and: [
          { filter: { name: 'session', params: { agent: 'codex', hasErrors: true } } },
          { filter: { name: 'user_prompt_contains', params: { keyword: 'billing' } } },
        ],
      },
      enrichers: ['salience'],
    })).not.toThrow();
  });

  it('rejects unknown filters and enrichers', () => {
    expect(() => validate({ filters: { filter: { name: 'nope', params: {} } } }))
      .toThrow('unknown filter: nope');
    expect(() => validate({ filters: { filter: { name: 'session', params: {} } }, enrichers: ['nope'] }))
      .toThrow('unknown enricher: nope');
  });

  it('rejects old field and plugin leaves', () => {
    expect(() => validate({ filters: { field: 'session.agent', op: '=', value: 'codex' } as unknown as QueryDefinition['filters'] }))
      .toThrow('field leaves are no longer supported');
    expect(() => validate({ filters: { plugin: { name: 'keyword', config: {} } } as unknown as QueryDefinition['filters'] }))
      .toThrow('plugin leaves are no longer supported');
  });

  it('validates required params against filter metadata', () => {
    expect(() => validate({ filters: { filter: { name: 'user_prompt_contains', params: {} } } }))
      .toThrow(ValidationError);
  });

  it('rejects unknown params when filter metadata disallows additional properties', () => {
    expect(() => validate({ filters: { filter: { name: 'session', params: { agentt: 'codex' } } } }))
      .toThrow('filter "session": unknown param "agentt"');
  });

  it('allows unknown params when filter metadata is open', () => {
    expect(() => validate({ filters: { filter: { name: 'open_implicit', params: { typo: 'codex' } } } }))
      .not.toThrow();
    expect(() => validate({ filters: { filter: { name: 'open_explicit', params: { typo: 'codex' } } } }))
      .not.toThrow();
  });

  it('rejects unknown nested params when nested metadata disallows additional properties', () => {
    expect(() => validate({ filters: { filter: { name: 'nested_closed', params: { child: { typo: 'codex' } } } } }))
      .toThrow('filter "nested_closed": unknown param "child.typo"');
  });
});

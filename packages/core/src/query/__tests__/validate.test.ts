import { describe, expect, it } from 'vitest';
import type { Enricher } from '../../enrichers/types.js';
import type { Predicate } from '../types.js';
import { collectReferencedEnrichers, validatePredicate, ValidationError } from '../validate.js';

const enrichers: Enricher[] = [
  { name: 'event_count', version: 1, returns: 'int', async run() { return 0; } },
  { name: 'has_errors', version: 1, returns: 'bool', async run() { return false; } },
  { name: 'tool_counts', version: 1, returns: 'json', async run() { return {}; } },
];

function validate(predicate: Predicate) {
  return validatePredicate(predicate, { enrichers });
}

describe('validatePredicate', () => {
  it('rejects an unknown session field', () => {
    expect(() => validate({ field: 'session.nope', op: '=', value: 'x' }))
      .toThrow(ValidationError);
  });

  it('rejects an unknown enricher', () => {
    expect(() => validate({ field: 'enr.nope', op: '=', value: 1 }))
      .toThrow('unknown enricher: nope');
  });

  it('rejects operator and return type mismatches', () => {
    expect(() => validate({ field: 'enr.event_count', op: 'startsWith', value: '1' }))
      .toThrow('not valid for int');
  });

  it('rejects malformed JSON paths', () => {
    expect(() => validate({ field: 'enr.tool_counts', op: 'jsonEq', path: 'Bash', value: 1 }))
      .toThrow('path must start with $');
  });

  it('accepts nested predicates and collects referenced enrichers', () => {
    const predicate: Predicate = {
      and: [
        { field: 'session.pwd', op: 'startsWith', value: '/repo' },
        {
          or: [
            { field: 'enr.event_count', op: '>', value: 5 },
            { not: { field: 'enr.has_errors', op: '=', value: true } },
          ],
        },
      ],
    };

    expect(() => validate(predicate)).not.toThrow();
    expect(Array.from(collectReferencedEnrichers(predicate)).sort()).toEqual(['event_count', 'has_errors']);
  });
});

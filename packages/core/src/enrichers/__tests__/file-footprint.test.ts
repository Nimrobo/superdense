import { describe, it, expect } from 'vitest';
import { collectFootprint, fileFootprintEnricher, type Footprint } from '../file-footprint.js';
import { classifySessionKind, sessionKindEnricher } from '../session-kind.js';
import type { Session, TranscriptEvent } from '../../types.js';

function ctx(events: TranscriptEvent[], pwd = '/proj', agent = 'claude-code') {
  return {
    session: { pwd, agent } as Session,
    logPath: '/tmp/x',
    iterEvents: async function* () {
      for (const e of events) yield e;
    },
  };
}

const tc = (toolName: string, input: unknown, ts?: number): TranscriptEvent => ({
  kind: 'tool_call',
  toolName,
  inputText: JSON.stringify(input),
  ts,
});

describe('collectFootprint', () => {
  it('aggregates writes/reads/ops per pwd-relative path', async () => {
    const fp = await collectFootprint(
      ctx([
        tc('Write', { file_path: '/proj/src/a.ts' }, 1),
        tc('Edit', { file_path: '/proj/src/a.ts' }, 5),
        tc('Read', { file_path: '/proj/src/a.ts' }, 3),
        tc('Read', { file_path: '/proj/README.md' }, 4),
      ]),
    );
    const a = fp.files.find((f) => f.pathRel === 'src/a.ts')!;
    expect(a.writes).toBe(2);
    expect(a.reads).toBe(1);
    expect(a.ops).toEqual({ Write: 1, Edit: 1, Read: 1 });
    expect(a.firstTs).toBe(1);
    expect(a.lastTs).toBe(5);
    expect(a.role).toBe('deliverable');
  });

  it('parses codex apply_patch shell writes', async () => {
    const fp = await collectFootprint(
      ctx(
        [
          tc('shell', {
            command: '*** Add File: src/new.ts\n+x',
          }),
        ],
        '/proj',
        'codex',
      ),
    );
    const f = fp.files.find((x) => x.pathRel === 'src/new.ts')!;
    expect(f).toBeDefined();
    expect(f.writes).toBe(1);
    expect(f.ops).toEqual({ shell: 1 });
  });

  it('ignores non-tool_call events', async () => {
    const fp = await collectFootprint(ctx([{ kind: 'text', role: 'user', text: 'hi' }]));
    expect(fp.files).toEqual([]);
  });
});

describe('fileFootprintEnricher', () => {
  it('returns the {v, files} shape', async () => {
    const out = (await fileFootprintEnricher.run(
      ctx([tc('Write', { file_path: '/proj/x.ts' })]),
    )) as Footprint;
    expect(out.v).toBe(1);
    expect(out.files).toHaveLength(1);
  });
});

describe('classifySessionKind', () => {
  const f = (over: Partial<Parameters<typeof classifySessionKind>[0][number]>) => ({
    pathRel: 'x',
    pathAbs: '/proj/x',
    role: 'deliverable' as const,
    writes: 1,
    reads: 0,
    ops: {},
    firstTs: null,
    lastTs: null,
    ...over,
  });

  it('investigation when nothing written', () => {
    expect(classifySessionKind([f({ writes: 0, reads: 3 })])).toBe('investigation');
  });

  it('deliverable when a real in-pwd file is written', () => {
    expect(classifySessionKind([f({ pathRel: 'src/a.ts' })])).toBe('deliverable');
  });

  it('investigation when only analysis docs are written', () => {
    expect(classifySessionKind([f({ pathRel: 'analysis/notes.md' })])).toBe('investigation');
  });

  it('scaffold when only ~/.claude files are written', () => {
    expect(classifySessionKind([f({ pathRel: '/h/.claude/x', role: 'scaffold' })])).toBe(
      'scaffold',
    );
  });

  it('release when only manifest files are written', () => {
    expect(classifySessionKind([f({ pathRel: 'package.json' })])).toBe('release');
  });
});

describe('sessionKindEnricher', () => {
  it('classifies from the live event stream', async () => {
    const out = (await sessionKindEnricher.run(
      ctx([tc('Write', { file_path: '/proj/src/feature.ts' })]),
    )) as { kind: string };
    expect(out.kind).toBe('deliverable');
  });
});

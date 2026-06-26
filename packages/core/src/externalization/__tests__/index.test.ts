import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../paths.js', () => ({
  DB_PATH: ':memory:',
  SUPERDENSE_HOME: '/tmp/superdense-externalization-test',
  GROUPS_DIR: '/tmp/superdense-externalization-test/queries',
  USER_FILTERS_DIR: '/tmp/superdense-externalization-test/filters',
  LEGACY_USER_FILTERS_DIR: '/tmp/superdense-externalization-test/plugins',
  USER_ENRICHERS_DIR: '/tmp/superdense-externalization-test/enrichers',
  ensureSuperdenseDirs: vi.fn(),
}));

import { _repairForTests, _resetDbForTests, getDb, upsertSession } from '../../db.js';
import { listProjectProfiles } from '../../projects/index.js';
import { applyCurationBatch, finalizeArtifact } from '../../curation/index.js';
import {
  assessExternalization,
  getExternalization,
  listExternalizationInbox,
  listExternalizations,
} from '../index.js';
import type { Session } from '../../types.js';

function session(id: string): Session {
  return {
    id,
    agent: 'codex',
    sessionId: id.slice('codex:'.length),
    logPath: `/tmp/${id}.jsonl`,
    pwd: '/repo',
    projectKey: '/repo',
    createdAt: 100,
    modifiedAt: 100,
  };
}

function createArtifact(id: string): void {
  const sessionId = `codex:${id}`;
  upsertSession(session(sessionId));
  applyCurationBatch({
    actions: [
      {
        type: 'thread.create',
        id,
        projectProfileId: listProjectProfiles()[0]!.id,
        provisionalTitle: `${id} title`,
      },
      { type: 'thread.attach', threadId: id, sessionId, role: 'contributor' },
      { type: 'session.consume', sessionId },
      { type: 'thread.finalize', threadId: id },
    ],
  });
  finalizeArtifact({ threadId: id, type: 'launch', payload: { text: id } });
}

function setArtifactFinalizedAt(id: string, artifactFinalizedAt: number): void {
  getDb()
    .prepare('UPDATE work_thread SET artifact_finalized_at = ? WHERE id = ?')
    .run(artifactFinalizedAt, id);
}

function blockArtifact(id: string): void {
  assessExternalization({
    artifactId: id,
    status: 'external',
    evidence: 'Published artifact is awaiting a connector',
    targets: [{ connector: 'x', status: 'needs_connector' }],
  });
}

beforeEach(() => {
  _resetDbForTests();
});

describe('externalization reconciliation (Layer 4)', () => {
  it('adds V8 folded assessment columns and the target table', () => {
    const db = getDb();
    expect(db.pragma('user_version', { simple: true })).toBe(14);
    const columns = (
      db.prepare('PRAGMA table_info(work_thread)').all() as Array<{ name: string }>
    ).map((row) => row.name);
    expect(columns).toEqual(
      expect.arrayContaining([
        'externalization_status',
        'externalization_evidence',
        'externalization_updated_at',
      ]),
    );
    expect(
      db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'externalization_target'",
        )
        .get(),
    ).toEqual({ name: 'externalization_target' });
  });

  it('reconciles missing V8 target storage when an evolving database reopens', () => {
    const db = getDb();
    db.exec('DROP TABLE externalization_target');

    _repairForTests(db);

    expect(db.pragma('user_version', { simple: true })).toBe(14);
    expect(
      db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'externalization_target'",
        )
        .get(),
    ).toEqual({ name: 'externalization_target' });
  });

  it('lists unprocessed artifacts and completes intentionally internal artifacts', () => {
    createArtifact('t1');
    expect(listExternalizationInbox()).toMatchObject({
      remaining: 1,
      counts: { unprocessed: 1, blocked: 0 },
      items: [{ artifactId: 't1', status: 'unprocessed' }],
    });

    assessExternalization({
      artifactId: 't1',
      status: 'not_external',
      evidence: 'Internal refactor only',
      targets: [],
    });

    expect(getExternalization('t1')).toMatchObject({
      status: 'not_external',
      conclusion: 'not_external',
      evidence: 'Internal refactor only',
      targets: [],
    });
    expect(listExternalizationInbox()).toMatchObject({ items: [], remaining: 0 });
  });

  it('bounds inbox items without changing actionable counts', () => {
    createArtifact('t1');
    createArtifact('t2');

    expect(listExternalizationInbox({ limit: 1 })).toMatchObject({
      items: [{ status: 'unprocessed' }],
      limit: 1,
      remaining: 2,
      counts: { unprocessed: 2, blocked: 0 },
      nextCursor: expect.any(String),
    });
  });

  it('paginates mixed actionable artifacts with stable cursors and global counts', () => {
    createArtifact('t1');
    createArtifact('t2');
    createArtifact('t3');
    setArtifactFinalizedAt('t1', 100);
    setArtifactFinalizedAt('t2', 200);
    setArtifactFinalizedAt('t3', 300);
    blockArtifact('t1');
    blockArtifact('t3');

    const first = listExternalizationInbox({ limit: 1 });
    expect(first).toMatchObject({
      items: [{ artifactId: 't3', status: 'blocked' }],
      remaining: 3,
      counts: { unprocessed: 1, blocked: 2 },
      nextCursor: expect.any(String),
    });

    const second = listExternalizationInbox({ limit: 1, cursor: first.nextCursor! });
    expect(second).toMatchObject({
      items: [{ artifactId: 't2', status: 'unprocessed' }],
      remaining: 3,
      counts: { unprocessed: 1, blocked: 2 },
      nextCursor: expect.any(String),
    });

    expect(listExternalizationInbox({ limit: 1, cursor: second.nextCursor! })).toMatchObject({
      items: [{ artifactId: 't1', status: 'blocked' }],
      remaining: 3,
      counts: { unprocessed: 1, blocked: 2 },
      nextCursor: null,
    });
  });

  it('pages through blocked artifacts beyond the requested limit', () => {
    for (const [id, finalizedAt] of [
      ['t1', 100],
      ['t2', 200],
      ['t3', 300],
    ] as const) {
      createArtifact(id);
      setArtifactFinalizedAt(id, finalizedAt);
      blockArtifact(id);
    }

    const seen: string[] = [];
    let cursor: string | undefined;
    do {
      const page = listExternalizationInbox({ limit: 1, cursor });
      seen.push(...page.items.map((item) => item.artifactId));
      cursor = page.nextCursor ?? undefined;
    } while (cursor);

    expect(seen).toEqual(['t3', 't2', 't1']);
  });

  it('rejects malformed and unsupported inbox cursors', () => {
    expect(() => listExternalizationInbox({ cursor: 'not+a+cursor' })).toThrow(
      'cursor must be a valid externalization inbox cursor',
    );
    expect(() =>
      listExternalizationInbox({
        cursor: Buffer.from(
          JSON.stringify({ v: 2, artifactFinalizedAt: 1, artifactId: 't1' }),
        ).toString('base64url'),
      }),
    ).toThrow('cursor must be a valid externalization inbox cursor');
  });

  it('supports multiple linked targets and opaque locators', () => {
    createArtifact('t1');
    const query = '{"bookmark_id":42,"segment":"launch"}';
    assessExternalization({
      artifactId: 't1',
      status: 'external',
      evidence: 'Published launch and analytics report',
      targets: [
        { connector: 'x', status: 'linked', locator: '187123456789' },
        { connector: 'mixpanel', status: 'linked', locator: query },
      ],
    });

    expect(getExternalization('t1')).toMatchObject({
      status: 'linked',
      targets: expect.arrayContaining([
        expect.objectContaining({ connector: 'x', status: 'linked', locator: '187123456789' }),
        expect.objectContaining({ connector: 'mixpanel', status: 'linked', locator: query }),
      ]),
    });
    expect(listExternalizations({ status: 'linked' })).toHaveLength(1);
  });

  it('keeps blocked targets actionable and allows needs_connector to become linked', () => {
    createArtifact('t1');
    assessExternalization({
      artifactId: 't1',
      status: 'external',
      evidence: 'Launch appears to be published',
      targets: [
        {
          id: 'target-1',
          connector: 'x',
          status: 'needs_connector',
          locator: 'https://x.com/nimrobo/status/187123456789',
          evidence: 'Known URL, but no connector is available',
        },
      ],
    });
    expect(listExternalizationInbox()).toMatchObject({
      remaining: 1,
      counts: { unprocessed: 0, blocked: 1 },
      items: [{ artifactId: 't1', status: 'blocked' }],
    });

    assessExternalization({
      artifactId: 't1',
      status: 'external',
      evidence: 'Resolved with the installed connector',
      targets: [
        {
          id: 'target-1',
          connector: 'x',
          status: 'linked',
          locator: '187123456789',
        },
      ],
    });
    expect(getExternalization('t1')).toMatchObject({
      status: 'linked',
      targets: [{ id: 'target-1', status: 'linked', locator: '187123456789' }],
    });
    expect(listExternalizationInbox()).toMatchObject({ remaining: 0 });
  });

  it('drops retired non-located targets from the reconcile inbox and counts', () => {
    createArtifact('t1');
    blockArtifact('t1'); // external + needs_connector -> blocked, surfaced in the inbox
    expect(listExternalizationInbox()).toMatchObject({
      remaining: 1,
      counts: { unprocessed: 0, blocked: 1 },
    });

    // Retire the non-located target, as `reward next` does after the 7-day window.
    getDb()
      .prepare("UPDATE externalization_target SET collect_status = 'retired' WHERE artifact_id = ?")
      .run('t1');

    expect(listExternalizationInbox()).toMatchObject({
      remaining: 0,
      counts: { unprocessed: 0, blocked: 0 },
    });
  });

  it('hides retired targets from listExternalizations unless includeRetired is set', () => {
    createArtifact('t1');
    assessExternalization({
      artifactId: 't1',
      status: 'external',
      evidence: 'Published',
      targets: [{ id: 'target-1', connector: 'x', status: 'linked', locator: '187123456789' }],
    });
    getDb()
      .prepare("UPDATE externalization_target SET collect_status = 'retired' WHERE id = ?")
      .run('target-1');

    // Status stays 'linked' (derived from the full target set) but the retired
    // target is hidden from the listing by default.
    const defaulted = listExternalizations({ status: 'linked' });
    expect(defaulted).toHaveLength(1);
    expect(defaulted[0]!.targets).toEqual([]);

    const withRetired = listExternalizations({ status: 'linked', includeRetired: true });
    expect(withRetired[0]!.targets).toEqual([
      expect.objectContaining({ id: 'target-1', collectStatus: 'retired' }),
    ]);
  });

  it('blocks re-assessment once a target has retired from collection', () => {
    createArtifact('t1');
    assessExternalization({
      artifactId: 't1',
      status: 'external',
      evidence: 'Published',
      targets: [{ id: 'target-1', connector: 'x', status: 'linked', locator: '187123456789' }],
    });
    getDb()
      .prepare("UPDATE externalization_target SET collect_status = 'retired' WHERE id = ?")
      .run('target-1');

    // A delete+reinsert re-assess would cascade-wipe reward snapshots and reset
    // the lifecycle, so it is refused outright.
    expect(() =>
      assessExternalization({
        artifactId: 't1',
        status: 'external',
        evidence: 'Re-published',
        targets: [{ id: 'target-1', connector: 'x', status: 'linked', locator: '187123456789' }],
      }),
    ).toThrow(/retired collection targets/);
  });

  it('rejects invalid assessments and threads without extracted artifacts', () => {
    upsertSession(session('codex:a'));

    expect(() =>
      assessExternalization({
        artifactId: 'missing',
        status: 'not_external',
        evidence: 'No artifact exists',
        targets: [],
      }),
    ).toThrow('artifact not found: missing');

    createArtifact('t1');
    expect(() =>
      assessExternalization({
        artifactId: 't1',
        status: 'external',
        evidence: 'Missing targets',
        targets: [],
      }),
    ).toThrow('external assessments must include at least one target');
    expect(() =>
      assessExternalization({
        artifactId: 't1',
        status: 'not_external',
        evidence: 'Contradictory',
        targets: [{ connector: 'x', status: 'needs_connector' }],
      }),
    ).toThrow('not_external assessments must not include targets');
    expect(() =>
      assessExternalization({
        artifactId: 't1',
        status: 'external',
        evidence: 'Missing locator',
        targets: [{ connector: 'x', status: 'linked' }],
      }),
    ).toThrow('linked targets must include a non-empty locator');
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../paths.js', () => ({
  DB_PATH: ':memory:',
  SUPERDENSE_HOME: '/tmp/superdense-rewards-test',
  GROUPS_DIR: '/tmp/superdense-rewards-test/queries',
  USER_FILTERS_DIR: '/tmp/superdense-rewards-test/filters',
  LEGACY_USER_FILTERS_DIR: '/tmp/superdense-rewards-test/plugins',
  USER_ENRICHERS_DIR: '/tmp/superdense-rewards-test/enrichers',
  ensureSuperdenseDirs: vi.fn(),
}));

import { _repairForTests, _resetDbForTests, getDb, upsertSession } from '../../db.js';
import { listProjectProfiles } from '../../projects/index.js';
import { applyCurationBatch, finalizeArtifact, getArtifact } from '../../curation/index.js';
import { assessExternalization, getExternalization } from '../../externalization/index.js';
import {
  getArtifactRewards,
  listRewardSnapshots,
  recordRewardSnapshot,
  recordRewardSnapshotBatch,
  retireCollectTarget,
  retireCollectTargets,
  retireUnlocatableTargets,
} from '../index.js';
import { getRewardStatus } from '../../reward-status/index.js';
import type { Session } from '../../types.js';

const DAY_MS = 86400000;

function projectId(): string {
  return listProjectProfiles()[0]!.id;
}

function collectActionable(): number {
  return getRewardStatus({ projectId: projectId() }).stages.find((s) => s.key === 'collect')!
    .actionable;
}

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

// Returns the linked target id for the artifact.
function linkArtifact(id: string, targetId = `${id}-target`): string {
  createArtifact(id);
  assessExternalization({
    artifactId: id,
    status: 'external',
    evidence: 'Published launch',
    targets: [{ id: targetId, connector: 'x', status: 'linked', locator: '187123456789' }],
  });
  return targetId;
}

beforeEach(() => {
  _resetDbForTests();
});

afterEach(() => {
  _resetDbForTests();
});

describe('reward collection (Layer 4)', () => {
  it('adds the V9 reward_snapshot table', () => {
    const db = getDb();
    expect(db.pragma('user_version', { simple: true })).toBe(14);
    expect(
      db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'reward_snapshot'")
        .get(),
    ).toEqual({ name: 'reward_snapshot' });
  });

  it('reconciles a dropped reward_snapshot table when an evolving database reopens', () => {
    const db = getDb();
    db.exec('DROP TABLE reward_snapshot');

    _repairForTests(db);

    expect(db.pragma('user_version', { simple: true })).toBe(14);
    expect(
      db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'reward_snapshot'")
        .get(),
    ).toEqual({ name: 'reward_snapshot' });
  });

  it('records a multidimensional snapshot against a linked target', () => {
    const targetId = linkArtifact('t1');

    const result = recordRewardSnapshot({
      targetId,
      capturedAt: 1700000000000,
      metrics: { views: 1200, likes: 34, reposts: 5 },
      primaryDim: 'views',
      source: 'x api',
      evidence: 'From post analytics',
    });

    expect(result).toMatchObject({
      ok: true,
      snapshot: {
        targetId,
        capturedAt: 1700000000000,
        metrics: { views: 1200, likes: 34, reposts: 5 },
        primaryDim: 'views',
        source: 'x api',
      },
    });
    expect(result.snapshot.id).toBeTruthy();
    expect(result.snapshot.createdAt).toBeGreaterThan(0);
  });

  it('defaults capturedAt to now and allows optional fields to be omitted', () => {
    const targetId = linkArtifact('t1');
    const before = Date.now();

    const { snapshot } = recordRewardSnapshot({ targetId, metrics: { reach: 10 } });

    expect(snapshot.capturedAt).toBeGreaterThanOrEqual(before);
    expect(snapshot.primaryDim).toBeNull();
    expect(snapshot.source).toBeNull();
    expect(snapshot.evidence).toBeNull();
  });

  it('appends an ordered series and surfaces the latest per target', () => {
    const targetId = linkArtifact('t1');

    recordRewardSnapshot({ targetId, capturedAt: 100, metrics: { views: 10 } });
    recordRewardSnapshot({ targetId, capturedAt: 300, metrics: { views: 30 } });
    recordRewardSnapshot({ targetId, capturedAt: 200, metrics: { views: 20 } });

    const series = listRewardSnapshots(targetId);
    expect(series.map((s) => s.capturedAt)).toEqual([300, 200, 100]);

    const rewards = getArtifactRewards('t1');
    expect(rewards).toMatchObject({
      artifactId: 't1',
      targets: [
        {
          targetId,
          connector: 'x',
          locator: '187123456789',
          latest: { capturedAt: 300, metrics: { views: 30 } },
        },
      ],
    });
    expect(rewards!.targets[0]!.snapshots).toHaveLength(3);
  });

  it('records an ordered batch atomically', () => {
    const first = linkArtifact('t1');
    const second = linkArtifact('t2');

    const result = recordRewardSnapshotBatch({
      snapshots: [
        { targetId: first, capturedAt: 100, metrics: { views: 10 } },
        { targetId: second, capturedAt: 200, metrics: { views: 20 } },
      ],
    });

    expect(result.snapshots.map((snapshot) => snapshot.targetId)).toEqual([first, second]);
    expect(listRewardSnapshots(first)).toHaveLength(1);
    expect(listRewardSnapshots(second)).toHaveLength(1);
  });

  it('rolls back a mixed-validity batch and caps batch size', () => {
    const targetId = linkArtifact('t1');
    expect(() =>
      recordRewardSnapshotBatch({
        snapshots: [
          { targetId, metrics: { views: 10 } },
          { targetId: 'missing', metrics: { views: 20 } },
        ],
      }),
    ).toThrow('externalization target not found: missing');
    expect(listRewardSnapshots(targetId)).toEqual([]);

    expect(() =>
      recordRewardSnapshotBatch({
        snapshots: Array.from({ length: 101 }, () => ({
          targetId,
          metrics: { views: 1 },
        })),
      }),
    ).toThrow('at most 100');
  });

  it('reports the failing batch item during shape validation', () => {
    expect(() =>
      recordRewardSnapshotBatch({
        snapshots: [{ targetId: 't', metrics: {} }],
      }),
    ).toThrow('snapshots[0]: metrics must be a non-empty object');
  });

  it('keeps externalization and reward history stable while late lineage is appended and retracted', () => {
    const targetId = linkArtifact('t1');
    recordRewardSnapshot({ targetId, capturedAt: 100, metrics: { views: 10 } });
    upsertSession({ ...session('codex:older'), createdAt: 50, modifiedAt: 50 });

    applyCurationBatch({
      actions: [
        {
          type: 'lineage.attach',
          threadId: 't1',
          sessionId: 'codex:older',
          role: 'evidence',
          rationale: 'late historical evidence',
        },
        {
          type: 'lineage.retract',
          threadId: 't1',
          sessionId: 'codex:older',
          rationale: 'incorrect historical match',
        },
      ],
    });

    expect(getArtifact('t1')).toMatchObject({
      id: 't1',
      payload: { text: 't1' },
      sessions: [{ sessionId: 'codex:t1', role: 'contributor' }],
    });
    expect(getExternalization('t1')).toMatchObject({
      artifactId: 't1',
      status: 'linked',
      targets: [{ id: targetId, locator: '187123456789' }],
    });
    expect(getArtifactRewards('t1')).toMatchObject({
      artifactId: 't1',
      targets: [{ targetId, snapshots: [{ capturedAt: 100, metrics: { views: 10 } }] }],
    });
  });

  it('only returns linked targets and reports none before collection', () => {
    createArtifact('t1');
    assessExternalization({
      artifactId: 't1',
      status: 'external',
      evidence: 'Known URL but no connector',
      targets: [{ connector: 'x', status: 'needs_connector' }],
    });

    const rewards = getArtifactRewards('t1');
    expect(rewards).toEqual({ artifactId: 't1', targets: [] });
  });

  it('returns null for an unknown artifact', () => {
    expect(getArtifactRewards('missing')).toBeNull();
  });

  it('cascade-deletes snapshots when the target is removed', () => {
    const targetId = linkArtifact('t1');
    recordRewardSnapshot({ targetId, metrics: { views: 5 } });
    expect(listRewardSnapshots(targetId)).toHaveLength(1);

    // Reassessing replaces the target set, removing the prior linked target row.
    assessExternalization({
      artifactId: 't1',
      status: 'not_external',
      evidence: 'Retracted',
      targets: [],
    });

    expect(
      getDb()
        .prepare('SELECT COUNT(*) AS n FROM reward_snapshot WHERE target_id = ?')
        .get(targetId),
    ).toEqual({ n: 0 });
  });

  it('rejects snapshots against missing or non-linked targets', () => {
    expect(() => recordRewardSnapshot({ targetId: 'nope', metrics: { views: 1 } })).toThrow(
      'externalization target not found: nope',
    );

    createArtifact('t1');
    assessExternalization({
      artifactId: 't1',
      status: 'external',
      evidence: 'Blocked',
      targets: [{ id: 'blocked-target', connector: 'x', status: 'needs_connector' }],
    });
    expect(() =>
      recordRewardSnapshot({ targetId: 'blocked-target', metrics: { views: 1 } }),
    ).toThrow('reward snapshots require a linked externalization target');
  });

  it('rejects invalid metrics and primaryDim', () => {
    const targetId = linkArtifact('t1');

    expect(() => recordRewardSnapshot({ targetId, metrics: {} })).toThrow(
      'metrics must be a non-empty object of finite numbers',
    );
    expect(() => recordRewardSnapshot({ targetId, metrics: [1, 2] })).toThrow(
      'metrics must be a non-empty object of finite numbers',
    );
    expect(() => recordRewardSnapshot({ targetId, metrics: { views: 'lots' } })).toThrow(
      'metrics.views must be a finite number',
    );
    expect(() => recordRewardSnapshot({ targetId, metrics: { views: Infinity } })).toThrow(
      'metrics.views must be a finite number',
    );
    expect(() =>
      recordRewardSnapshot({ targetId, metrics: { views: 1 }, primaryDim: 'likes' }),
    ).toThrow('primaryDim must be a key in metrics');
    expect(() =>
      recordRewardSnapshot({ targetId, metrics: { views: 1 }, capturedAt: 1.5 }),
    ).toThrow('capturedAt must be an integer epoch millisecond timestamp');
  });
});

describe('reward collection retirement (V13)', () => {
  it('defaults to retiring a linked target 7 days after its first snapshot', () => {
    const targetId = linkArtifact('t1');
    recordRewardSnapshot({ targetId, capturedAt: Date.now() - 8 * DAY_MS, metrics: { reach: 10 } });

    const { retired } = retireCollectTargets({ projectId: projectId() });

    expect(retired).toEqual([
      expect.objectContaining({ targetId, reason: 'time', snapshotCount: 1 }),
    ]);
    expect(getArtifactRewards('t1')!.targets[0]!.collectStatus).toBe('retired');
  });

  it('does not retire a target whose first snapshot is still inside the window', () => {
    const targetId = linkArtifact('t1');
    recordRewardSnapshot({ targetId, capturedAt: Date.now() - 1 * DAY_MS, metrics: { reach: 10 } });

    expect(retireCollectTargets({ projectId: projectId() }).retired).toEqual([]);
    expect(getArtifactRewards('t1')!.targets[0]!.collectStatus).toBe('active');
  });

  it('never auto-retires a target that has no snapshots yet', () => {
    linkArtifact('t1');
    expect(retireCollectTargets({ projectId: projectId() }).retired).toEqual([]);
    expect(getArtifactRewards('t1')!.targets[0]!.collectStatus).toBe('active');
  });

  it('retires by snapshot count when retireAfterN is fixed at assess time', () => {
    createArtifact('t1');
    assessExternalization({
      artifactId: 't1',
      status: 'external',
      evidence: 'Published',
      targets: [
        {
          id: 't1-target',
          connector: 'x',
          status: 'linked',
          locator: '187123456789',
          retireAfterN: 2,
        },
      ],
    });
    recordRewardSnapshot({ targetId: 't1-target', capturedAt: Date.now(), metrics: { reach: 1 } });

    // One snapshot is below the count threshold and the fresh snapshot is well
    // inside the time backstop, so the target stays active.
    expect(retireCollectTargets({ projectId: projectId() }).retired).toEqual([]);

    recordRewardSnapshot({ targetId: 't1-target', capturedAt: Date.now(), metrics: { reach: 2 } });
    expect(retireCollectTargets({ projectId: projectId() }).retired).toEqual([
      expect.objectContaining({ targetId: 't1-target', reason: 'count', snapshotCount: 2 }),
    ]);
  });

  it('still retires a count-bound target on the time backstop when the quota is never reached', () => {
    createArtifact('t1');
    assessExternalization({
      artifactId: 't1',
      status: 'external',
      evidence: 'Published',
      targets: [
        {
          id: 't1-target',
          connector: 'x',
          status: 'linked',
          locator: '187123456789',
          retireAfterN: 5,
        },
      ],
    });
    // Only one of the five requested snapshots was ever collected, but it is now
    // older than the default window. Before the backstop fix this target would
    // sit active forever (never invisible, never cleaned up); now it retires.
    recordRewardSnapshot({
      targetId: 't1-target',
      capturedAt: Date.now() - 8 * DAY_MS,
      metrics: { reach: 1 },
    });

    expect(retireCollectTargets({ projectId: projectId() }).retired).toEqual([
      expect.objectContaining({ targetId: 't1-target', reason: 'time', snapshotCount: 1 }),
    ]);
  });

  it('honors a short retireAfterMs override', () => {
    createArtifact('t1');
    assessExternalization({
      artifactId: 't1',
      status: 'external',
      evidence: 'Published',
      targets: [
        {
          id: 't1-target',
          connector: 'x',
          status: 'linked',
          locator: '187123456789',
          retireAfterMs: 1000,
        },
      ],
    });
    recordRewardSnapshot({
      targetId: 't1-target',
      capturedAt: Date.now() - 5000,
      metrics: { reach: 1 },
    });

    expect(retireCollectTargets({ projectId: projectId() }).retired).toEqual([
      expect.objectContaining({ targetId: 't1-target', reason: 'time' }),
    ]);
  });

  it('retires a non-located target older than the default window', () => {
    createArtifact('t1');
    assessExternalization({
      artifactId: 't1',
      status: 'external',
      evidence: 'Assessed but unlocatable',
      targets: [{ id: 't1-target', connector: 'x', status: 'needs_connector' }],
    });
    // Backdate the target's created_at past the 7-day window.
    getDb()
      .prepare('UPDATE externalization_target SET created_at = ? WHERE id = ?')
      .run(Date.now() - 8 * DAY_MS, 't1-target');

    const { retired } = retireUnlocatableTargets({ projectId: projectId() });
    expect(retired).toEqual([
      expect.objectContaining({ targetId: 't1-target', reason: 'time', snapshotCount: 0 }),
    ]);
    expect(getExternalization('t1')!.targets[0]!.collectStatus).toBe('retired');
  });

  it('leaves fresh non-located targets and linked targets alone', () => {
    createArtifact('t1');
    assessExternalization({
      artifactId: 't1',
      status: 'external',
      evidence: 'Assessed but unlocatable',
      targets: [{ id: 't1-target', connector: 'x', status: 'needs_connector' }],
    });
    // An old linked target is the collect pass's job, not this one.
    const linkedId = linkArtifact('t2');
    getDb()
      .prepare('UPDATE externalization_target SET created_at = ? WHERE id = ?')
      .run(Date.now() - 30 * DAY_MS, linkedId);

    expect(retireUnlocatableTargets({ projectId: projectId() }).retired).toEqual([]);
    expect(getExternalization('t1')!.targets[0]!.collectStatus).toBe('active');
    expect(getArtifactRewards('t2')!.targets[0]!.collectStatus).toBe('active');
  });

  it('force-retires a single target and drops it from the collectable count', () => {
    const targetId = linkArtifact('t1');
    expect(collectActionable()).toBe(1);

    const { retired } = retireCollectTarget(targetId);
    expect(retired).toMatchObject({ targetId, reason: 'manual' });
    expect(getArtifactRewards('t1')!.targets[0]!.collectStatus).toBe('retired');
    expect(collectActionable()).toBe(0);

    // Idempotent: retiring again is a no-op.
    expect(retireCollectTarget(targetId).retired).toBeNull();
  });

  it('rejects force-retiring a missing or non-linked target', () => {
    expect(() => retireCollectTarget('nope')).toThrow('externalization target not found: nope');

    createArtifact('t1');
    assessExternalization({
      artifactId: 't1',
      status: 'external',
      evidence: 'Blocked',
      targets: [{ id: 'blocked', connector: 'x', status: 'needs_connector' }],
    });
    expect(() => retireCollectTarget('blocked')).toThrow('only linked targets can be retired');
  });

  it('rejects a non-positive retire override at assess time', () => {
    createArtifact('t1');
    expect(() =>
      assessExternalization({
        artifactId: 't1',
        status: 'external',
        evidence: 'Published',
        targets: [
          {
            id: 't1-target',
            connector: 'x',
            status: 'linked',
            locator: '187123456789',
            retireAfterN: 0,
          },
        ],
      }),
    ).toThrow('targets[0].retireAfterN must be a positive integer or null');
  });
});

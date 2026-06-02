import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../paths.js', () => ({
  DB_PATH: ':memory:',
  SUPERDENSE_HOME: '/tmp/superdense-curation-test',
  GROUPS_DIR: '/tmp/superdense-curation-test/queries',
  USER_FILTERS_DIR: '/tmp/superdense-curation-test/filters',
  LEGACY_USER_FILTERS_DIR: '/tmp/superdense-curation-test/plugins',
  USER_ENRICHERS_DIR: '/tmp/superdense-curation-test/enrichers',
  ensureSuperdenseDirs: vi.fn(),
}));

import { _resetDbForTests, getDb, getSession, upsertSession, upsertSessionLink } from '../../db.js';
import { listProjectProfiles } from '../../projects/index.js';
import {
  applyCurationBatch,
  finalizeArtifact,
  getArtifact,
  getCurationContext,
  getWorkThread,
  listArtifacts,
  listCurationInbox,
  listWorkThreads,
  markSessionForCuration,
  reconcileIndexedSession,
  sessionRevision,
} from '../index.js';
import type { Session } from '../../types.js';

const session = (id: string, modifiedAt: number, extra: Partial<Session> = {}): Session => ({
  id,
  agent: id.split(':')[0]!,
  sessionId: id.split(':')[1]!,
  logPath: `/tmp/${id}.jsonl`,
  pwd: '/repo',
  projectKey: '/repo',
  modifiedAt,
  messageCount: 1,
  ...extra,
});

function projectId(): string {
  return listProjectProfiles()[0]!.id;
}

beforeEach(() => {
  _resetDbForTests();
});

describe('curation inbox', () => {
  it('buffers a mark before indexing and merges it after discovery', () => {
    expect(markSessionForCuration('codex:later', 50)).toEqual({
      sessionId: 'codex:later',
      buffered: true,
      markedAt: 50,
    });
    upsertSession(session('codex:later', 100));
    reconcileIndexedSession('codex:later', true);
    expect(getSession('codex:later')).toMatchObject({ curationPriorityAt: 50 });
    expect(getDb().prepare('SELECT COUNT(*) AS count FROM pending_session_marker').get()).toEqual({
      count: 0,
    });
  });

  it('orders marked, new or changed, deferred, and historical roots', () => {
    for (const item of [
      session('codex:historical', 400),
      session('codex:deferred', 300),
      session('codex:new', 200),
      session('codex:marked', 100),
    ]) {
      upsertSession(item);
    }
    const db = getDb();
    db.prepare('UPDATE sessions SET curated_revision = ? WHERE id = ?').run(
      sessionRevision(getSession('codex:historical')!),
      'codex:historical',
    );
    db.prepare(
      "UPDATE sessions SET curation_status = 'deferred' WHERE id = 'codex:deferred'",
    ).run();
    markSessionForCuration('codex:marked', 99);

    expect(
      listCurationInbox({ projectId: projectId(), limit: 10 }).items.map((item) => item.id),
    ).toEqual(['codex:marked', 'codex:new', 'codex:deferred', 'codex:historical']);
  });

  it('re-marks reviewed sessions as pending without lowering an existing priority', () => {
    upsertSession(session('codex:a', 100));
    const db = getDb();
    db.prepare(
      "UPDATE sessions SET curation_status = 'skipped', curation_priority_at = 200 WHERE id = ?",
    ).run('codex:a');

    markSessionForCuration('codex:a', 100);

    expect(getSession('codex:a')).toMatchObject({
      curationStatus: 'pending',
      curationPriorityAt: 200,
    });
    expect(listCurationInbox({ limit: 1 }).items[0]).toMatchObject({ id: 'codex:a' });
  });

  it('resolves explicitly marked subagents upward and includes them in context', () => {
    upsertSession(session('codex:root', 100));
    upsertSession(session('codex:child', 110, { isSubagent: true, parentSessionId: 'codex:root' }));
    upsertSessionLink('codex:root', 'codex:child', 'subagent', { depth: 1 }, 1);
    markSessionForCuration('codex:child', 200);

    expect(listCurationInbox().items[0]).toMatchObject({
      id: 'codex:root',
      curationPriorityAt: 200,
    });
    expect(getCurationContext('codex:child')).toMatchObject({
      requestedSessionId: 'codex:child',
      rootSessionId: 'codex:root',
      sessions: [{ session: { id: 'codex:root' } }, { session: { id: 'codex:child' } }],
    });
  });

  it('accounts for roots across repeated bounded sweeps without rereading skipped sessions', () => {
    for (const id of ['codex:a', 'codex:b', 'codex:c']) upsertSession(session(id, 100));
    const seen: string[] = [];

    while (listCurationInbox({ limit: 1 }).remaining > 0) {
      const item = listCurationInbox({ limit: 1 }).items[0]!;
      seen.push(item.id as string);
      applyCurationBatch({ actions: [{ type: 'session.skip', sessionId: item.id }] });
    }

    expect(seen.sort()).toEqual(['codex:a', 'codex:b', 'codex:c']);
    expect(listCurationInbox({ limit: 1 })).toMatchObject({ items: [], remaining: 0 });
  });
});

describe('curation actions', () => {
  it('allows one session to belong to multiple work threads', () => {
    upsertSession(session('codex:a', 100));
    const profileId = projectId();
    applyCurationBatch({
      actions: [
        { type: 'thread.create', id: 't1', projectProfileId: profileId, provisionalTitle: 'One' },
        { type: 'thread.create', id: 't2', projectProfileId: profileId, provisionalTitle: 'Two' },
        { type: 'thread.attach', threadId: 't1', sessionId: 'codex:a', role: 'contributor' },
        { type: 'thread.attach', threadId: 't2', sessionId: 'codex:a', role: 'evidence' },
      ],
    });

    expect(getWorkThread('t1')?.sessions).toHaveLength(1);
    expect(getWorkThread('t2')?.sessions).toHaveLength(1);
  });

  it('applies create, update, attach, detach, merge, split, and session decisions atomically', () => {
    for (const id of ['codex:a', 'codex:b', 'codex:c']) upsertSession(session(id, 100));
    const profileId = projectId();

    applyCurationBatch({
      actions: [
        { type: 'thread.create', id: 't1', projectProfileId: profileId, provisionalTitle: 'One' },
        { type: 'thread.create', id: 't2', projectProfileId: profileId, provisionalTitle: 'Two' },
        { type: 'thread.attach', threadId: 't1', sessionId: 'codex:a', role: 'contributor' },
        { type: 'thread.attach', threadId: 't1', sessionId: 'codex:b', role: 'evidence' },
        { type: 'thread.attach', threadId: 't2', sessionId: 'codex:c', role: 'contributor' },
        { type: 'thread.merge', targetThreadId: 't1', sourceThreadIds: ['t2'] },
        {
          type: 'thread.split',
          sourceThreadId: 't1',
          threads: [{ id: 't3', provisionalTitle: 'Split', sessionIds: ['codex:a'] }],
        },
        { type: 'thread.attach', threadId: 't1', sessionId: 'codex:a', role: 'evidence' },
        { type: 'thread.detach', threadId: 't1', sessionId: 'codex:a' },
        { type: 'thread.update', threadId: 't3', patch: { summary: 'Finalized split' } },
        { type: 'session.consume', sessionId: 'codex:a', note: 'Useful' },
        { type: 'session.skip', sessionId: 'codex:b' },
        { type: 'session.defer', sessionId: 'codex:c' },
      ],
    });

    expect(listWorkThreads().map((thread) => thread.id)).toEqual(
      expect.arrayContaining(['t1', 't3']),
    );
    expect(getWorkThread('t2')).toBeNull();
    expect(getWorkThread('t3')).toMatchObject({
      summary: 'Finalized split',
      sessions: [{ sessionId: 'codex:a', role: 'contributor' }],
    });
    expect(getSession('codex:a')).toMatchObject({
      curationStatus: 'consumed',
      curationNote: 'Useful',
    });
    expect(getSession('codex:b')).toMatchObject({ curationStatus: 'skipped' });
    expect(getSession('codex:c')).toMatchObject({ curationStatus: 'deferred' });
  });

  it('rejects consumption without thread membership and rolls the batch back', () => {
    upsertSession(session('codex:a', 100));
    expect(() =>
      applyCurationBatch({ actions: [{ type: 'session.consume', sessionId: 'codex:a' }] }),
    ).toThrow('consumed session must be attached to at least one thread');
    expect(getSession('codex:a')).toMatchObject({ curationStatus: 'pending' });
  });

  it('resets reviewed roots after revision changes while preserving memberships', () => {
    upsertSession(session('codex:a', 100));
    const profileId = projectId();
    applyCurationBatch({
      actions: [
        { type: 'thread.create', id: 't1', projectProfileId: profileId, provisionalTitle: 'One' },
        { type: 'thread.attach', threadId: 't1', sessionId: 'codex:a', role: 'contributor' },
        { type: 'session.consume', sessionId: 'codex:a' },
      ],
    });

    upsertSession(session('codex:a', 200, { messageCount: 2 }));
    reconcileIndexedSession('codex:a', true);

    expect(getSession('codex:a')).toMatchObject({ curationStatus: 'pending' });
    expect(getWorkThread('t1')?.sessions).toEqual([
      { sessionId: 'codex:a', role: 'contributor', rationale: null },
    ]);
  });

  it('resets a reviewed root when a linked subagent revision changes', () => {
    upsertSession(session('codex:root', 100));
    upsertSession(session('codex:child', 100, { isSubagent: true, parentSessionId: 'codex:root' }));
    upsertSessionLink('codex:root', 'codex:child', 'subagent', null, 1);
    applyCurationBatch({
      actions: [
        {
          type: 'thread.create',
          id: 't1',
          projectProfileId: projectId(),
          provisionalTitle: 'Root',
        },
        { type: 'thread.attach', threadId: 't1', sessionId: 'codex:root', role: 'contributor' },
        { type: 'session.consume', sessionId: 'codex:root' },
      ],
    });

    upsertSession(
      session('codex:child', 200, {
        isSubagent: true,
        parentSessionId: 'codex:root',
        messageCount: 2,
      }),
    );
    reconcileIndexedSession('codex:child', true);

    expect(getSession('codex:root')).toMatchObject({
      curationStatus: 'pending',
      curatedRevision: null,
    });
    expect(getWorkThread('t1')?.sessions).toHaveLength(1);
  });

  it('reports root resolution when an action names a subagent', () => {
    upsertSession(session('codex:root', 100));
    upsertSession(session('codex:child', 100, { isSubagent: true, parentSessionId: 'codex:root' }));
    upsertSessionLink('codex:root', 'codex:child', 'subagent', null, 1);

    expect(
      applyCurationBatch({
        actions: [{ type: 'session.skip', sessionId: 'codex:child' }],
      }),
    ).toMatchObject({
      resolvedSessions: [{ requestedSessionId: 'codex:child', rootSessionId: 'codex:root' }],
    });
    expect(getSession('codex:root')).toMatchObject({ curationStatus: 'skipped' });
  });

  it('re-marking a subagent resurfaces its reviewed root', () => {
    upsertSession(session('codex:root', 100));
    upsertSession(session('codex:child', 100, { isSubagent: true, parentSessionId: 'codex:root' }));
    upsertSessionLink('codex:root', 'codex:child', 'subagent', null, 1);
    applyCurationBatch({ actions: [{ type: 'session.skip', sessionId: 'codex:root' }] });

    markSessionForCuration('codex:child', 200);

    expect(getSession('codex:root')).toMatchObject({ curationStatus: 'pending' });
    expect(listCurationInbox({ limit: 1 }).items[0]).toMatchObject({
      id: 'codex:root',
      curationPriorityAt: 200,
    });
  });
});

describe('artifact finalization (Layer 3B)', () => {
  function consumedThread(id: string, sessionIds: Array<[string, number]>): string {
    for (const [sessionId, createdAt] of sessionIds) {
      upsertSession(session(sessionId, createdAt, { createdAt }));
    }
    const actions: Array<Record<string, unknown>> = [
      { type: 'thread.create', id, projectProfileId: projectId(), provisionalTitle: `${id} title` },
    ];
    for (const [sessionId] of sessionIds) {
      actions.push({ type: 'thread.attach', threadId: id, sessionId, role: 'contributor' });
      actions.push({ type: 'session.consume', sessionId });
    }
    applyCurationBatch({ actions });
    return id;
  }

  it('adds the V7 artifact columns to work_thread', () => {
    const columns = (
      getDb().prepare('PRAGMA table_info(work_thread)').all() as Array<{ name: string }>
    ).map((row) => row.name);
    expect(columns).toEqual(
      expect.arrayContaining(['artifact_type', 'payload', 'artifact_finalized_at']),
    );
  });

  it('finalizes a thread then extracts an immutable artifact with frozen lineage', () => {
    consumedThread('t1', [
      ['codex:a', 100],
      ['codex:b', 200],
    ]);
    applyCurationBatch({ actions: [{ type: 'thread.finalize', threadId: 't1' }] });
    expect(getWorkThread('t1')).toMatchObject({ status: 'finalized', lifecycle: 'finalized' });

    expect(
      finalizeArtifact({
        threadId: 't1',
        type: 'tweet',
        title: 'Launch announcement',
        payload: { text: 'Launching today' },
      }),
    ).toEqual({ ok: true, threadId: 't1', artifactType: 'tweet' });

    const artifact = getArtifact('t1');
    expect(artifact).toMatchObject({
      artifactType: 'tweet',
      provisionalTitle: 'Launch announcement',
      payload: { text: 'Launching today' },
      lifecycle: 'artifact',
      headSessionId: 'codex:b',
    });
    // Lineage is ordered by session creation time (first need -> final).
    expect(artifact?.sessions?.map((item) => item.sessionId)).toEqual(['codex:a', 'codex:b']);
  });

  it('keeps the provisional title when finalize omits one', () => {
    consumedThread('t1', [['codex:a', 100]]);
    applyCurationBatch({ actions: [{ type: 'thread.finalize', threadId: 't1' }] });
    finalizeArtifact({ threadId: 't1', type: 'note' });
    expect(getArtifact('t1')).toMatchObject({ provisionalTitle: 't1 title', payload: {} });
  });

  it('locks a finalized thread against further curation', () => {
    consumedThread('t1', [['codex:a', 100]]);
    applyCurationBatch({ actions: [{ type: 'thread.finalize', threadId: 't1' }] });

    expect(() =>
      applyCurationBatch({
        actions: [{ type: 'thread.update', threadId: 't1', patch: { summary: 'x' } }],
      }),
    ).toThrow('finalized and can no longer be curated');
    expect(() =>
      applyCurationBatch({
        actions: [{ type: 'thread.detach', threadId: 't1', sessionId: 'codex:a' }],
      }),
    ).toThrow('finalized and can no longer be curated');
  });

  it('rejects finalizing a thread with no sessions', () => {
    upsertSession(session('codex:a', 100));
    applyCurationBatch({
      actions: [
        {
          type: 'thread.create',
          id: 't1',
          projectProfileId: projectId(),
          provisionalTitle: 'Empty',
        },
      ],
    });
    expect(() =>
      applyCurationBatch({ actions: [{ type: 'thread.finalize', threadId: 't1' }] }),
    ).toThrow('no sessions to finalize');
  });

  it('rejects artifact extraction before the thread is finalized', () => {
    consumedThread('t1', [['codex:a', 100]]);
    expect(() => finalizeArtifact({ threadId: 't1', type: 'tweet' })).toThrow(
      'must be finalized before extracting an artifact',
    );
  });

  it('rejects a second artifact on the same thread', () => {
    consumedThread('t1', [['codex:a', 100]]);
    applyCurationBatch({ actions: [{ type: 'thread.finalize', threadId: 't1' }] });
    finalizeArtifact({ threadId: 't1', type: 'tweet' });
    expect(() => finalizeArtifact({ threadId: 't1', type: 'feature' })).toThrow(
      'already has an artifact',
    );
  });

  it('lists finalized artifacts and filters by type, excluding open threads', () => {
    consumedThread('t1', [['codex:a', 100]]);
    consumedThread('t2', [['codex:b', 100]]);
    consumedThread('t3', [['codex:c', 100]]);
    for (const id of ['t1', 't2']) {
      applyCurationBatch({ actions: [{ type: 'thread.finalize', threadId: id }] });
    }
    finalizeArtifact({ threadId: 't1', type: 'tweet' });
    finalizeArtifact({ threadId: 't2', type: 'feature' });

    expect(
      listArtifacts()
        .map((item) => item.id)
        .sort(),
    ).toEqual(['t1', 't2']);
    expect(listArtifacts({ type: 'tweet' }).map((item) => item.id)).toEqual(['t1']);
  });
});

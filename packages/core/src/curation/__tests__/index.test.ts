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

import {
  _migrateForTests,
  _repairForTests,
  _resetDbForTests,
  getDb,
  getSession,
  upsertSession,
  upsertSessionLink,
} from '../../db.js';
import { listProjectProfiles } from '../../projects/index.js';
import {
  applyCurationBatch,
  finalizeArtifact,
  getArtifact,
  getCurationContext,
  getWorkThread,
  listArtifactInbox,
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

  it('prioritizes marked roots, then deliverable roots, before the remaining universal backlog', () => {
    for (const item of [
      session('codex:ordinary', 300),
      session('codex:deliverable', 200),
      session('codex:marked', 100),
    ]) {
      upsertSession(item);
    }
    getDb()
      .prepare(
        `INSERT INTO session_enrich (
           session_id, query_run_id, name, version, value, computed_at
         ) VALUES ('codex:deliverable', 'system', 'session_kind', 2, ?, 1)`,
      )
      .run(JSON.stringify({ v: 1, kind: 'deliverable' }));
    markSessionForCuration('codex:marked', 99);

    expect(listCurationInbox({ limit: 10 }).items.map((item) => item.id)).toEqual([
      'codex:marked',
      'codex:deliverable',
      'codex:ordinary',
    ]);
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

  it('rejects direct lifecycle status manipulation', () => {
    upsertSession(session('codex:a', 100));
    expect(() =>
      applyCurationBatch({
        actions: [
          {
            type: 'thread.create',
            id: 't1',
            projectProfileId: projectId(),
            provisionalTitle: 'One',
            status: 'ready',
          },
        ],
      }),
    ).toThrow('thread.create.status is not supported');

    applyCurationBatch({
      actions: [
        {
          type: 'thread.create',
          id: 't1',
          projectProfileId: projectId(),
          provisionalTitle: 'One',
        },
      ],
    });
    expect(() =>
      applyCurationBatch({
        actions: [{ type: 'thread.update', threadId: 't1', patch: { status: 'ready' } }],
      }),
    ).toThrow('unsupported thread patch field: status');
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
      expect.arrayContaining(['artifact_type', 'payload', 'artifact_finalized_at', 'human_only']),
    );
  });

  it('defaults existing and ordinary work threads to non-human-only', () => {
    consumedThread('t1', [['codex:a', 100]]);
    expect(getWorkThread('t1')).toMatchObject({ humanOnly: false });
  });

  it('reconciles V10 readiness and backfills lineage events idempotently', () => {
    consumedThread('t1', [['codex:a', 100]]);
    const db = getDb();
    db.exec(`
      DELETE FROM work_thread_lineage_event;
      UPDATE work_thread SET status = 'finalized', readiness_rationale = NULL;
      CREATE TABLE work_thread_frontier (id TEXT);
    `);

    _repairForTests(db);
    _repairForTests(db);

    expect(db.pragma('user_version', { simple: true })).toBe(11);
    expect(getWorkThread('t1')).toMatchObject({
      lifecycle: 'ready',
      readinessRationale: 'Migrated from pre-V10 finalized thread',
    });
    expect(
      db
        .prepare(
          "SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'work_thread_frontier'",
        )
        .get(),
    ).toEqual({ count: 0 });
    expect(
      db.prepare('SELECT event_type, COUNT(*) AS count FROM work_thread_lineage_event').get(),
    ).toEqual({ event_type: 'attach', count: 1 });
  });

  it('removes pre-release synthetic lineage events when an audited event exists', () => {
    consumedThread('t1', [['codex:a', 100]]);
    const db = getDb();
    db.prepare(
      `INSERT INTO work_thread_lineage_event (
         id, thread_id, session_id, event_type, role, rationale, created_at
       ) VALUES ('v10-backfill:t1:codex:a', 't1', 'codex:a', 'attach', 'contributor',
                 'Backfilled from pre-V10 effective lineage', 0)`,
    ).run();

    _repairForTests(db);
    _repairForTests(db);

    expect(
      db.prepare('SELECT id FROM work_thread_lineage_event WHERE thread_id = ?').all('t1'),
    ).toHaveLength(1);
    expect(
      db
        .prepare(
          "SELECT COUNT(*) AS count FROM work_thread_lineage_event WHERE id LIKE 'v10-backfill:%'",
        )
        .get(),
    ).toEqual({ count: 0 });
  });

  it('queues a ready thread then creates a stable artifact payload', () => {
    consumedThread('t1', [
      ['codex:a', 100],
      ['codex:b', 200],
    ]);
    applyCurationBatch({ actions: [{ type: 'thread.finalize', threadId: 't1' }] });
    expect(getWorkThread('t1')).toMatchObject({ status: 'ready', lifecycle: 'ready' });
    expect(listArtifactInbox().items.map((item) => item.id)).toEqual(['t1']);

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

  it('locks a ready thread against regrouping', () => {
    consumedThread('t1', [['codex:a', 100]]);
    applyCurationBatch({ actions: [{ type: 'thread.finalize', threadId: 't1' }] });

    expect(() =>
      applyCurationBatch({
        actions: [{ type: 'thread.update', threadId: 't1', patch: { summary: 'x' } }],
      }),
    ).toThrow('ready and can no longer be regrouped');
    expect(() =>
      applyCurationBatch({
        actions: [{ type: 'thread.detach', threadId: 't1', sessionId: 'codex:a' }],
      }),
    ).toThrow('ready and can no longer be regrouped');
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
    ).toThrow('must have a contributor session or humanOnly=true to mark ready');
  });

  it('creates a human-only artifact without synthetic sessions', () => {
    upsertSession(session('codex:project-seed', 100));
    applyCurationBatch({
      actions: [
        {
          type: 'thread.create',
          id: 'human',
          projectProfileId: projectId(),
          provisionalTitle: 'Manual post',
          summary: 'Written and published directly by the human',
          humanOnly: true,
        },
        {
          type: 'thread.mark-ready',
          threadId: 'human',
          rationale: 'Final human-authored output is known',
        },
      ],
    });

    finalizeArtifact({ threadId: 'human', type: 'post', payload: { text: 'Manual post' } });

    expect(getArtifact('human')).toMatchObject({
      humanOnly: true,
      artifactType: 'post',
      sessions: [],
    });
  });

  it('rejects a batch that sets humanOnly=true and attaches a contributor on the same thread', () => {
    upsertSession(session('codex:a', 100));
    expect(() =>
      applyCurationBatch({
        actions: [
          {
            type: 'thread.create',
            id: 'human',
            projectProfileId: projectId(),
            provisionalTitle: 'Manual post',
            humanOnly: true,
          },
          {
            type: 'thread.attach',
            threadId: 'human',
            sessionId: 'codex:a',
            role: 'contributor',
          },
        ],
      }),
    ).toThrow('batch sets humanOnly=true and attaches a contributor');
    expect(getWorkThread('human')).toBeNull();
  });

  it('rejects thread.update humanOnly=true when contributors are already attached', () => {
    upsertSession(session('codex:a', 100));
    applyCurationBatch({
      actions: [
        {
          type: 'thread.create',
          id: 'human',
          projectProfileId: projectId(),
          provisionalTitle: 'Manual post',
        },
        { type: 'thread.attach', threadId: 'human', sessionId: 'codex:a', role: 'contributor' },
      ],
    });
    expect(() =>
      applyCurationBatch({
        actions: [{ type: 'thread.update', threadId: 'human', patch: { humanOnly: true } }],
      }),
    ).toThrow('cannot be human-only while contributor sessions are attached');
  });

  it('rejects a batch that sets humanOnly=true via update and also attaches a contributor in the same batch', () => {
    upsertSession(session('codex:a', 100));
    applyCurationBatch({
      actions: [
        {
          type: 'thread.create',
          id: 'human',
          projectProfileId: projectId(),
          provisionalTitle: 'Manual post',
        },
      ],
    });
    expect(() =>
      applyCurationBatch({
        actions: [
          { type: 'thread.update', threadId: 'human', patch: { humanOnly: true } },
          { type: 'thread.attach', threadId: 'human', sessionId: 'codex:a', role: 'contributor' },
        ],
      }),
    ).toThrow('batch sets humanOnly=true and attaches a contributor');
  });

  it('allows a batch that sets humanOnly=true and attaches an evidence session on the same thread', () => {
    upsertSession(session('codex:evidence', 100));
    applyCurationBatch({
      actions: [
        {
          type: 'thread.create',
          id: 'human',
          projectProfileId: projectId(),
          provisionalTitle: 'Manual post',
          humanOnly: true,
        },
        { type: 'thread.attach', threadId: 'human', sessionId: 'codex:evidence', role: 'evidence' },
      ],
    });
    expect(getWorkThread('human')).toMatchObject({ humanOnly: true });
  });

  it('allows humanOnly on one thread while attaching a contributor to a different thread in the same batch', () => {
    upsertSession(session('codex:a', 100));
    applyCurationBatch({
      actions: [
        {
          type: 'thread.create',
          id: 'human',
          projectProfileId: projectId(),
          provisionalTitle: 'Manual post',
          humanOnly: true,
        },
        {
          type: 'thread.create',
          id: 'agent-work',
          projectProfileId: projectId(),
          provisionalTitle: 'Agent post',
        },
        { type: 'thread.attach', threadId: 'agent-work', sessionId: 'codex:a', role: 'contributor' },
      ],
    });
    expect(getWorkThread('human')).toMatchObject({ humanOnly: true });
    expect(getWorkThread('agent-work')).toMatchObject({ humanOnly: false });
  });

  it('keeps humanOnly for evidence and clears it for late artifact contributors', () => {
    for (const id of ['codex:evidence', 'codex:contributor']) {
      upsertSession(session(id, 100));
    }
    applyCurationBatch({
      actions: [
        {
          type: 'thread.create',
          id: 'human',
          projectProfileId: projectId(),
          provisionalTitle: 'Manual post',
          humanOnly: true,
        },
        {
          type: 'thread.attach',
          threadId: 'human',
          sessionId: 'codex:evidence',
          role: 'evidence',
        },
        {
          type: 'thread.mark-ready',
          threadId: 'human',
          rationale: 'Human-authored output',
        },
      ],
    });
    expect(getWorkThread('human')).toMatchObject({ humanOnly: true });
    finalizeArtifact({ threadId: 'human', type: 'post' });

    applyCurationBatch({
      actions: [
        {
          type: 'lineage.attach',
          threadId: 'human',
          sessionId: 'codex:contributor',
          role: 'contributor',
          rationale: 'Late-discovered drafting session',
        },
      ],
    });
    expect(getArtifact('human')).toMatchObject({ humanOnly: false });
  });

  it('rejects artifact creation before the thread is ready', () => {
    consumedThread('t1', [['codex:a', 100]]);
    expect(() => finalizeArtifact({ threadId: 't1', type: 'tweet' })).toThrow(
      'must be ready before creating an artifact',
    );
  });

  it('rejects malformed ready threads during artifact creation', () => {
    upsertSession(session('codex:a', 100));
    applyCurationBatch({
      actions: [
        {
          type: 'thread.create',
          id: 'empty',
          projectProfileId: projectId(),
          provisionalTitle: 'Empty',
        },
      ],
    });
    getDb()
      .prepare(
        "UPDATE work_thread SET status = 'ready', readiness_rationale = 'manual' WHERE id = ?",
      )
      .run('empty');
    expect(() => finalizeArtifact({ threadId: 'empty', type: 'note' })).toThrow(
      'must have a contributor session or humanOnly=true for artifact creation',
    );

    consumedThread('missing-rationale', [['codex:a', 100]]);
    getDb()
      .prepare("UPDATE work_thread SET status = 'ready', readiness_rationale = NULL WHERE id = ?")
      .run('missing-rationale');
    expect(() => finalizeArtifact({ threadId: 'missing-rationale', type: 'note' })).toThrow(
      'no readiness rationale',
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

  it('keeps new sessions in the normal inbox until the curator attaches them', () => {
    upsertSession(session('codex:newer', 200, { createdAt: 200 }));
    applyCurationBatch({
      actions: [
        {
          type: 'thread.create',
          id: 't1',
          projectProfileId: projectId(),
          provisionalTitle: 'Feature',
        },
        { type: 'thread.attach', threadId: 't1', sessionId: 'codex:newer', role: 'contributor' },
        { type: 'session.consume', sessionId: 'codex:newer' },
      ],
    });

    upsertSession(session('codex:older', 100, { createdAt: 100 }));
    expect(listCurationInbox({ limit: 10 }).items).toEqual([
      expect.objectContaining({ kind: 'session', id: 'codex:older' }),
    ]);

    applyCurationBatch({
      actions: [
        {
          type: 'lineage.attach',
          threadId: 't1',
          sessionId: 'codex:older',
          role: 'evidence',
          rationale: 'agent identified related earlier work',
        },
        { type: 'session.consume', sessionId: 'codex:older' },
      ],
    });
    expect(listCurationInbox({ limit: 10 }).items).toEqual([]);
    expect(getWorkThread('t1')?.sessions).toEqual([
      {
        sessionId: 'codex:older',
        role: 'evidence',
        rationale: 'agent identified related earlier work',
      },
      { sessionId: 'codex:newer', role: 'contributor', rationale: null },
    ]);
  });

  it('reopens a ready thread when the curator attaches late lineage', () => {
    consumedThread('t1', [['codex:newer', 200]]);
    upsertSession(session('codex:older', 100, { createdAt: 100 }));
    applyCurationBatch({
      actions: [{ type: 'thread.mark-ready', threadId: 't1', rationale: 'output is clear' }],
    });

    applyCurationBatch({
      actions: [
        {
          type: 'lineage.attach',
          threadId: 't1',
          sessionId: 'codex:older',
          role: 'evidence',
          rationale: 'agent identified related earlier work',
        },
        { type: 'session.consume', sessionId: 'codex:older' },
      ],
    });

    expect(getWorkThread('t1')).toMatchObject({
      lifecycle: 'open',
      readyAt: null,
      readinessRationale: 'Reopened after lineage attachment',
    });
    expect(listArtifactInbox().items).toEqual([]);
  });

  it('appends and retracts lineage after artifact creation without changing the payload', () => {
    consumedThread('t1', [['codex:a', 200]]);
    upsertSession(session('codex:older', 100, { createdAt: 100 }));
    applyCurationBatch({ actions: [{ type: 'thread.finalize', threadId: 't1' }] });
    finalizeArtifact({ threadId: 't1', type: 'feature', payload: { files: ['src/a.ts'] } });

    applyCurationBatch({
      actions: [
        {
          type: 'lineage.attach',
          threadId: 't1',
          sessionId: 'codex:older',
          role: 'evidence',
          rationale: 'late historical evidence',
        },
      ],
    });
    expect(getArtifact('t1')).toMatchObject({
      payload: { files: ['src/a.ts'] },
      sessions: [
        { sessionId: 'codex:older', role: 'evidence' },
        { sessionId: 'codex:a', role: 'contributor' },
      ],
    });

    applyCurationBatch({
      actions: [
        {
          type: 'lineage.retract',
          threadId: 't1',
          sessionId: 'codex:older',
          rationale: 'later review found this unrelated',
        },
      ],
    });
    const artifact = getArtifact('t1');
    expect(artifact).toMatchObject({
      payload: { files: ['src/a.ts'] },
      sessions: [{ sessionId: 'codex:a', role: 'contributor' }],
    });
    expect(artifact?.lineageEvents?.map((event) => event.eventType)).toEqual([
      'attach',
      'attach',
      'retract',
    ]);
  });

  it('creates a successor artifact without mutating its predecessor', () => {
    consumedThread('t1', [['codex:a', 100]]);
    consumedThread('t2', [['codex:b', 200]]);
    for (const id of ['t1', 't2']) {
      applyCurationBatch({ actions: [{ type: 'thread.finalize', threadId: id }] });
    }
    finalizeArtifact({ threadId: 't1', type: 'feature', payload: { files: ['src/v1.ts'] } });
    finalizeArtifact({
      threadId: 't2',
      predecessorArtifactId: 't1',
      type: 'feature',
      payload: { files: ['src/v2.ts'] },
    });

    expect(getArtifact('t1')).toMatchObject({
      payload: { files: ['src/v1.ts'] },
      predecessorArtifactId: null,
    });
    expect(getArtifact('t2')).toMatchObject({
      payload: { files: ['src/v2.ts'] },
      predecessorArtifactId: 't1',
    });
  });
});

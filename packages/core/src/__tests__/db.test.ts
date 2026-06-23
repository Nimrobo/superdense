import { vi, describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

vi.mock('../paths.js', () => ({
  DB_PATH: ':memory:',
  SUPERDENSE_HOME: '/tmp/superdense-test',
  GROUPS_DIR: '/tmp/superdense-test/queries',
  USER_FILTERS_DIR: '/tmp/superdense-test/filters',
  LEGACY_USER_FILTERS_DIR: '/tmp/superdense-test/plugins',
  USER_ENRICHERS_DIR: '/tmp/superdense-test/enrichers',
  ensureSuperdenseDirs: vi.fn(),
}));

import {
  getDb,
  upsertSession,
  getSession,
  listSessions,
  countSessions,
  upsertSessionLink,
  getSessionChildren,
  getSessionParent,
  getSessionSubagentSummary,
  getSessionTree,
  getDirtySessions,
  markIndexed,
  createQuery,
  listQueries,
  getQuery,
  deleteQuery,
  listQueryMatches,
  listQueryMatchDetails,
  countQueryMatches,
  upsertQueryMatch,
  dropQueryMatch,
  markQueryRun,
  isQueryMatch,
  upsertEnrichment,
  getEnrichment,
  listSessionEnrichments,
  replaceSessionFiles,
  replacePlanRefs,
  sessionsByPathRel,
  sessionsByPlanSlug,
  SYSTEM_RUN_ID,
  createQueryRun,
  finishQueryRun,
  clearQueryRun,
  pruneQueryRuns,
  listQueryRunsForSavedQuery,
  listStandaloneRuns,
  getQueryRun,
  withDbRetry,
  _migrateForTests,
  _repairForTests,
} from '../db.js';
import {
  applyProjectProfilePatch,
  getProjectContext,
  getProjectPathResolution,
  getProjectProfileResolution,
  listProjectProfiles,
  setProjectAttention,
} from '../projects/index.js';
import type { Session, Query } from '../types.js';
import type { QueryFilter } from '../query/types.js';

const BASE: Session = {
  id: 'sess-1',
  agent: 'claude-code',
  sessionId: 'abc123',
  logPath: '/tmp/logs/abc123.jsonl',
  pwd: '/home/user/project',
  projectKey: '/home/user/project',
};

const FILTERS: QueryFilter = { filter: { name: 'session', params: { agent: 'claude-code' } } };

const BASE_QUERY: Omit<Query, 'memberCount' | 'lastRunAt'> = {
  id: 'q1',
  name: 'Test Query',
  filters: FILTERS,
  enrichers: [],
  createdAt: 1000,
};

function clearDb() {
  const db = getDb();
  db.exec(
    "DELETE FROM query_matches; DELETE FROM session_enrich; DELETE FROM work_thread_lineage_event; DELETE FROM work_thread_session; DELETE FROM work_thread; DELETE FROM pending_session_marker; DELETE FROM session_links; DELETE FROM sessions; DELETE FROM project_profile; DELETE FROM queries; DELETE FROM query_run WHERE id != 'system';",
  );
}

function makeRunFor(savedQueryId: string): string {
  const id = createQueryRun({
    savedQueryId,
    dsl: { filters: { and: [] }, enrichers: [] },
    startedAt: Date.now(),
  });
  // Reads scope to the latest *finished* run, so tests must close the run out.
  finishQueryRun(id, { finishedAt: Date.now(), matchedCount: 0 });
  return id;
}

describe('sessions', () => {
  beforeEach(clearDb);

  it('upserts and retrieves a session', () => {
    upsertSession(BASE);
    const got = getSession('sess-1');
    expect(got).not.toBeNull();
    expect(got!.id).toBe('sess-1');
    expect(got!.agent).toBe('claude-code');
    expect(got!.pwd).toBe('/home/user/project');
    expect(got!.projectKey).toBe('/home/user/project');
  });

  it('updates existing session on conflict', () => {
    upsertSession(BASE);
    upsertSession({
      ...BASE,
      pwd: '/Users/x/conductor/workspaces/superdense/provo-v1/packages/core',
    });
    expect(getSession('sess-1')!.pwd).toBe(
      '/Users/x/conductor/workspaces/superdense/provo-v1/packages/core',
    );
    expect(getSession('sess-1')!.projectKey).toBe('/Users/x/conductor/workspaces/superdense');
  });

  it('backfills projectKey when migrating a v1 database', () => {
    const db = new Database(':memory:');
    try {
      db.exec(`
        CREATE TABLE sessions (
          id              TEXT PRIMARY KEY,
          agent           TEXT NOT NULL,
          session_id      TEXT NOT NULL,
          log_path        TEXT NOT NULL,
          pwd             TEXT NOT NULL,
          first_prompt    TEXT,
          summary         TEXT,
          message_count   INTEGER,
          git_branch      TEXT,
          created_at      INTEGER,
          modified_at     INTEGER,
          is_sidechain    INTEGER DEFAULT 0,
          file_mtime      INTEGER,
          last_indexed_at INTEGER
        );
        PRAGMA user_version = 1;
      `);
      db.prepare(
        `
        INSERT INTO sessions (
          id, agent, session_id, log_path, pwd, first_prompt, summary,
          message_count, git_branch, created_at, modified_at, is_sidechain,
          file_mtime, last_indexed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      ).run(
        'old',
        'claude-code',
        'abc',
        '/tmp/abc.jsonl',
        '/Users/x/conductor/workspaces/superdense/provo-v1/packages/core',
        null,
        null,
        null,
        null,
        null,
        null,
        0,
        null,
        null,
      );

      _migrateForTests(db);

      expect(db.pragma('user_version', { simple: true })).toBe(13);
      expect(db.prepare('SELECT project_key FROM sessions WHERE id = ?').get('old')).toEqual({
        project_key: '/Users/x/conductor/workspaces/superdense',
      });
    } finally {
      db.close();
    }
  });

  it('V3 migration: drops legacy query_enrich and rewrites query_matches to new schema', () => {
    const db = new Database(':memory:');
    try {
      db.exec(`
        CREATE TABLE sessions (
          id              TEXT PRIMARY KEY,
          agent           TEXT NOT NULL,
          session_id      TEXT NOT NULL,
          log_path        TEXT NOT NULL,
          pwd             TEXT NOT NULL,
          project_key     TEXT NOT NULL DEFAULT '',
          first_prompt    TEXT,
          summary         TEXT,
          message_count   INTEGER,
          git_branch      TEXT,
          created_at      INTEGER,
          modified_at     INTEGER,
          is_sidechain    INTEGER DEFAULT 0,
          file_mtime      INTEGER,
          last_indexed_at INTEGER
        );
        CREATE TABLE queries (
          id          TEXT PRIMARY KEY,
          name        TEXT NOT NULL,
          predicate   TEXT NOT NULL,
          created_at  INTEGER,
          last_run_at INTEGER
        );
        CREATE TABLE query_matches (
          query_id   TEXT NOT NULL REFERENCES queries(id) ON DELETE CASCADE,
          session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
          added_at   INTEGER,
          evidence   TEXT,
          PRIMARY KEY (query_id, session_id)
        );
        CREATE TABLE query_enrich (
          session_id  TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
          name        TEXT NOT NULL,
          version     INTEGER NOT NULL,
          value       TEXT NOT NULL,
          computed_at INTEGER NOT NULL,
          PRIMARY KEY (session_id, name)
        );
        PRAGMA user_version = 2;
      `);
      db.prepare(
        'INSERT INTO sessions (id, agent, session_id, log_path, pwd) VALUES (?, ?, ?, ?, ?)',
      ).run('s1', 'codex', 'abc', '/tmp/abc.jsonl', '/proj');
      db.prepare(
        'INSERT INTO queries (id, name, predicate, created_at, last_run_at) VALUES (?, ?, ?, ?, ?)',
      ).run('q1', 'Q1', JSON.stringify({ filters: { and: [] } }), 1000, 5000);
      db.prepare(
        'INSERT INTO query_matches (query_id, session_id, added_at, evidence) VALUES (?, ?, ?, ?)',
      ).run('q1', 's1', 100, 'hit');
      db.prepare(
        'INSERT INTO query_enrich (session_id, name, version, value, computed_at) VALUES (?, ?, ?, ?, ?)',
      ).run('s1', 'tool_counts', 1, JSON.stringify({ Bash: 3 }), 1000);

      _migrateForTests(db);

      expect(db.pragma('user_version', { simple: true })).toBe(13);

      const tables = (
        db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{
          name: string;
        }>
      ).map((r) => r.name);
      expect(tables).toContain('session_enrich');
      expect(tables).toContain('query_run');
      expect(tables).not.toContain('query_enrich');

      // System run exists and saved query definition is preserved.
      expect(db.prepare('SELECT id FROM query_run WHERE id = ?').get('system')).toEqual({
        id: 'system',
      });
      expect(db.prepare('SELECT id FROM queries WHERE id = ?').get('q1')).toEqual({ id: 'q1' });

      // Legacy match memberships and enrichments are dropped — they regenerate on next run/index.
      const matchCols = db.prepare('PRAGMA table_info(query_matches)').all() as Array<{
        name: string;
      }>;
      expect(matchCols.map((c) => c.name)).toContain('query_run_id');
      expect(matchCols.map((c) => c.name)).not.toContain('query_id');
      expect(db.prepare('SELECT COUNT(*) AS c FROM query_matches').get()).toEqual({ c: 0 });
      expect(db.prepare('SELECT COUNT(*) AS c FROM session_enrich').get()).toEqual({ c: 0 });
    } finally {
      db.close();
    }
  });

  it('V4 migration: adds sub-agent columns and session_links table', () => {
    const db = new Database(':memory:');
    try {
      db.exec(`
        CREATE TABLE sessions (
          id              TEXT PRIMARY KEY,
          agent           TEXT NOT NULL,
          session_id      TEXT NOT NULL,
          log_path        TEXT NOT NULL,
          pwd             TEXT NOT NULL,
          project_key     TEXT NOT NULL DEFAULT '',
          first_prompt    TEXT,
          summary         TEXT,
          message_count   INTEGER,
          git_branch      TEXT,
          created_at      INTEGER,
          modified_at     INTEGER,
          is_sidechain    INTEGER DEFAULT 0,
          file_mtime      INTEGER,
          last_indexed_at INTEGER
        );
        CREATE TABLE queries (
          id          TEXT PRIMARY KEY,
          name        TEXT NOT NULL,
          predicate   TEXT NOT NULL,
          created_at  INTEGER,
          last_run_at INTEGER
        );
        CREATE TABLE query_run (
          id              TEXT PRIMARY KEY,
          saved_query_id  TEXT REFERENCES queries(id) ON DELETE SET NULL,
          dsl             TEXT NOT NULL,
          started_at      INTEGER NOT NULL,
          finished_at     INTEGER,
          matched_count   INTEGER
        );
        CREATE TABLE query_matches (
          query_run_id TEXT NOT NULL,
          session_id   TEXT NOT NULL,
          added_at     INTEGER,
          evidence     TEXT,
          PRIMARY KEY (query_run_id, session_id)
        );
        CREATE TABLE session_enrich (
          session_id   TEXT NOT NULL,
          query_run_id TEXT NOT NULL,
          name         TEXT NOT NULL,
          version      INTEGER NOT NULL,
          value        TEXT NOT NULL,
          computed_at  INTEGER NOT NULL,
          PRIMARY KEY (session_id, query_run_id, name)
        );
        PRAGMA user_version = 3;
      `);
      db.prepare(
        'INSERT INTO sessions (id, agent, session_id, log_path, pwd, project_key) VALUES (?, ?, ?, ?, ?, ?)',
      ).run('root', 'codex', 'root', '/tmp/root.jsonl', '/proj', '/proj');

      _migrateForTests(db);

      expect(db.pragma('user_version', { simple: true })).toBe(13);
      const sessionCols = (
        db.prepare('PRAGMA table_info(sessions)').all() as Array<{
          name: string;
        }>
      ).map((c) => c.name);
      expect(sessionCols).toContain('is_subagent');
      expect(sessionCols).toContain('parent_session_id');
      expect(
        db.prepare('SELECT is_subagent, parent_session_id FROM sessions WHERE id = ?').get('root'),
      ).toEqual({
        is_subagent: 0,
        parent_session_id: null,
      });
      expect(
        db
          .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='session_links'")
          .get(),
      ).toEqual({ name: 'session_links' });
    } finally {
      db.close();
    }
  });

  it('V5 migration: creates Layer 1 and project profile tables with inverse indexes', () => {
    const db = new Database(':memory:');
    try {
      db.exec(`
        CREATE TABLE sessions (id TEXT PRIMARY KEY, agent TEXT NOT NULL, session_id TEXT NOT NULL,
          log_path TEXT NOT NULL, pwd TEXT NOT NULL, project_key TEXT NOT NULL DEFAULT '',
          first_prompt TEXT, summary TEXT, message_count INTEGER, git_branch TEXT,
          created_at INTEGER, modified_at INTEGER, is_sidechain INTEGER DEFAULT 0,
          is_subagent INTEGER NOT NULL DEFAULT 0, parent_session_id TEXT,
          file_mtime INTEGER, last_indexed_at INTEGER);
        CREATE TABLE queries (id TEXT PRIMARY KEY, name TEXT NOT NULL, predicate TEXT NOT NULL,
          created_at INTEGER, last_run_at INTEGER);
        CREATE TABLE query_run (id TEXT PRIMARY KEY, saved_query_id TEXT, dsl TEXT NOT NULL,
          started_at INTEGER NOT NULL, finished_at INTEGER, matched_count INTEGER);
        CREATE TABLE query_matches (query_run_id TEXT NOT NULL, session_id TEXT NOT NULL,
          added_at INTEGER, evidence TEXT, PRIMARY KEY (query_run_id, session_id));
        CREATE TABLE session_enrich (session_id TEXT NOT NULL, query_run_id TEXT NOT NULL,
          name TEXT NOT NULL, version INTEGER NOT NULL, value TEXT NOT NULL,
          computed_at INTEGER NOT NULL, PRIMARY KEY (session_id, query_run_id, name));
        PRAGMA user_version = 4;
      `);

      _migrateForTests(db);

      expect(db.pragma('user_version', { simple: true })).toBe(13);
      const tables = (
        db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{
          name: string;
        }>
      ).map((t) => t.name);
      expect(tables).toContain('session_file');
      expect(tables).toContain('plan_refs');
      expect(tables).toContain('project_profile');

      const indexes = (
        db.prepare("SELECT name FROM sqlite_master WHERE type='index'").all() as Array<{
          name: string;
        }>
      ).map((i) => i.name);
      expect(indexes).toContain('idx_session_file_path');
      expect(indexes).toContain('idx_plan_refs_slug');
    } finally {
      db.close();
    }
  });

  it('explicit repair adds project profiles to an already-versioned pre-release database', () => {
    const db = new Database(':memory:');
    try {
      db.exec(`
        CREATE TABLE sessions (id TEXT PRIMARY KEY, agent TEXT NOT NULL, session_id TEXT NOT NULL,
          log_path TEXT NOT NULL, pwd TEXT NOT NULL, project_key TEXT NOT NULL DEFAULT '',
          first_prompt TEXT, summary TEXT, message_count INTEGER, git_branch TEXT,
          created_at INTEGER, modified_at INTEGER, is_sidechain INTEGER DEFAULT 0,
          is_subagent INTEGER NOT NULL DEFAULT 0, parent_session_id TEXT,
          file_mtime INTEGER, last_indexed_at INTEGER);
        CREATE TABLE queries (id TEXT PRIMARY KEY, name TEXT NOT NULL, predicate TEXT NOT NULL,
          created_at INTEGER, last_run_at INTEGER);
        CREATE TABLE query_run (id TEXT PRIMARY KEY, saved_query_id TEXT, dsl TEXT NOT NULL,
          started_at INTEGER NOT NULL, finished_at INTEGER, matched_count INTEGER);
        CREATE TABLE query_matches (query_run_id TEXT NOT NULL, session_id TEXT NOT NULL,
          added_at INTEGER, evidence TEXT, PRIMARY KEY (query_run_id, session_id));
        CREATE TABLE session_enrich (session_id TEXT NOT NULL, query_run_id TEXT NOT NULL,
          name TEXT NOT NULL, version INTEGER NOT NULL, value TEXT NOT NULL,
          computed_at INTEGER NOT NULL, PRIMARY KEY (session_id, query_run_id, name));
        CREATE TABLE session_file (session_id TEXT NOT NULL, path_rel TEXT NOT NULL,
          path_abs TEXT NOT NULL, role TEXT NOT NULL, writes INTEGER NOT NULL DEFAULT 0,
          reads INTEGER NOT NULL DEFAULT 0, ops TEXT, first_ts INTEGER, last_ts INTEGER,
          PRIMARY KEY (session_id, path_rel));
        CREATE TABLE plan_refs (session_id TEXT NOT NULL, plan_slug TEXT NOT NULL,
          kind TEXT NOT NULL, PRIMARY KEY (session_id, plan_slug, kind));
        INSERT INTO sessions (id, agent, session_id, log_path, pwd, project_key, modified_at)
          VALUES ('s1', 'codex', 'native', '/tmp/s1', '/repo', '/repo', 2000);
        PRAGMA user_version = 5;
      `);

      _repairForTests(db);

      expect(db.pragma('user_version', { simple: true })).toBe(13);
      expect(
        db.prepare('SELECT project_key, status, last_seen_at FROM project_profile').all(),
      ).toEqual([{ project_key: '/repo', status: 'unprofiled', last_seen_at: 2000 }]);
      expect(
        db
          .prepare(
            "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('pending_session_marker', 'work_thread', 'work_thread_session') ORDER BY name",
          )
          .all(),
      ).toEqual([
        { name: 'pending_session_marker' },
        { name: 'work_thread' },
        { name: 'work_thread_session' },
      ]);
      expect(db.prepare('SELECT curation_status, curated_revision FROM sessions').get()).toEqual({
        curation_status: 'pending',
        curated_revision: '[null,2000,null]',
      });
    } finally {
      db.close();
    }
  });

  it('project profiles: session indexing registers blanks and safe patches preserve omitted fields', () => {
    clearDb();
    upsertSession({ ...BASE, modifiedAt: 1000 });
    const blank = listProjectProfiles()[0]!;
    expect(blank).toMatchObject({
      projectKey: '/home/user/project',
      status: 'unprofiled',
      lastSeenAt: 1000,
    });

    const profiled = applyProjectProfilePatch(blank.id, {
      name: 'Project',
      description: 'A software project',
      roots: ['/home/user/project'],
      artifactShapes: [{ type: 'feature', detector: { kind: 'branch' } }],
      evidenceSummary: ['Branches and source files indicate software work'],
      notes: 'Keep this note',
      needsHumanAttention: false,
      attentionReasons: [],
    });
    expect(profiled).toMatchObject({
      status: 'profiled',
      name: 'Project',
      notes: 'Keep this note',
    });

    const revised = applyProjectProfilePatch(blank.id, { description: 'Updated description' });
    expect(revised).toMatchObject({
      name: 'Project',
      description: 'Updated description',
      notes: 'Keep this note',
      artifactShapes: [{ type: 'feature', detector: { kind: 'branch' } }],
    });
  });

  it('project profiles: validation rejects malformed detector configs and unexplained attention', () => {
    clearDb();
    upsertSession(BASE);
    const id = listProjectProfiles()[0]!.id;
    expect(() =>
      applyProjectProfilePatch(id, {
        artifactShapes: [{ type: 'feature', detector: { kind: 'branch', include: ['src'] } }],
      }),
    ).toThrow('artifactShapes[0].detector does not accept extra fields');
    expect(() =>
      applyProjectProfilePatch(id, { needsHumanAttention: true, attentionReasons: [] }),
    ).toThrow('attentionReasons must not be empty');
  });

  it('project profiles: canonical coverage hides aliases and covered ids resolve to the canonical profile', () => {
    clearDb();
    upsertSession({ ...BASE, id: 'main', pwd: '/repo/main' });
    upsertSession({ ...BASE, id: 'nested', pwd: '/repo/main/packages/cli' });
    const profiles = listProjectProfiles();
    const canonical = profiles.find((profile) => profile.projectKey === '/repo/main')!;
    const alias = profiles.find((profile) => profile.projectKey === '/repo/main/packages/cli')!;

    applyProjectProfilePatch(canonical.id, {
      roots: ['/repo/main'],
      artifactShapes: [],
      evidenceSummary: ['One repository with a nested package'],
      coveredProjectIds: [alias.id],
    });

    expect(listProjectProfiles()).toHaveLength(1);
    expect(getProjectProfileResolution(alias.id)).toMatchObject({
      redirectedFrom: alias.id,
      project: { id: canonical.id, coveredProjects: [{ id: alias.id }] },
    });
    expect(() =>
      applyProjectProfilePatch(canonical.id, { coveredProjectIds: [canonical.id] }),
    ).toThrow('a project cannot cover itself');
  });

  it('project profiles: resolves canonical project ids from filesystem paths', () => {
    clearDb();
    upsertSession({ ...BASE, id: 'main', pwd: '/repo/main' });
    upsertSession({ ...BASE, id: 'nested', pwd: '/repo/main/packages/cli' });
    upsertSession({
      ...BASE,
      id: 'conductor',
      pwd: '/Users/x/conductor/workspaces/superdense/provo-v1/packages/core',
    });
    const profiles = listProjectProfiles();
    const canonical = profiles.find((profile) => profile.projectKey === '/repo/main')!;
    const alias = profiles.find((profile) => profile.projectKey === '/repo/main/packages/cli')!;
    const conductor = profiles.find(
      (profile) => profile.projectKey === '/Users/x/conductor/workspaces/superdense',
    )!;

    applyProjectProfilePatch(canonical.id, {
      roots: ['/repo/main'],
      artifactShapes: [],
      evidenceSummary: ['One repository with a nested package'],
      coveredProjectIds: [alias.id],
    });

    expect(getProjectPathResolution('/repo/main')?.project.id).toBe(canonical.id);
    expect(getProjectPathResolution('/repo/main/src/index.ts')?.project.id).toBe(canonical.id);
    expect(getProjectPathResolution('/repo/main/packages/cli/src/index.ts')).toMatchObject({
      redirectedFrom: alias.id,
      project: { id: canonical.id },
    });
    expect(
      getProjectPathResolution('/Users/x/conductor/workspaces/superdense/provo-v1/packages/web')
        ?.project.id,
    ).toBe(conductor.id);
    expect(getProjectPathResolution('/missing/project')).toBeNull();
  });

  it('project profiles: canonical coverage rolls up alias history and later observations', () => {
    clearDb();
    upsertSession({ ...BASE, id: 'main', pwd: '/repo/main', modifiedAt: 2000 });
    upsertSession({ ...BASE, id: 'nested', pwd: '/repo/main/packages/cli', modifiedAt: 1000 });
    const profiles = listProjectProfiles();
    const canonical = profiles.find((profile) => profile.projectKey === '/repo/main')!;
    const alias = profiles.find((profile) => profile.projectKey === '/repo/main/packages/cli')!;

    applyProjectProfilePatch(canonical.id, {
      coveredProjectIds: [alias.id],
    });
    expect(getProjectProfileResolution(canonical.id)?.project).toMatchObject({
      firstSeenAt: 1000,
      lastSeenAt: 2000,
    });

    upsertSession({ ...BASE, id: 'nested-new', pwd: '/repo/main/packages/cli', modifiedAt: 3000 });
    expect(listProjectProfiles()).toEqual([
      expect.objectContaining({
        id: canonical.id,
        firstSeenAt: 1000,
        lastSeenAt: 3000,
      }),
    ]);
  });

  it('project profiles: attention is advisory and can be resolved', () => {
    clearDb();
    upsertSession(BASE);
    const id = listProjectProfiles()[0]!.id;
    applyProjectProfilePatch(id, { artifactShapes: [], evidenceSummary: [] });
    expect(setProjectAttention(id, { needed: true, reasons: ['Review roots'] })).toMatchObject({
      needsHumanAttention: true,
      attentionReasons: ['Review roots'],
    });
    expect(listProjectProfiles({ needsAction: true })).toHaveLength(1);
    expect(setProjectAttention(id, { needed: false })).toMatchObject({
      needsHumanAttention: false,
      attentionReasons: [],
    });
  });

  it('project profiles: context reports indexed paths and bounded evidence for the profiling skill', () => {
    clearDb();
    upsertSession({ ...BASE, modifiedAt: 3000 });
    upsertEnrichment(BASE.id, SYSTEM_RUN_ID, 'first_intent', 1, { v: 1, intent: 'Build it' }, 1);
    upsertEnrichment(BASE.id, SYSTEM_RUN_ID, 'tool_counts', 1, { Bash: 2 }, 1);
    upsertEnrichment(BASE.id, SYSTEM_RUN_ID, 'bash_cli_counts', 1, { git: 3 }, 1);
    const queryRunId = createQueryRun({
      savedQueryId: null,
      dsl: { filters: { and: [] }, enrichers: [] },
      startedAt: 2,
    });
    upsertEnrichment(
      BASE.id,
      queryRunId,
      'first_intent',
      1,
      { v: 1, intent: 'Ignore query copy' },
      2,
    );
    upsertEnrichment(BASE.id, queryRunId, 'tool_counts', 1, { Bash: 20 }, 2);
    upsertEnrichment(BASE.id, queryRunId, 'bash_cli_counts', 1, { git: 30 }, 2);
    replaceSessionFiles(BASE.id, [
      {
        pathRel: 'src/index.ts',
        pathAbs: '/home/user/project/src/index.ts',
        role: 'deliverable',
        writes: 2,
        reads: 0,
        ops: { Edit: 2 },
        firstTs: 1,
        lastTs: 2,
      },
    ]);
    const context = getProjectContext(listProjectProfiles()[0]!.id);
    expect(context).toMatchObject({
      observed: {
        projectKeys: ['/home/user/project'],
        paths: [{ pwd: '/home/user/project', sessions: 1, lastSeenAt: 3000 }],
        sessionCount: 1,
        firstIntents: ['Build it'],
        touchedFiles: [{ path: 'src/index.ts', sessions: 1, writes: 2 }],
        tools: [{ name: 'Bash', count: 2 }],
        clis: [{ name: 'git', count: 3 }],
      },
    });
  });

  it('session_file / plan_refs: replace is idempotent and inverse lookups work', () => {
    clearDb();
    upsertSession(BASE);
    const files = [
      {
        pathRel: 'src/db.ts',
        pathAbs: '/home/user/project/src/db.ts',
        role: 'deliverable',
        writes: 2,
        reads: 1,
        ops: { Edit: 2, Read: 1 },
        firstTs: 10,
        lastTs: 20,
      },
    ];
    replaceSessionFiles(BASE.id, files);
    replaceSessionFiles(BASE.id, files); // second call must not duplicate
    expect(sessionsByPathRel('src/db.ts')).toEqual([BASE.id]);

    replacePlanRefs(BASE.id, [
      { slug: 'swirling-bengio', kind: 'wrote' },
      { slug: 'swirling-bengio', kind: 'referenced' },
    ]);
    replacePlanRefs(BASE.id, [{ slug: 'swirling-bengio', kind: 'wrote' }]);
    expect(sessionsByPlanSlug('swirling-bengio')).toEqual([BASE.id]);

    const db = getDb();
    expect((db.prepare('SELECT COUNT(*) AS c FROM session_file').get() as { c: number }).c).toBe(1);
    expect((db.prepare('SELECT COUNT(*) AS c FROM plan_refs').get() as { c: number }).c).toBe(1);
  });

  it('V1 migration: preserves saved query definitions and drops legacy match/enrich tables', () => {
    const db = new Database(':memory:');
    try {
      db.exec(`
        CREATE TABLE sessions (
          id              TEXT PRIMARY KEY,
          agent           TEXT NOT NULL,
          session_id      TEXT NOT NULL,
          log_path        TEXT NOT NULL,
          pwd             TEXT NOT NULL,
          first_prompt    TEXT,
          summary         TEXT,
          message_count   INTEGER,
          git_branch      TEXT,
          created_at      INTEGER,
          modified_at     INTEGER,
          is_sidechain    INTEGER DEFAULT 0,
          file_mtime      INTEGER,
          last_indexed_at INTEGER
        );
        CREATE TABLE groups (
          id            TEXT PRIMARY KEY,
          name          TEXT NOT NULL,
          plugin_name   TEXT NOT NULL,
          plugin_config TEXT,
          created_at    INTEGER,
          last_run_at   INTEGER
        );
        CREATE TABLE group_items (
          group_id   TEXT NOT NULL,
          session_id TEXT NOT NULL,
          added_at   INTEGER,
          evidence   TEXT,
          PRIMARY KEY (group_id, session_id)
        );
        CREATE TABLE session_enrichments (
          session_id  TEXT NOT NULL,
          name        TEXT NOT NULL,
          version     INTEGER NOT NULL,
          value       TEXT NOT NULL,
          computed_at INTEGER NOT NULL,
          PRIMARY KEY (session_id, name)
        );
        PRAGMA user_version = 0;
      `);
      db.prepare(
        'INSERT INTO sessions (id, agent, session_id, log_path, pwd) VALUES (?, ?, ?, ?, ?)',
      ).run('s1', 'codex', 'abc', '/tmp/abc.jsonl', '/proj');
      db.prepare(
        'INSERT INTO groups (id, name, plugin_name, plugin_config, created_at) VALUES (?, ?, ?, ?, ?)',
      ).run('g1', 'My Group', 'by-user-prompt-keyword', JSON.stringify({ keyword: 'bug' }), 1000);
      db.prepare(
        'INSERT INTO group_items (group_id, session_id, added_at, evidence) VALUES (?, ?, ?, ?)',
      ).run('g1', 's1', 100, 'hit');
      db.prepare(
        'INSERT INTO session_enrichments (session_id, name, version, value, computed_at) VALUES (?, ?, ?, ?, ?)',
      ).run('s1', 'tool_counts', 1, JSON.stringify({ Bash: 3 }), 1000);

      _migrateForTests(db);

      expect(db.pragma('user_version', { simple: true })).toBe(13);

      const tables = (
        db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{
          name: string;
        }>
      ).map((r) => r.name);
      expect(tables).not.toContain('groups');
      expect(tables).not.toContain('group_items');
      expect(tables).not.toContain('session_enrichments');
      expect(tables).toContain('queries');
      expect(tables).toContain('query_matches');
      expect(tables).toContain('session_enrich');

      // The user's saved-query definition is the only legacy data preserved.
      const q = db.prepare('SELECT id, name, predicate FROM queries WHERE id = ?').get('g1') as
        | { id: string; name: string; predicate: string }
        | undefined;
      expect(q?.name).toBe('My Group');
      expect(JSON.parse(q!.predicate)).toEqual({
        filters: { filter: { name: 'user_prompt_contains', params: { keyword: 'bug' } } },
        enrichers: [],
      });

      expect(db.prepare('SELECT COUNT(*) AS c FROM query_matches').get()).toEqual({ c: 0 });
      expect(db.prepare('SELECT COUNT(*) AS c FROM session_enrich').get()).toEqual({ c: 0 });
    } finally {
      db.close();
    }
  });

  it('V12 migration: adds hypothesis and experiment tables to a V11 database', () => {
    const db = new Database(':memory:');
    try {
      db.exec(`
        CREATE TABLE sessions (
          id              TEXT PRIMARY KEY,
          agent           TEXT NOT NULL,
          session_id      TEXT NOT NULL,
          log_path        TEXT NOT NULL,
          pwd             TEXT NOT NULL,
          project_key     TEXT NOT NULL DEFAULT '',
          first_prompt    TEXT,
          summary         TEXT,
          message_count   INTEGER,
          git_branch      TEXT,
          created_at      INTEGER,
          modified_at     INTEGER,
          is_sidechain    INTEGER DEFAULT 0,
          file_mtime      INTEGER,
          last_indexed_at INTEGER
        );
        CREATE TABLE queries (
          id          TEXT PRIMARY KEY,
          name        TEXT NOT NULL,
          predicate   TEXT NOT NULL,
          created_at  INTEGER,
          last_run_at INTEGER
        );
        CREATE TABLE query_run (
          id              TEXT PRIMARY KEY,
          saved_query_id  TEXT REFERENCES queries(id) ON DELETE SET NULL,
          dsl             TEXT NOT NULL,
          started_at      INTEGER NOT NULL,
          finished_at     INTEGER,
          matched_count   INTEGER
        );
        CREATE TABLE project_profile (
          id                    TEXT PRIMARY KEY,
          project_key           TEXT UNIQUE NOT NULL,
          status                TEXT NOT NULL,
          covered_by            TEXT,
          name                  TEXT,
          description           TEXT,
          roots                 TEXT NOT NULL DEFAULT '[]',
          artifact_shapes       TEXT NOT NULL DEFAULT '[]',
          evidence_summary      TEXT NOT NULL DEFAULT '[]',
          notes                 TEXT,
          needs_human_attention INTEGER NOT NULL DEFAULT 0,
          attention_reasons     TEXT NOT NULL DEFAULT '[]',
          first_seen_at         INTEGER NOT NULL,
          last_seen_at          INTEGER NOT NULL,
          profiled_at           INTEGER,
          updated_at            INTEGER NOT NULL
        );
        CREATE TABLE work_thread (
          id                    TEXT PRIMARY KEY,
          project_profile_id    TEXT NOT NULL REFERENCES project_profile(id),
          provisional_title     TEXT NOT NULL,
          summary               TEXT,
          status                TEXT NOT NULL DEFAULT 'open',
          created_at            INTEGER NOT NULL,
          updated_at            INTEGER NOT NULL,
          artifact_type         TEXT,
          payload               TEXT,
          artifact_finalized_at INTEGER,
          ready_at              INTEGER,
          readiness_rationale   TEXT,
          predecessor_artifact_id TEXT,
          externalization_status TEXT,
          externalization_evidence TEXT,
          externalization_updated_at INTEGER,
          human_only            INTEGER NOT NULL DEFAULT 0
        );
        PRAGMA user_version = 11;
      `);

      _migrateForTests(db);

      expect(db.pragma('user_version', { simple: true })).toBe(13);
      for (const table of ['hypothesis', 'experiment', 'experiment_member']) {
        expect(
          db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?").get(table),
        ).toEqual({ name: table });
      }
      const hypothesisColumns = (
        db.prepare('PRAGMA table_info(hypothesis)').all() as Array<{ name: string }>
      ).map((row) => row.name);
      expect(hypothesisColumns).toEqual(
        expect.arrayContaining([
          'id',
          'project_id',
          'lever_key',
          'statement',
          'status',
          'created_at',
          'resolved_at',
          'verdict_evidence',
        ]),
      );
    } finally {
      db.close();
    }
  });

  it('returns null for unknown id', () => {
    expect(getSession('nonexistent')).toBeNull();
  });

  it('preserves isSidechain flag', () => {
    upsertSession({ ...BASE, isSidechain: true });
    expect(getSession('sess-1')!.isSidechain).toBe(true);
  });

  it('upserts and retrieves sub-agent metadata', () => {
    upsertSession({ ...BASE, id: 'root' });
    upsertSession({ ...BASE, id: 'child', isSubagent: true, parentSessionId: 'root' });

    expect(getSession('child')).toMatchObject({
      id: 'child',
      isSubagent: true,
      parentSessionId: 'root',
    });
  });

  it('listSessions orders by modifiedAt desc', () => {
    upsertSession({ ...BASE, id: 's1', modifiedAt: 1000 });
    upsertSession({ ...BASE, id: 's2', modifiedAt: 2000 });
    const list = listSessions();
    expect(list[0].id).toBe('s2');
    expect(list[1].id).toBe('s1');
  });

  it('listSessions filters by agent', () => {
    upsertSession({ ...BASE, id: 's1', agent: 'agent-a' });
    upsertSession({ ...BASE, id: 's2', agent: 'agent-b' });
    const results = listSessions({ agent: 'agent-a' });
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('s1');
  });

  it('listSessions filters by pwd', () => {
    upsertSession({ ...BASE, id: 's1', pwd: '/proj/a' });
    upsertSession({ ...BASE, id: 's2', pwd: '/proj/b' });
    const results = listSessions({ pwd: '/proj/a' });
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('s1');
  });

  it('listSessions filters by query text in firstPrompt', () => {
    upsertSession({ ...BASE, id: 's1', firstPrompt: 'fix the bug' });
    upsertSession({ ...BASE, id: 's2', firstPrompt: 'add feature' });
    expect(listSessions({ q: 'bug' })).toHaveLength(1);
    expect(listSessions({ q: 'feature' })[0].id).toBe('s2');
  });

  it('listSessions q is multi-keyword AND, order-independent across fields', () => {
    upsertSession({ ...BASE, id: 's1', firstPrompt: 'bug in the deploy script' });
    upsertSession({ ...BASE, id: 's2', firstPrompt: 'unrelated work', summary: 'deploy notes' });
    upsertSession({ ...BASE, id: 's3', firstPrompt: 'just a bug' });

    // Tokens can match across different fields (firstPrompt + summary on s2).
    const ids = listSessions({ q: 'deploy bug' })
      .map((s) => s.id)
      .sort();
    expect(ids).toEqual(['s1']);
    // Reversed order produces the same result.
    expect(
      listSessions({ q: 'bug deploy' })
        .map((s) => s.id)
        .sort(),
    ).toEqual(['s1']);
  });

  it('listSessions q is case-insensitive', () => {
    upsertSession({ ...BASE, id: 's1', firstPrompt: 'Deploy the thing' });
    expect(listSessions({ q: 'DEPLOY' })).toHaveLength(1);
    expect(listSessions({ q: 'deploy' })).toHaveLength(1);
  });

  it('listSessions q supports quoted phrases', () => {
    upsertSession({ ...BASE, id: 's1', firstPrompt: 'bar baz happens here' });
    upsertSession({ ...BASE, id: 's2', firstPrompt: 'bar and then baz separately' });
    const ids = listSessions({ q: '"bar baz"' }).map((s) => s.id);
    expect(ids).toEqual(['s1']);
  });

  it('listSessions q escapes SQL LIKE wildcards', () => {
    upsertSession({ ...BASE, id: 's1', firstPrompt: 'discount is 50% off' });
    upsertSession({ ...BASE, id: 's2', firstPrompt: 'fifty something off' });
    // '%' must be treated literally, not as a wildcard that would match s2.
    const ids = listSessions({ q: '50%' }).map((s) => s.id);
    expect(ids).toEqual(['s1']);
  });

  it('listSessions empty or whitespace-only q matches everything', () => {
    upsertSession({ ...BASE, id: 's1' });
    upsertSession({ ...BASE, id: 's2' });
    expect(listSessions({ q: '' })).toHaveLength(2);
    expect(listSessions({ q: '   ' })).toHaveLength(2);
  });

  it('listSessions respects limit', () => {
    for (let i = 0; i < 5; i++) upsertSession({ ...BASE, id: `s${i}` });
    expect(listSessions({ limit: 3 })).toHaveLength(3);
  });

  it('listSessions respects offset', () => {
    for (let i = 0; i < 5; i++) upsertSession({ ...BASE, id: `s${i}`, modifiedAt: i });
    const p1 = listSessions({ limit: 2, offset: 0 });
    const p2 = listSessions({ limit: 2, offset: 2 });
    expect(p1[0].id).not.toBe(p2[0].id);
  });

  it('countSessions returns total', () => {
    upsertSession({ ...BASE, id: 's1' });
    upsertSession({ ...BASE, id: 's2' });
    expect(countSessions()).toBe(2);
  });

  it('hides sub-agent sessions by default and includes them on request', () => {
    upsertSession({ ...BASE, id: 'root', modifiedAt: 2000 });
    upsertSession({
      ...BASE,
      id: 'child',
      modifiedAt: 3000,
      isSubagent: true,
      parentSessionId: 'root',
      firstPrompt: 'sub-agent prompt',
    });

    expect(listSessions().map((s) => s.id)).toEqual(['root']);
    expect(countSessions()).toBe(1);
    expect(listSessions({ q: 'sub-agent' })).toHaveLength(0);
    expect(listSessions({ includeSubagents: true }).map((s) => s.id)).toEqual(['child', 'root']);
    expect(countSessions({ includeSubagents: true })).toBe(2);
  });

  it('countSessions respects agent filter', () => {
    upsertSession({ ...BASE, id: 's1', agent: 'a' });
    upsertSession({ ...BASE, id: 's2', agent: 'b' });
    expect(countSessions({ agent: 'a' })).toBe(1);
  });

  it('getDirtySessions returns sessions with no lastIndexedAt', () => {
    upsertSession({ ...BASE, id: 's1' });
    upsertSession({ ...BASE, id: 's2', lastIndexedAt: 1000, fileMtime: 500 });
    const dirty = getDirtySessions().map((s) => s.id);
    expect(dirty).toContain('s1');
    expect(dirty).not.toContain('s2');
  });

  it('getDirtySessions returns sessions where fileMtime > lastIndexedAt', () => {
    upsertSession({ ...BASE, id: 's1', lastIndexedAt: 900, fileMtime: 1000 });
    upsertSession({ ...BASE, id: 's2', lastIndexedAt: 1000, fileMtime: 500 });
    const dirty = getDirtySessions().map((s) => s.id);
    expect(dirty).toContain('s1');
    expect(dirty).not.toContain('s2');
  });

  it('markIndexed sets lastIndexedAt', () => {
    upsertSession(BASE);
    markIndexed('sess-1', 9999);
    expect(getSession('sess-1')!.lastIndexedAt).toBe(9999);
  });

  it('stores child links, parent lookup, and capped trees', () => {
    upsertSession({ ...BASE, id: 'root' });
    upsertSession({ ...BASE, id: 'child', isSubagent: true, parentSessionId: 'root' });
    upsertSession({ ...BASE, id: 'grandchild', isSubagent: true, parentSessionId: 'child' });
    upsertSessionLink('root', 'child', 'subagent', { agent_role: 'explorer' }, 1000);
    upsertSessionLink('child', 'grandchild', 'subagent', null, 1001);

    expect(getSessionChildren('root')).toEqual([
      {
        childId: 'child',
        parentId: 'root',
        relation: 'subagent',
        metadata: { agent_role: 'explorer' },
      },
    ]);
    expect(getSessionParent('child')).toEqual({
      childId: 'child',
      parentId: 'root',
      relation: 'subagent',
      metadata: { agent_role: 'explorer' },
    });
    expect(getSessionTree('root', 1)).toEqual({
      id: 'root',
      relation: 'root',
      children: [{ id: 'child', relation: 'subagent', children: [] }],
    });
    expect(getSessionTree('root', 2).children[0]!.children).toEqual([
      { id: 'grandchild', relation: 'subagent', children: [] },
    ]);
    expect(getSessionSubagentSummary('root')).toEqual({
      v: 1,
      hasSubagents: true,
      subagentCount: 1,
      subagentIds: ['child'],
      descendantSubagentCount: 2,
      subagentDepth: 0,
      rootSessionId: 'root',
      ancestorSessionIds: [],
    });
    expect(getSessionSubagentSummary('child')).toEqual({
      v: 1,
      hasSubagents: true,
      subagentCount: 1,
      subagentIds: ['grandchild'],
      descendantSubagentCount: 1,
      subagentDepth: 1,
      rootSessionId: 'root',
      ancestorSessionIds: ['root'],
    });
  });

  it('removes stale parent links when a child is reparented', () => {
    upsertSession({ ...BASE, id: 'parent-a' });
    upsertSession({ ...BASE, id: 'parent-b' });
    upsertSession({ ...BASE, id: 'child', isSubagent: true, parentSessionId: 'parent-a' });
    upsertSessionLink('parent-a', 'child', 'subagent', { agent_role: 'explorer' }, 1000);

    upsertSession({ ...BASE, id: 'child', isSubagent: true, parentSessionId: 'parent-b' });
    upsertSessionLink('parent-b', 'child', 'subagent', { agent_role: 'worker' }, 1001);

    expect(getSessionChildren('parent-a')).toEqual([]);
    expect(getSessionChildren('parent-b')).toEqual([
      {
        childId: 'child',
        parentId: 'parent-b',
        relation: 'subagent',
        metadata: { agent_role: 'worker' },
      },
    ]);
    expect(getSessionParent('child')).toEqual({
      childId: 'child',
      parentId: 'parent-b',
      relation: 'subagent',
      metadata: { agent_role: 'worker' },
    });
    expect(getSessionTree('parent-a', 1)).toEqual({
      id: 'parent-a',
      relation: 'root',
      children: [],
    });
    expect(getSessionTree('parent-b', 1)).toEqual({
      id: 'parent-b',
      relation: 'root',
      children: [{ id: 'child', relation: 'subagent', children: [] }],
    });
    expect(getSessionSubagentSummary('parent-a')).toMatchObject({
      hasSubagents: false,
      subagentIds: [],
      descendantSubagentCount: 0,
    });
    expect(getSessionSubagentSummary('parent-b')).toMatchObject({
      hasSubagents: true,
      subagentIds: ['child'],
      descendantSubagentCount: 1,
    });
    expect(getSessionSubagentSummary('child')).toMatchObject({
      rootSessionId: 'parent-b',
      ancestorSessionIds: ['parent-b'],
    });
  });
});

describe('queries', () => {
  beforeEach(clearDb);

  it('creates and retrieves a query', () => {
    createQuery(BASE_QUERY);
    const got = getQuery('q1');
    expect(got).not.toBeNull();
    expect(got!.name).toBe('Test Query');
    expect(got!.filters).toEqual(FILTERS);
    expect(got!.enrichers).toEqual([]);
    expect(got!.memberCount).toBe(0);
  });

  it('returns null for unknown query', () => {
    expect(getQuery('nope')).toBeNull();
  });

  it('listQueries returns all queries ordered by createdAt desc', () => {
    createQuery({ ...BASE_QUERY, id: 'q1', createdAt: 1000 });
    createQuery({ ...BASE_QUERY, id: 'q2', name: 'Q2', createdAt: 2000 });
    const list = listQueries();
    expect(list).toHaveLength(2);
    expect(list[0].id).toBe('q2');
  });

  it('deleteQuery removes the query', () => {
    createQuery(BASE_QUERY);
    deleteQuery('q1');
    expect(getQuery('q1')).toBeNull();
    expect(listQueries()).toHaveLength(0);
  });

  it('markQueryRun updates lastRunAt', () => {
    createQuery(BASE_QUERY);
    markQueryRun('q1', 7777);
    expect(getQuery('q1')!.lastRunAt).toBe(7777);
  });
});

describe('query matches', () => {
  beforeEach(clearDb);

  function setup(): string {
    createQuery(BASE_QUERY);
    upsertSession({ ...BASE, id: 's1' });
    upsertSession({ ...BASE, id: 's2' });
    return makeRunFor('q1');
  }

  it('upsertQueryMatch and isQueryMatch', () => {
    const runId = setup();
    upsertQueryMatch({ queryRunId: runId, sessionId: 's1', addedAt: 100 });
    expect(isQueryMatch('q1', 's1')).toBe(true);
    expect(isQueryMatch('q1', 's2')).toBe(false);
  });

  it('dropQueryMatch removes membership', () => {
    const runId = setup();
    upsertQueryMatch({ queryRunId: runId, sessionId: 's1', addedAt: 100 });
    dropQueryMatch(runId, 's1');
    expect(isQueryMatch('q1', 's1')).toBe(false);
  });

  it('listQueryMatches returns sessions in query', () => {
    const runId = setup();
    upsertQueryMatch({ queryRunId: runId, sessionId: 's1', addedAt: 100 });
    const members = listQueryMatches('q1');
    expect(members).toHaveLength(1);
    expect(members[0].id).toBe('s1');
  });

  it('listQueryMatchDetails returns session metadata with evidence and paging', () => {
    const runId = setup();
    upsertSession({ ...BASE, id: 's1', modifiedAt: 1000 });
    upsertSession({ ...BASE, id: 's2', modifiedAt: 2000 });
    upsertQueryMatch({ queryRunId: runId, sessionId: 's1', addedAt: 100, evidence: 'first' });
    upsertQueryMatch({ queryRunId: runId, sessionId: 's2', addedAt: 200, evidence: 'second' });

    const page = listQueryMatchDetails('q1', { limit: 1, offset: 0 });

    expect(page).toHaveLength(1);
    expect(page[0].session.id).toBe('s2');
    expect(page[0].addedAt).toBe(200);
    expect(page[0].evidence).toBe('second');
    expect(countQueryMatches('q1')).toBe(2);
  });

  it('memberCount reflects current membership', () => {
    const runId = setup();
    upsertQueryMatch({ queryRunId: runId, sessionId: 's1', addedAt: 100 });
    upsertQueryMatch({ queryRunId: runId, sessionId: 's2', addedAt: 200 });
    expect(getQuery('q1')!.memberCount).toBe(2);
    dropQueryMatch(runId, 's1');
    expect(getQuery('q1')!.memberCount).toBe(1);
  });

  it('upsertQueryMatch is idempotent (updates evidence)', () => {
    const runId = setup();
    upsertQueryMatch({ queryRunId: runId, sessionId: 's1', addedAt: 100, evidence: 'first' });
    upsertQueryMatch({ queryRunId: runId, sessionId: 's1', addedAt: 200, evidence: 'second' });
    expect(getQuery('q1')!.memberCount).toBe(1);
  });

  it('deleting a saved query preserves runs (saved_query_id set to NULL)', () => {
    const runId = setup();
    upsertQueryMatch({ queryRunId: runId, sessionId: 's1', addedAt: 100 });
    deleteQuery('q1');
    // The run survives, with saved_query_id nulled out.
    const run = getQueryRun(runId);
    expect(run).not.toBeNull();
    expect(run!.savedQueryId).toBeNull();
    // The match row still exists on the run, since the run wasn't deleted.
    expect(
      getDb().prepare('SELECT COUNT(*) AS c FROM query_matches WHERE query_run_id = ?').get(runId),
    ).toEqual({ c: 1 });
  });

  it('clearQueryRun cascade-deletes matches and enrichments', () => {
    const runId = setup();
    upsertQueryMatch({ queryRunId: runId, sessionId: 's1', addedAt: 100 });
    upsertEnrichment('s1', runId, 'whatever', 1, 42, 1000);
    clearQueryRun(runId);
    expect(
      getDb().prepare('SELECT COUNT(*) AS c FROM query_matches WHERE query_run_id = ?').get(runId),
    ).toEqual({ c: 0 });
    expect(
      getDb().prepare('SELECT COUNT(*) AS c FROM session_enrich WHERE query_run_id = ?').get(runId),
    ).toEqual({ c: 0 });
  });

  it('clearQueryRun refuses to delete the system run', () => {
    clearQueryRun(SYSTEM_RUN_ID);
    expect(getQueryRun(SYSTEM_RUN_ID)).not.toBeNull();
  });

  it('unfinished runs do not displace the latest finished run', () => {
    createQuery(BASE_QUERY);
    upsertSession({ ...BASE, id: 's1' });
    upsertSession({ ...BASE, id: 's2' });

    // First run, finished, with one match.
    const finishedRun = createQueryRun({
      savedQueryId: 'q1',
      dsl: { filters: { and: [] }, enrichers: [] },
      startedAt: 1000,
    });
    upsertQueryMatch({ queryRunId: finishedRun, sessionId: 's1', addedAt: 1100 });
    finishQueryRun(finishedRun, { finishedAt: 1200, matchedCount: 1 });

    // Second run starts later but never finishes; partial match attached.
    const inFlight = createQueryRun({
      savedQueryId: 'q1',
      dsl: { filters: { and: [] }, enrichers: [] },
      startedAt: 2000,
    });
    upsertQueryMatch({ queryRunId: inFlight, sessionId: 's2', addedAt: 2100 });

    // Reads should still surface the finished run, not the in-flight one.
    expect(listQueryMatches('q1').map((s) => s.id)).toEqual(['s1']);
    expect(countQueryMatches('q1')).toBe(1);
    expect(isQueryMatch('q1', 's1')).toBe(true);
    expect(isQueryMatch('q1', 's2')).toBe(false);
    expect(getQuery('q1')!.memberCount).toBe(1);
  });
});

describe('enrichments', () => {
  beforeEach(clearDb);

  it('upserts and retrieves an enrichment', () => {
    upsertSession(BASE);
    upsertEnrichment('sess-1', SYSTEM_RUN_ID, 'event_count', 1, 42, 1000);
    const got = getEnrichment('sess-1', SYSTEM_RUN_ID, 'event_count');
    expect(got).not.toBeNull();
    expect(got!.value).toBe(42);
    expect(got!.version).toBe(1);
    expect(got!.computedAt).toBe(1000);
  });

  it('returns null for missing enrichment', () => {
    upsertSession(BASE);
    expect(getEnrichment('sess-1', SYSTEM_RUN_ID, 'nonexistent')).toBeNull();
  });

  it('updates version and value on conflict', () => {
    upsertSession(BASE);
    upsertEnrichment('sess-1', SYSTEM_RUN_ID, 'event_count', 1, 42, 1000);
    upsertEnrichment('sess-1', SYSTEM_RUN_ID, 'event_count', 2, 99, 2000);
    const got = getEnrichment('sess-1', SYSTEM_RUN_ID, 'event_count');
    expect(got!.value).toBe(99);
    expect(got!.version).toBe(2);
    expect(got!.computedAt).toBe(2000);
  });

  it('stores and retrieves complex JSON values', () => {
    upsertSession(BASE);
    upsertEnrichment('sess-1', SYSTEM_RUN_ID, 'tool_counts', 1, { bash: 3, read: 1 }, 1000);
    const got = getEnrichment('sess-1', SYSTEM_RUN_ID, 'tool_counts');
    expect(got!.value).toEqual({ bash: 3, read: 1 });
  });

  it('lists named enrichments ordered by name', () => {
    upsertSession(BASE);
    upsertEnrichment('sess-1', SYSTEM_RUN_ID, 'tool_counts', 1, { Bash: 3 }, 1000);
    upsertEnrichment('sess-1', SYSTEM_RUN_ID, 'event_count', 1, 42, 1000);

    expect(listSessionEnrichments('sess-1')).toEqual([
      { name: 'event_count', version: 1, value: 42, computedAt: 1000 },
      { name: 'tool_counts', version: 1, value: { Bash: 3 }, computedAt: 1000 },
    ]);
  });

  it('returns false boolean value correctly', () => {
    upsertSession(BASE);
    upsertEnrichment('sess-1', SYSTEM_RUN_ID, 'has_errors', 1, false, 1000);
    const got = getEnrichment('sess-1', SYSTEM_RUN_ID, 'has_errors');
    expect(got!.value).toBe(false);
  });

  it('per-run enrichment with the same name as a system one coexists', () => {
    upsertSession(BASE);
    createQuery(BASE_QUERY);
    const runId = makeRunFor('q1');
    upsertEnrichment('sess-1', SYSTEM_RUN_ID, 'tool_counts', 1, { Bash: 1 }, 1000);
    upsertEnrichment('sess-1', runId, 'tool_counts', 1, { Bash: 9 }, 2000);
    expect(getEnrichment('sess-1', SYSTEM_RUN_ID, 'tool_counts')!.value).toEqual({ Bash: 1 });
    expect(getEnrichment('sess-1', runId, 'tool_counts')!.value).toEqual({ Bash: 9 });
  });

  it('filters listSessionEnrichments by run id when provided', () => {
    upsertSession(BASE);
    createQuery(BASE_QUERY);
    const runId = makeRunFor('q1');
    upsertEnrichment('sess-1', SYSTEM_RUN_ID, 'sys', 1, 'a', 1000);
    upsertEnrichment('sess-1', runId, 'qry', 1, 'b', 2000);

    expect(listSessionEnrichments('sess-1', SYSTEM_RUN_ID).map((r) => r.name)).toEqual(['sys']);
    expect(listSessionEnrichments('sess-1', runId).map((r) => r.name)).toEqual(['qry']);
    expect(
      listSessionEnrichments('sess-1')
        .map((r) => r.name)
        .sort(),
    ).toEqual(['qry', 'sys']);
  });
});

describe('query runs', () => {
  beforeEach(clearDb);

  it('system run is always present', () => {
    expect(getQueryRun(SYSTEM_RUN_ID)).not.toBeNull();
  });

  it('saved-query run history accumulates and prunes', () => {
    createQuery(BASE_QUERY);
    for (let i = 0; i < 12; i++) {
      createQueryRun({
        savedQueryId: 'q1',
        dsl: { filters: { and: [] }, enrichers: [] },
        startedAt: 1000 + i,
      });
    }
    expect(listQueryRunsForSavedQuery('q1')).toHaveLength(12);
    pruneQueryRuns({ perSavedQuery: 10, standalone: 10 });
    expect(listQueryRunsForSavedQuery('q1')).toHaveLength(10);
    // System run is untouched
    expect(getQueryRun(SYSTEM_RUN_ID)).not.toBeNull();
  });

  it('listStandaloneRuns excludes the system run and saved-query runs', () => {
    createQuery(BASE_QUERY);
    createQueryRun({
      savedQueryId: 'q1',
      dsl: { filters: { and: [] }, enrichers: [] },
      startedAt: 100,
    });
    const sa = createQueryRun({
      savedQueryId: null,
      dsl: { filters: { and: [] }, enrichers: [] },
      startedAt: 200,
    });
    const list = listStandaloneRuns();
    expect(list.map((r) => r.id)).toEqual([sa]);
  });

  it('finishQueryRun updates finished_at and matched_count', () => {
    const id = createQueryRun({
      savedQueryId: null,
      dsl: { filters: { and: [] }, enrichers: [] },
      startedAt: 100,
    });
    finishQueryRun(id, { finishedAt: 500, matchedCount: 3 });
    const got = getQueryRun(id);
    expect(got!.finishedAt).toBe(500);
    expect(got!.matchedCount).toBe(3);
  });
});

describe('concurrency hardening', () => {
  it('sets a busy_timeout so writers wait instead of failing immediately', () => {
    const db = getDb();
    expect(db.pragma('busy_timeout', { simple: true })).toBe(5000);
  });

  it('keeps schema-current opens read-only while another connection holds the writer slot', () => {
    const dir = mkdtempSync(join(tmpdir(), 'superdense-db-lock-'));
    const path = join(dir, 'superdense.db');
    const writer = new Database(path);
    const reader = new Database(path);
    try {
      writer.pragma('journal_mode = WAL');
      reader.pragma('journal_mode = WAL');
      _migrateForTests(writer);

      writer.exec('BEGIN IMMEDIATE');
      writer.prepare("UPDATE query_run SET dsl = '{}' WHERE id = ?").run(SYSTEM_RUN_ID);

      expect(() => _migrateForTests(reader)).not.toThrow();
      expect(reader.prepare('SELECT COUNT(*) AS count FROM sessions').get()).toEqual({ count: 0 });
    } finally {
      if (writer.inTransaction) writer.exec('ROLLBACK');
      reader.close();
      writer.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('withDbRetry retries on SQLITE_BUSY then succeeds', () => {
    let attempts = 0;
    const result = withDbRetry(() => {
      attempts += 1;
      if (attempts < 3) {
        const err = new Error('database is locked') as Error & { code: string };
        err.code = 'SQLITE_BUSY';
        throw err;
      }
      return 'ok';
    });
    expect(result).toBe('ok');
    expect(attempts).toBe(3);
  });

  it('withDbRetry rethrows non-busy errors without retrying', () => {
    let attempts = 0;
    expect(() =>
      withDbRetry(() => {
        attempts += 1;
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect(attempts).toBe(1);
  });

  it('withDbRetry gives up after exhausting attempts', () => {
    let attempts = 0;
    const make = () => {
      const err = new Error('database is locked') as Error & { code: string };
      err.code = 'SQLITE_BUSY';
      return err;
    };
    expect(() =>
      withDbRetry(() => {
        attempts += 1;
        throw make();
      }, 3),
    ).toThrow('database remained locked after 3 attempts');
    expect(attempts).toBe(3);
  });
});

import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { DB_PATH, ensureSuperdenseDirs } from './paths.js';
import { normalizeQueryDefinition, type QueryDefinition } from './query/types.js';
import { rowToSession, type SessionRow } from './session-row.js';
import type { Query, QueryMatch, Session } from './types.js';
import { resolveProjectKey } from './util/project-key.js';

let dbInstance: Database.Database | null = null;

export const SYSTEM_RUN_ID = 'system';

export function getDb(): Database.Database {
  if (dbInstance) return dbInstance;
  ensureSuperdenseDirs();
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  // Conductor runs many agents in parallel against one DB. WAL lets readers and
  // writers coexist, but concurrent writers still serialize; without a busy
  // timeout the loser throws SQLITE_BUSY ("database is locked") immediately.
  // Wait for a held lock instead of failing.
  db.pragma('busy_timeout = 5000');
  db.function('REGEXP', { deterministic: true }, (pattern: unknown, value: unknown) => {
    if (value == null || pattern == null) return 0;
    try {
      return new RegExp(String(pattern)).test(String(value)) ? 1 : 0;
    } catch {
      return 0;
    }
  });
  migrate(db);
  dbInstance = db;
  return db;
}

/**
 * Run a DB write and retry on SQLITE_BUSY. `busy_timeout` already makes a writer
 * wait for a held lock, but a DEFERRED transaction that upgrades a read lock to a
 * write lock while another writer holds it gets SQLITE_BUSY_SNAPSHOT immediately,
 * ignoring the timeout. A few short synchronous backoffs clear that race under
 * Conductor's parallel agents. Each backoff carries jitter so colliding writers
 * don't re-collide on identical delays (thundering herd). The wrapped work must be
 * atomic (a transaction), so a retry re-runs cleanly.
 */
export function withDbRetry<T>(fn: () => T, attempts = 5): T {
  let lastErr: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return fn();
    } catch (err) {
      const code = (err as { code?: unknown }).code;
      if (typeof code === 'string' && code.startsWith('SQLITE_BUSY') && attempt < attempts - 1) {
        lastErr = err;
        // better-sqlite3 is synchronous; sleep synchronously before retrying.
        const backoffMs = 20 * (attempt + 1) + Math.floor(Math.random() * 20);
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, backoffMs);
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

/** Test-only: reset the cached instance so a fresh :memory: DB can be opened. */
export function _resetDbForTests(): void {
  if (dbInstance) {
    try {
      dbInstance.close();
    } catch {
      /* ignore */
    }
  }
  dbInstance = null;
}

function migrate(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
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
    CREATE INDEX IF NOT EXISTS idx_sessions_pwd ON sessions(pwd);
    CREATE INDEX IF NOT EXISTS idx_sessions_agent ON sessions(agent);
    CREATE INDEX IF NOT EXISTS idx_sessions_modified ON sessions(modified_at);

    CREATE TABLE IF NOT EXISTS queries (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      predicate   TEXT NOT NULL,
      created_at  INTEGER,
      last_run_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS query_run (
      id              TEXT PRIMARY KEY,
      saved_query_id  TEXT REFERENCES queries(id) ON DELETE SET NULL,
      dsl             TEXT NOT NULL,
      started_at      INTEGER NOT NULL,
      finished_at     INTEGER,
      matched_count   INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_qrun_saved ON query_run(saved_query_id);
    CREATE INDEX IF NOT EXISTS idx_qrun_started ON query_run(started_at);
  `);

  // query_matches: create with new schema only if it doesn't already exist.
  // (For V2 dbs the old (query_id, ...) schema is still present until V3 rewrites it.)
  if (!tableExists(db, 'query_matches')) {
    db.exec(`
      CREATE TABLE query_matches (
        query_run_id TEXT NOT NULL REFERENCES query_run(id) ON DELETE CASCADE,
        session_id   TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        added_at     INTEGER,
        evidence     TEXT,
        PRIMARY KEY (query_run_id, session_id)
      );
      CREATE INDEX IF NOT EXISTS idx_query_matches_session ON query_matches(session_id);
      CREATE INDEX IF NOT EXISTS idx_query_matches_run ON query_matches(query_run_id);
    `);
  }

  // session_enrich: same — only create with new schema if not present.
  if (!tableExists(db, 'session_enrich')) {
    db.exec(`
      CREATE TABLE session_enrich (
        session_id   TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        query_run_id TEXT NOT NULL REFERENCES query_run(id) ON DELETE CASCADE,
        name         TEXT NOT NULL,
        version      INTEGER NOT NULL,
        value        TEXT NOT NULL,
        computed_at  INTEGER NOT NULL,
        PRIMARY KEY (session_id, query_run_id, name)
      );
      CREATE INDEX IF NOT EXISTS idx_senrich_name ON session_enrich(name);
      CREATE INDEX IF NOT EXISTS idx_senrich_run ON session_enrich(query_run_id);
    `);
  }

  const currentVersion = (db.pragma('user_version', { simple: true }) as number) ?? 0;
  if (currentVersion < 1) {
    runDataMigrationV1(db);
    db.pragma('user_version = 1');
  }
  if (currentVersion < 2) {
    runDataMigrationV2(db);
    db.pragma('user_version = 2');
  }
  if (currentVersion < 3) {
    runDataMigrationV3(db);
    db.pragma('user_version = 3');
  }
  if (currentVersion < 4) {
    runDataMigrationV4(db);
    db.pragma('user_version = 4');
  }
  // V5 is still under development. Reconcile its schema on every open so
  // pre-release databases already marked as V5 receive later V5 additions.
  runDataMigrationV5(db);
  if (currentVersion < 5) {
    db.pragma('user_version = 5');
  }
  // V6 is reconciled on every open for the same reason as V5: development
  // databases may already carry user_version=6 while the shape is evolving.
  runDataMigrationV6(db, currentVersion < 6);
  if (currentVersion < 6) {
    db.pragma('user_version = 6');
  }
  // V7 folds Layer 3B artifact finalization onto work_thread (no new tables).
  // Reconciled on every open for the same reason as V5/V6.
  runDataMigrationV7(db);
  if (currentVersion < 7) {
    db.pragma('user_version = 7');
  }
  // V8 adds Layer 4 externalization reconciliation. The assessment is folded
  // onto work_thread while connector-specific targets remain child rows.
  runDataMigrationV8(db);
  if (currentVersion < 8) {
    db.pragma('user_version = 8');
  }
  // V9 adds Layer 4 reward collection: an append-only multidimensional reward
  // snapshot time series anchored on linked externalization targets. Superdense
  // never runs connectors; agents report snapshots.
  runDataMigrationV9(db);
  if (currentVersion < 9) {
    db.pragma('user_version = 9');
  }
  // V10 adds an explicit ready queue and makes lineage append-only evidence
  // with a fast effective-membership projection.
  runDataMigrationV10(db);
  if (currentVersion < 10) {
    db.pragma('user_version = 10');
  }

  ensureSystemRun(db);
}

function tableExists(db: Database.Database, name: string): boolean {
  const row = db
    .prepare("SELECT 1 AS x FROM sqlite_master WHERE type='table' AND name = ?")
    .get(name) as { x: number } | undefined;
  return !!row;
}

function columnExists(db: Database.Database, table: string, column: string): boolean {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return rows.some((r) => r.name === column);
}

function runDataMigrationV1(db: Database.Database): void {
  const hasOldGroups = tableExists(db, 'groups');
  const hasOldItems = tableExists(db, 'group_items');
  const hasOldEnrich = tableExists(db, 'session_enrichments');
  if (!hasOldGroups && !hasOldItems && !hasOldEnrich) return;

  const migrateTx = db.transaction(() => {
    if (hasOldGroups) {
      const oldGroups = db
        .prepare('SELECT id, name, plugin_name, plugin_config, created_at, last_run_at FROM groups')
        .all() as Array<{
        id: string;
        name: string;
        plugin_name: string;
        plugin_config: string | null;
        created_at: number | null;
        last_run_at: number | null;
      }>;
      const insertQuery = db.prepare(
        'INSERT OR IGNORE INTO queries (id, name, predicate, created_at, last_run_at) VALUES (?, ?, ?, ?, ?)',
      );
      for (const g of oldGroups) {
        const cfg = g.plugin_config ? JSON.parse(g.plugin_config) : {};
        const filterName =
          g.plugin_name === 'by-user-prompt-keyword' ? 'user_prompt_contains' : g.plugin_name;
        const definition: QueryDefinition = {
          filters: { filter: { name: filterName, params: cfg } },
          enrichers: [],
        };
        insertQuery.run(g.id, g.name, JSON.stringify(definition), g.created_at, g.last_run_at);
      }
    }

    // group_items memberships and session_enrichments values are regeneratable
    // (re-running a saved query rebuilds matches; re-indexing rebuilds enrichments),
    // so we just drop them rather than carry them across schemas.
    if (hasOldItems) db.exec('DROP TABLE group_items;');
    if (hasOldGroups) db.exec('DROP TABLE groups;');
    if (hasOldEnrich) db.exec('DROP TABLE session_enrichments;');
  });
  migrateTx();
}

function runDataMigrationV2(db: Database.Database): void {
  const migrateTx = db.transaction(() => {
    if (!columnExists(db, 'sessions', 'project_key')) {
      db.exec("ALTER TABLE sessions ADD COLUMN project_key TEXT NOT NULL DEFAULT '';");
    }

    const rows = db.prepare('SELECT id, pwd FROM sessions').all() as Array<{
      id: string;
      pwd: string;
    }>;
    const update = db.prepare('UPDATE sessions SET project_key = ? WHERE id = ?');
    for (const row of rows) update.run(resolveProjectKey(row.pwd), row.id);
  });
  migrateTx();
}

function runDataMigrationV3(db: Database.Database): void {
  const hasLegacyEnrich = tableExists(db, 'query_enrich');
  const hasLegacyMatches =
    tableExists(db, 'query_matches') &&
    columnExists(db, 'query_matches', 'query_id') &&
    !columnExists(db, 'query_matches', 'query_run_id');
  if (!hasLegacyEnrich && !hasLegacyMatches) return;

  const tx = db.transaction(() => {
    ensureSystemRun(db);

    // Both legacy match memberships and legacy enrichments are regeneratable — drop
    // the old shapes rather than carrying rows forward.
    if (hasLegacyEnrich) {
      db.exec('DROP TABLE query_enrich;');
    }

    if (hasLegacyMatches) {
      db.exec(`
        DROP TABLE query_matches;
        CREATE TABLE query_matches (
          query_run_id TEXT NOT NULL REFERENCES query_run(id) ON DELETE CASCADE,
          session_id   TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
          added_at     INTEGER,
          evidence     TEXT,
          PRIMARY KEY (query_run_id, session_id)
        );
        CREATE INDEX IF NOT EXISTS idx_query_matches_session ON query_matches(session_id);
        CREATE INDEX IF NOT EXISTS idx_query_matches_run ON query_matches(query_run_id);
      `);
    }
  });
  tx();
}

function runDataMigrationV4(db: Database.Database): void {
  const tx = db.transaction(() => {
    if (!columnExists(db, 'sessions', 'is_subagent')) {
      db.exec('ALTER TABLE sessions ADD COLUMN is_subagent INTEGER NOT NULL DEFAULT 0;');
    }
    if (!columnExists(db, 'sessions', 'parent_session_id')) {
      db.exec('ALTER TABLE sessions ADD COLUMN parent_session_id TEXT;');
    }
    if (!tableExists(db, 'session_links')) {
      db.exec(`
        CREATE TABLE session_links (
          parent_id  TEXT NOT NULL,
          child_id   TEXT NOT NULL,
          relation   TEXT NOT NULL,
          metadata   TEXT,
          created_at INTEGER NOT NULL,
          PRIMARY KEY (parent_id, child_id)
        );
        CREATE INDEX IF NOT EXISTS idx_session_links_child ON session_links(child_id);
        CREATE INDEX IF NOT EXISTS idx_session_links_parent ON session_links(parent_id);
      `);
    }
  });
  tx();
}

function runDataMigrationV5(db: Database.Database): void {
  const tx = db.transaction(() => {
    // session_file: per-session write/read footprint. path_rel (pwd-relativized)
    // is the clustering key and is indexed for inverse lookups (file -> sessions).
    if (!tableExists(db, 'session_file')) {
      db.exec(`
        CREATE TABLE session_file (
          session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
          path_rel   TEXT NOT NULL,
          path_abs   TEXT NOT NULL,
          role       TEXT NOT NULL,
          writes     INTEGER NOT NULL DEFAULT 0,
          reads      INTEGER NOT NULL DEFAULT 0,
          ops        TEXT,
          first_ts   INTEGER,
          last_ts    INTEGER,
          PRIMARY KEY (session_id, path_rel)
        );
      `);
    }
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_session_file_path ON session_file(path_rel);
      CREATE INDEX IF NOT EXISTS idx_session_file_session ON session_file(session_id);
    `);
    // plan_refs: named-plan anchor. plan_slug is indexed for inverse lookups
    // (slug -> sessions sharing that plan = one artifact).
    if (!tableExists(db, 'plan_refs')) {
      db.exec(`
        CREATE TABLE plan_refs (
          session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
          plan_slug  TEXT NOT NULL,
          kind       TEXT NOT NULL,
          PRIMARY KEY (session_id, plan_slug, kind)
        );
      `);
    }
    db.exec('CREATE INDEX IF NOT EXISTS idx_plan_refs_slug ON plan_refs(plan_slug);');
    if (!tableExists(db, 'project_profile')) {
      db.exec(`
        CREATE TABLE project_profile (
          id                    TEXT PRIMARY KEY,
          project_key           TEXT UNIQUE NOT NULL,
          status                TEXT NOT NULL,
          covered_by            TEXT REFERENCES project_profile(id),
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
      `);
    }
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_project_profile_status
        ON project_profile(status, needs_human_attention, last_seen_at);
      CREATE INDEX IF NOT EXISTS idx_project_profile_covered_by
        ON project_profile(covered_by);
    `);

    const now = Date.now();
    db.prepare(
      `INSERT OR IGNORE INTO project_profile (
         id, project_key, status, first_seen_at, last_seen_at, updated_at
       )
       SELECT lower(hex(randomblob(16))), project_key, 'unprofiled',
              COALESCE(MIN(created_at), MIN(modified_at), @now),
              COALESCE(MAX(modified_at), MAX(created_at), @now),
              @now
         FROM sessions
        WHERE project_key IS NOT NULL AND project_key != ''
        GROUP BY project_key`,
    ).run({ now });
  });
  tx();
}

function runDataMigrationV6(db: Database.Database, backfillHistoricalRevisions: boolean): void {
  const tx = db.transaction(() => {
    if (!columnExists(db, 'sessions', 'curation_status')) {
      db.exec("ALTER TABLE sessions ADD COLUMN curation_status TEXT NOT NULL DEFAULT 'pending';");
    }
    if (!columnExists(db, 'sessions', 'curated_revision')) {
      db.exec('ALTER TABLE sessions ADD COLUMN curated_revision TEXT;');
    }
    if (!columnExists(db, 'sessions', 'curated_at')) {
      db.exec('ALTER TABLE sessions ADD COLUMN curated_at INTEGER;');
    }
    if (!columnExists(db, 'sessions', 'curation_note')) {
      db.exec('ALTER TABLE sessions ADD COLUMN curation_note TEXT;');
    }
    if (!columnExists(db, 'sessions', 'curation_priority_at')) {
      db.exec('ALTER TABLE sessions ADD COLUMN curation_priority_at INTEGER;');
    }
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_sessions_curation
        ON sessions(curation_status, curation_priority_at, modified_at);

      CREATE TABLE IF NOT EXISTS pending_session_marker (
        session_id TEXT PRIMARY KEY,
        marked_at  INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS work_thread (
        id                 TEXT PRIMARY KEY,
        project_profile_id TEXT NOT NULL REFERENCES project_profile(id),
        provisional_title  TEXT NOT NULL,
        summary            TEXT,
        status             TEXT NOT NULL DEFAULT 'open',
        created_at         INTEGER NOT NULL,
        updated_at         INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_work_thread_project
        ON work_thread(project_profile_id, updated_at);

      CREATE TABLE IF NOT EXISTS work_thread_session (
        thread_id  TEXT NOT NULL REFERENCES work_thread(id) ON DELETE CASCADE,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        role       TEXT NOT NULL,
        rationale  TEXT,
        PRIMARY KEY (thread_id, session_id)
      );
      CREATE INDEX IF NOT EXISTS idx_work_thread_session_session
        ON work_thread_session(session_id);
    `);

    // Rows that predate the inbox are historical backlog. Recording a baseline
    // revision lets inbox assembly place them after newly discovered sessions.
    if (backfillHistoricalRevisions) {
      db.exec(`
        UPDATE sessions
           SET curated_revision = json_array(file_mtime, modified_at, message_count)
         WHERE curated_revision IS NULL
      `);
    }
  });
  tx();
}

// Layer 3B folds artifact finalization onto work_thread: a finalized thread is
// the artifact, its lineage is the existing work_thread_session rows. Only three
// nullable columns are added; no new tables.
function runDataMigrationV7(db: Database.Database): void {
  const tx = db.transaction(() => {
    if (!columnExists(db, 'work_thread', 'artifact_type')) {
      db.exec('ALTER TABLE work_thread ADD COLUMN artifact_type TEXT;');
    }
    if (!columnExists(db, 'work_thread', 'payload')) {
      db.exec('ALTER TABLE work_thread ADD COLUMN payload TEXT;');
    }
    if (!columnExists(db, 'work_thread', 'artifact_finalized_at')) {
      db.exec('ALTER TABLE work_thread ADD COLUMN artifact_finalized_at INTEGER;');
    }
    db.exec(
      `CREATE INDEX IF NOT EXISTS idx_work_thread_artifact
         ON work_thread(artifact_type, project_profile_id);`,
    );
  });
  tx();
}

function runDataMigrationV8(db: Database.Database): void {
  const tx = db.transaction(() => {
    if (!columnExists(db, 'work_thread', 'externalization_status')) {
      db.exec('ALTER TABLE work_thread ADD COLUMN externalization_status TEXT;');
    }
    if (!columnExists(db, 'work_thread', 'externalization_evidence')) {
      db.exec('ALTER TABLE work_thread ADD COLUMN externalization_evidence TEXT;');
    }
    if (!columnExists(db, 'work_thread', 'externalization_updated_at')) {
      db.exec('ALTER TABLE work_thread ADD COLUMN externalization_updated_at INTEGER;');
    }
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_work_thread_externalization
        ON work_thread(externalization_status, artifact_finalized_at);

      CREATE TABLE IF NOT EXISTS externalization_target (
        id          TEXT PRIMARY KEY,
        artifact_id TEXT NOT NULL REFERENCES work_thread(id) ON DELETE CASCADE,
        connector   TEXT NOT NULL,
        status      TEXT NOT NULL CHECK (
          status IN ('linked', 'needs_connector', 'not_found', 'ambiguous')
        ),
        locator     TEXT,
        evidence    TEXT,
        created_at  INTEGER NOT NULL,
        updated_at  INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_externalization_target_artifact
        ON externalization_target(artifact_id, status);
      CREATE INDEX IF NOT EXISTS idx_externalization_target_connector
        ON externalization_target(connector, status);
    `);
  });
  tx();
}

function runDataMigrationV9(db: Database.Database): void {
  const tx = db.transaction(() => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS reward_snapshot (
        id          TEXT PRIMARY KEY,
        target_id   TEXT NOT NULL REFERENCES externalization_target(id) ON DELETE CASCADE,
        captured_at INTEGER NOT NULL,
        metrics     TEXT NOT NULL,
        primary_dim TEXT,
        source      TEXT,
        evidence    TEXT,
        created_at  INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_reward_snapshot_target
        ON reward_snapshot(target_id, captured_at);
    `);
  });
  tx();
}

function runDataMigrationV10(db: Database.Database): void {
  const tx = db.transaction(() => {
    if (!columnExists(db, 'work_thread', 'ready_at')) {
      db.exec('ALTER TABLE work_thread ADD COLUMN ready_at INTEGER;');
    }
    if (!columnExists(db, 'work_thread', 'readiness_rationale')) {
      db.exec('ALTER TABLE work_thread ADD COLUMN readiness_rationale TEXT;');
    }
    if (!columnExists(db, 'work_thread', 'predecessor_artifact_id')) {
      db.exec(
        'ALTER TABLE work_thread ADD COLUMN predecessor_artifact_id TEXT REFERENCES work_thread(id);',
      );
    }
    db.exec(`
      UPDATE work_thread
         SET status = 'ready',
             ready_at = COALESCE(ready_at, updated_at),
             readiness_rationale = COALESCE(
               readiness_rationale,
               CASE status
                 WHEN 'finalized' THEN 'Migrated from pre-V10 finalized thread'
                 ELSE 'Migrated from pre-release V10 ready thread'
               END
             )
       WHERE status IN ('finalized', 'ready')
         AND artifact_type IS NULL;

      CREATE TABLE IF NOT EXISTS work_thread_lineage_event (
        id          TEXT PRIMARY KEY,
        thread_id   TEXT NOT NULL REFERENCES work_thread(id) ON DELETE CASCADE,
        session_id  TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        event_type  TEXT NOT NULL CHECK (event_type IN ('attach', 'retract')),
        role        TEXT NOT NULL CHECK (role IN ('contributor', 'evidence')),
        rationale   TEXT,
        created_at  INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_work_thread_lineage_event_thread
        ON work_thread_lineage_event(thread_id, created_at, id);
      CREATE INDEX IF NOT EXISTS idx_work_thread_lineage_event_session
        ON work_thread_lineage_event(session_id, created_at);

      DROP TABLE IF EXISTS work_thread_frontier;
    `);

    // Existing memberships predate the event stream. Give each one a
    // deterministic synthetic attach event only when no audited event exists.
    // Remove duplicates created by the earlier pre-release reconciliation.
    db.exec(`
      DELETE FROM work_thread_lineage_event AS synthetic
       WHERE synthetic.id = 'v10-backfill:' || synthetic.thread_id || ':' || synthetic.session_id
         AND EXISTS (
           SELECT 1
             FROM work_thread_lineage_event AS audited
            WHERE audited.thread_id = synthetic.thread_id
              AND audited.session_id = synthetic.session_id
              AND audited.id != synthetic.id
         );

      INSERT OR IGNORE INTO work_thread_lineage_event (
        id, thread_id, session_id, event_type, role, rationale, created_at
      )
      SELECT 'v10-backfill:' || thread_id || ':' || session_id,
             thread_id, session_id, 'attach', role,
             'Backfilled from pre-V10 effective lineage', 0
        FROM work_thread_session AS membership
       WHERE NOT EXISTS (
         SELECT 1
           FROM work_thread_lineage_event AS event
          WHERE event.thread_id = membership.thread_id
            AND event.session_id = membership.session_id
       );
    `);
  });
  tx();
}

function ensureSystemRun(db: Database.Database): void {
  const now = Date.now();
  db.prepare(
    `INSERT OR IGNORE INTO query_run (id, saved_query_id, dsl, started_at, finished_at, matched_count)
     VALUES (?, NULL, '{}', ?, ?, NULL)`,
  ).run(SYSTEM_RUN_ID, now, now);
}

export function _migrateForTests(db: Database.Database): void {
  migrate(db);
}

export function upsertSession(s: Session): void {
  const db = getDb();
  const projectKey = resolveProjectKey(s.pwd);
  db.prepare(
    `
    INSERT INTO sessions (
      id, agent, session_id, log_path, pwd, project_key, first_prompt, summary,
      message_count, git_branch, created_at, modified_at, is_sidechain,
      is_subagent, parent_session_id, file_mtime, last_indexed_at
    ) VALUES (
      @id, @agent, @sessionId, @logPath, @pwd, @projectKey, @firstPrompt, @summary,
      @messageCount, @gitBranch, @createdAt, @modifiedAt, @isSidechain,
      @isSubagent, @parentSessionId, @fileMtime, @lastIndexedAt
    )
    ON CONFLICT(id) DO UPDATE SET
      agent=excluded.agent,
      session_id=excluded.session_id,
      log_path=excluded.log_path,
      pwd=excluded.pwd,
      project_key=excluded.project_key,
      first_prompt=excluded.first_prompt,
      summary=excluded.summary,
      message_count=excluded.message_count,
      git_branch=excluded.git_branch,
      created_at=excluded.created_at,
      modified_at=excluded.modified_at,
      is_sidechain=excluded.is_sidechain,
      is_subagent=excluded.is_subagent,
      parent_session_id=excluded.parent_session_id,
      file_mtime=excluded.file_mtime,
      last_indexed_at=excluded.last_indexed_at
  `,
  ).run({
    id: s.id,
    agent: s.agent,
    sessionId: s.sessionId,
    logPath: s.logPath,
    pwd: s.pwd,
    projectKey,
    firstPrompt: s.firstPrompt ?? null,
    summary: s.summary ?? null,
    messageCount: s.messageCount ?? null,
    gitBranch: s.gitBranch ?? null,
    createdAt: s.createdAt ?? null,
    modifiedAt: s.modifiedAt ?? null,
    isSidechain: s.isSidechain ? 1 : 0,
    isSubagent: s.isSubagent ? 1 : 0,
    parentSessionId: s.parentSessionId ?? null,
    fileMtime: s.fileMtime ?? null,
    lastIndexedAt: s.lastIndexedAt ?? null,
  });
  registerObservedProject(projectKey, s.modifiedAt ?? s.createdAt ?? Date.now());
}

/** Register a conservatively detected project without overwriting agent profile data. */
export function registerObservedProject(projectKey: string, observedAt = Date.now()): string {
  if (!projectKey) throw new Error('project key is required');
  const db = getDb();
  const existing = db
    .prepare('SELECT id FROM project_profile WHERE project_key = ?')
    .get(projectKey) as { id: string } | undefined;
  if (existing) {
    const update = db.prepare(
      `UPDATE project_profile
          SET last_seen_at = MAX(last_seen_at, ?)
        WHERE id = ?`,
    );
    const parent = db.prepare('SELECT covered_by FROM project_profile WHERE id = ?');
    const visited = new Set<string>();
    let id: string | null = existing.id;
    while (id && !visited.has(id)) {
      visited.add(id);
      update.run(observedAt, id);
      id = (parent.get(id) as { covered_by: string | null } | undefined)?.covered_by ?? null;
    }
    return existing.id;
  }
  const id = randomUUID();
  db.prepare(
    `INSERT INTO project_profile (
       id, project_key, status, first_seen_at, last_seen_at, updated_at
     ) VALUES (?, ?, 'unprofiled', ?, ?, ?)`,
  ).run(id, projectKey, observedAt, observedAt, Date.now());
  return id;
}

export interface SessionFilter {
  agent?: string;
  pwd?: string;
  q?: string;
  limit?: number;
  offset?: number;
  includeSubagents?: boolean;
}

function tokenizeQuery(q: string): string[] {
  const tokens: string[] = [];
  const re = /"([^"]*)"|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(q)) !== null) {
    const tok = (m[1] ?? m[2] ?? '').trim();
    if (tok) tokens.push(tok);
  }
  return tokens;
}

function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => '\\' + c);
}

function applyQFilter(
  q: string | undefined,
  where: string[],
  params: Record<string, unknown>,
): void {
  if (!q) return;
  const tokens = tokenizeQuery(q);
  tokens.forEach((tok, i) => {
    const key = `q${i}`;
    params[key] = `%${escapeLike(tok.toLowerCase())}%`;
    where.push(
      `(LOWER(first_prompt) LIKE @${key} ESCAPE '\\' OR LOWER(summary) LIKE @${key} ESCAPE '\\' OR LOWER(pwd) LIKE @${key} ESCAPE '\\')`,
    );
  });
}

export function listSessions(filter: SessionFilter = {}): Session[] {
  const db = getDb();
  const where: string[] = [];
  const params: Record<string, unknown> = {};
  if (!filter.includeSubagents) {
    where.push('is_subagent = 0');
  }
  if (filter.agent) {
    where.push('agent = @agent');
    params.agent = filter.agent;
  }
  if (filter.pwd) {
    where.push('pwd = @pwd');
    params.pwd = filter.pwd;
  }
  applyQFilter(filter.q, where, params);
  const sql = `
    SELECT * FROM sessions
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY COALESCE(modified_at, 0) DESC
    LIMIT @limit OFFSET @offset
  `;
  params.limit = filter.limit ?? 200;
  params.offset = filter.offset ?? 0;
  return db
    .prepare(sql)
    .all(params)
    .map((r: unknown) => rowToSession(r as SessionRow));
}

export function countSessions(filter: SessionFilter = {}): number {
  const db = getDb();
  const where: string[] = [];
  const params: Record<string, unknown> = {};
  if (!filter.includeSubagents) {
    where.push('is_subagent = 0');
  }
  if (filter.agent) {
    where.push('agent = @agent');
    params.agent = filter.agent;
  }
  if (filter.pwd) {
    where.push('pwd = @pwd');
    params.pwd = filter.pwd;
  }
  applyQFilter(filter.q, where, params);
  const sql = `SELECT COUNT(*) AS c FROM sessions ${where.length ? 'WHERE ' + where.join(' AND ') : ''}`;
  return (db.prepare(sql).get(params) as { c: number }).c;
}

export function getSession(id: string): Session | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as SessionRow | undefined;
  return row ? rowToSession(row) : null;
}

export function getDirtySessions(): Session[] {
  const db = getDb();
  const rows = db
    .prepare(
      `
    SELECT * FROM sessions
    WHERE last_indexed_at IS NULL OR (file_mtime IS NOT NULL AND file_mtime > last_indexed_at)
  `,
    )
    .all() as SessionRow[];
  return rows.map(rowToSession);
}

export function markIndexed(sessionId: string, now: number): void {
  getDb().prepare('UPDATE sessions SET last_indexed_at = ? WHERE id = ?').run(now, sessionId);
}

// ---- session links

export function upsertSessionLink(
  parentId: string,
  childId: string,
  relation: string,
  metadata: Record<string, unknown> | null,
  createdAt: number,
): void {
  const db = getDb();
  const metadataJson = metadata ? JSON.stringify(metadata) : null;
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM session_links WHERE child_id = ? AND parent_id != ?').run(
      childId,
      parentId,
    );
    db.prepare(
      `INSERT INTO session_links (parent_id, child_id, relation, metadata, created_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(parent_id, child_id) DO UPDATE SET
         relation=excluded.relation,
         metadata=excluded.metadata`,
    ).run(parentId, childId, relation, metadataJson, createdAt);
  });
  tx();
}

export interface SessionLinkRow {
  childId: string;
  parentId: string;
  relation: string;
  metadata: Record<string, unknown> | null;
}

export function getSessionChildren(parentId: string): SessionLinkRow[] {
  const rows = getDb()
    .prepare('SELECT child_id, relation, metadata FROM session_links WHERE parent_id = ?')
    .all(parentId) as Array<{ child_id: string; relation: string; metadata: string | null }>;
  return rows.map((r) => ({
    childId: r.child_id,
    parentId,
    relation: r.relation,
    metadata: r.metadata ? (JSON.parse(r.metadata) as Record<string, unknown>) : null,
  }));
}

export function getSessionParent(childId: string): SessionLinkRow | null {
  const row = getDb()
    .prepare('SELECT parent_id, relation, metadata FROM session_links WHERE child_id = ? LIMIT 1')
    .get(childId) as { parent_id: string; relation: string; metadata: string | null } | undefined;
  if (!row) return null;
  return {
    childId,
    parentId: row.parent_id,
    relation: row.relation,
    metadata: row.metadata ? (JSON.parse(row.metadata) as Record<string, unknown>) : null,
  };
}

export interface SessionTreeNode {
  id: string;
  relation: string;
  children: SessionTreeNode[];
}

export function getSessionTree(rootId: string, maxDepth = 1): SessionTreeNode {
  function build(id: string, relation: string, depth: number): SessionTreeNode {
    const children: SessionTreeNode[] =
      depth < maxDepth
        ? getSessionChildren(id).map((c) => build(c.childId, c.relation, depth + 1))
        : [];
    return { id, relation, children };
  }
  return build(rootId, 'root', 0);
}

export interface SessionSubagentSummary {
  v: 1;
  hasSubagents: boolean;
  subagentCount: number;
  subagentIds: string[];
  descendantSubagentCount: number;
  subagentDepth: number;
  rootSessionId: string;
  ancestorSessionIds: string[];
}

function getDirectSubagentChildIds(parentId: string): string[] {
  const out = new Set<string>();
  for (const child of getSessionChildren(parentId)) out.add(child.childId);
  const rows = getDb()
    .prepare('SELECT id FROM sessions WHERE parent_session_id = ? ORDER BY id ASC')
    .all(parentId) as Array<{ id: string }>;
  for (const row of rows) out.add(row.id);
  return [...out];
}

function getParentSessionIdForSummary(childId: string): string | null {
  const link = getSessionParent(childId);
  if (link) return link.parentId;
  return getSession(childId)?.parentSessionId ?? null;
}

export function getSessionSubagentSummary(sessionId: string): SessionSubagentSummary {
  const subagentIds = getDirectSubagentChildIds(sessionId);
  const visitedDescendants = new Set<string>([sessionId]);
  const stack = [...subagentIds];
  let descendantSubagentCount = 0;

  while (stack.length > 0) {
    const id = stack.pop()!;
    if (visitedDescendants.has(id)) continue;
    visitedDescendants.add(id);
    descendantSubagentCount += 1;
    stack.push(...getDirectSubagentChildIds(id));
  }

  const ancestorsFromParent: string[] = [];
  const visitedAncestors = new Set<string>([sessionId]);
  let parentId = getParentSessionIdForSummary(sessionId);
  while (parentId && !visitedAncestors.has(parentId)) {
    visitedAncestors.add(parentId);
    ancestorsFromParent.push(parentId);
    parentId = getParentSessionIdForSummary(parentId);
  }

  const ancestorSessionIds = ancestorsFromParent.reverse();
  return {
    v: 1,
    hasSubagents: subagentIds.length > 0,
    subagentCount: subagentIds.length,
    subagentIds,
    descendantSubagentCount,
    subagentDepth: ancestorSessionIds.length,
    rootSessionId: ancestorSessionIds[0] ?? sessionId,
    ancestorSessionIds,
  };
}

// ---- queries

interface QueryRow {
  id: string;
  name: string;
  predicate: string;
  created_at: number | null;
  last_run_at: number | null;
}

function rowToQuery(r: QueryRow, memberCount?: number): Query {
  const definition = normalizeQueryDefinition(JSON.parse(r.predicate));
  return {
    id: r.id,
    name: r.name,
    filters: definition.filters,
    enrichers: definition.enrichers ?? [],
    createdAt: r.created_at ?? 0,
    lastRunAt: r.last_run_at,
    memberCount,
  };
}

/** SQL fragment that counts matches in the latest finished run for a saved query. */
const LATEST_RUN_MEMBER_COUNT_SQL = `
  (SELECT COUNT(*)
     FROM query_matches qm
     JOIN query_run qr ON qr.id = qm.query_run_id
    WHERE qr.saved_query_id = q.id
      AND qr.finished_at IS NOT NULL
      AND qr.started_at = (
        SELECT MAX(started_at) FROM query_run
         WHERE saved_query_id = q.id
           AND finished_at IS NOT NULL
      ))
`;

export function createQuery(q: Omit<Query, 'memberCount' | 'lastRunAt'>): void {
  const definition: QueryDefinition = { filters: q.filters, enrichers: q.enrichers ?? [] };
  getDb()
    .prepare(
      `
    INSERT INTO queries (id, name, predicate, created_at)
    VALUES (?, ?, ?, ?)
  `,
    )
    .run(q.id, q.name, JSON.stringify(definition), q.createdAt);
}

export function updateQueryDefinition(id: string, definition: QueryDefinition): void {
  getDb()
    .prepare('UPDATE queries SET predicate = ? WHERE id = ?')
    .run(JSON.stringify(definition), id);
}

export function listQueries(): Query[] {
  const db = getDb();
  const rows = db
    .prepare(
      `
    SELECT q.*, ${LATEST_RUN_MEMBER_COUNT_SQL} AS member_count
    FROM queries q ORDER BY q.created_at DESC
  `,
    )
    .all() as (QueryRow & { member_count: number })[];
  return rows.map((r) => rowToQuery(r, r.member_count));
}

export function getQuery(id: string): Query | null {
  const db = getDb();
  const row = db
    .prepare(
      `
    SELECT q.*, ${LATEST_RUN_MEMBER_COUNT_SQL} AS member_count
    FROM queries q WHERE q.id = ?
  `,
    )
    .get(id) as (QueryRow & { member_count: number }) | undefined;
  return row ? rowToQuery(row, row.member_count) : null;
}

export function deleteQuery(id: string): void {
  getDb().prepare('DELETE FROM queries WHERE id = ?').run(id);
}

export interface QueryMatchDetail {
  session: Session;
  addedAt: number | null;
  evidence?: string | null;
}

/** Latest finished run id for a saved query, or null if none has run. */
function latestRunIdForSavedQuery(db: Database.Database, savedQueryId: string): string | null {
  const row = db
    .prepare(
      `SELECT id FROM query_run
        WHERE saved_query_id = ?
          AND finished_at IS NOT NULL
        ORDER BY started_at DESC
        LIMIT 1`,
    )
    .get(savedQueryId) as { id: string } | undefined;
  return row?.id ?? null;
}

export function listQueryMatches(savedQueryId: string): Session[] {
  const db = getDb();
  const runId = latestRunIdForSavedQuery(db, savedQueryId);
  if (!runId) return [];
  const rows = db
    .prepare(
      `
    SELECT s.* FROM sessions s
    INNER JOIN query_matches qm ON qm.session_id = s.id
    WHERE qm.query_run_id = ?
    ORDER BY COALESCE(s.modified_at, 0) DESC
  `,
    )
    .all(runId) as SessionRow[];
  return rows.map(rowToSession);
}

export function listQueryMatchDetails(
  savedQueryId: string,
  opts: { limit?: number; offset?: number } = {},
): QueryMatchDetail[] {
  const db = getDb();
  const runId = latestRunIdForSavedQuery(db, savedQueryId);
  if (!runId) return [];
  const rows = db
    .prepare(
      `
    SELECT
      s.*,
      qm.added_at AS match_added_at,
      qm.evidence AS match_evidence
    FROM sessions s
    INNER JOIN query_matches qm ON qm.session_id = s.id
    WHERE qm.query_run_id = @runId
    ORDER BY COALESCE(s.modified_at, 0) DESC
    LIMIT @limit OFFSET @offset
  `,
    )
    .all({
      runId,
      limit: opts.limit ?? 200,
      offset: opts.offset ?? 0,
    }) as Array<SessionRow & { match_added_at: number | null; match_evidence: string | null }>;
  return rows.map((r) => ({
    session: rowToSession(r),
    addedAt: r.match_added_at,
    evidence: r.match_evidence,
  }));
}

export function countQueryMatches(savedQueryId: string): number {
  const db = getDb();
  const runId = latestRunIdForSavedQuery(db, savedQueryId);
  if (!runId) return 0;
  const row = db
    .prepare('SELECT COUNT(*) AS c FROM query_matches WHERE query_run_id = ?')
    .get(runId) as { c: number };
  return row.c;
}

export function upsertQueryMatch(item: QueryMatch): void {
  getDb()
    .prepare(
      `
    INSERT INTO query_matches (query_run_id, session_id, added_at, evidence)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(query_run_id, session_id) DO UPDATE SET evidence=excluded.evidence
  `,
    )
    .run(item.queryRunId, item.sessionId, item.addedAt, item.evidence ?? null);
}

export function dropQueryMatch(queryRunId: string, sessionId: string): void {
  getDb()
    .prepare('DELETE FROM query_matches WHERE query_run_id = ? AND session_id = ?')
    .run(queryRunId, sessionId);
}

export function markQueryRun(savedQueryId: string, now: number): void {
  getDb().prepare('UPDATE queries SET last_run_at = ? WHERE id = ?').run(now, savedQueryId);
}

export function isQueryMatch(savedQueryId: string, sessionId: string): boolean {
  const db = getDb();
  const runId = latestRunIdForSavedQuery(db, savedQueryId);
  if (!runId) return false;
  const r = db
    .prepare('SELECT 1 AS x FROM query_matches WHERE query_run_id = ? AND session_id = ?')
    .get(runId, sessionId);
  return !!r;
}

export function listAllSessionsForBackfill(): Session[] {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM sessions').all() as SessionRow[];
  return rows.map(rowToSession);
}

// ---- query runs

export interface QueryRunRow {
  id: string;
  savedQueryId: string | null;
  dsl: QueryDefinition;
  startedAt: number;
  finishedAt: number | null;
  matchedCount: number | null;
}

interface RawQueryRunRow {
  id: string;
  saved_query_id: string | null;
  dsl: string;
  started_at: number;
  finished_at: number | null;
  matched_count: number | null;
}

function rowToQueryRun(r: RawQueryRunRow): QueryRunRow {
  let dsl: QueryDefinition;
  try {
    const parsed = JSON.parse(r.dsl) as unknown;
    if (
      parsed &&
      typeof parsed === 'object' &&
      'filters' in (parsed as Record<string, unknown>) &&
      (parsed as { filters?: unknown }).filters != null
    ) {
      dsl = parsed as QueryDefinition;
    } else {
      // System run and synthetic legacy rows may have a placeholder dsl.
      dsl = { filters: { and: [] }, enrichers: [] };
    }
  } catch {
    dsl = { filters: { and: [] }, enrichers: [] };
  }
  return {
    id: r.id,
    savedQueryId: r.saved_query_id,
    dsl,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
    matchedCount: r.matched_count,
  };
}

export interface CreateQueryRunInput {
  savedQueryId: string | null;
  dsl: QueryDefinition;
  startedAt: number;
  /** Optional explicit id (defaults to a new UUID). */
  id?: string;
}

export function createQueryRun(input: CreateQueryRunInput): string {
  const id = input.id ?? randomUUID();
  getDb()
    .prepare(
      `INSERT INTO query_run (id, saved_query_id, dsl, started_at, finished_at, matched_count)
       VALUES (?, ?, ?, ?, NULL, NULL)`,
    )
    .run(id, input.savedQueryId, JSON.stringify(input.dsl), input.startedAt);
  return id;
}

export function finishQueryRun(
  runId: string,
  opts: { finishedAt: number; matchedCount: number },
): void {
  getDb()
    .prepare('UPDATE query_run SET finished_at = ?, matched_count = ? WHERE id = ?')
    .run(opts.finishedAt, opts.matchedCount, runId);
}

export function clearQueryRun(runId: string): void {
  if (runId === SYSTEM_RUN_ID) return;
  getDb().prepare('DELETE FROM query_run WHERE id = ?').run(runId);
}

export function getQueryRun(runId: string): QueryRunRow | null {
  const row = getDb().prepare('SELECT * FROM query_run WHERE id = ?').get(runId) as
    | RawQueryRunRow
    | undefined;
  return row ? rowToQueryRun(row) : null;
}

export interface ListRunsOptions {
  limit?: number;
  offset?: number;
}

export function listQueryRunsForSavedQuery(
  savedQueryId: string,
  opts: ListRunsOptions = {},
): QueryRunRow[] {
  const rows = getDb()
    .prepare(
      `SELECT * FROM query_run
        WHERE saved_query_id = @savedQueryId
        ORDER BY started_at DESC
        LIMIT @limit OFFSET @offset`,
    )
    .all({
      savedQueryId,
      limit: opts.limit ?? 50,
      offset: opts.offset ?? 0,
    }) as RawQueryRunRow[];
  return rows.map(rowToQueryRun);
}

export function listStandaloneRuns(opts: ListRunsOptions = {}): QueryRunRow[] {
  const rows = getDb()
    .prepare(
      `SELECT * FROM query_run
        WHERE saved_query_id IS NULL AND id != @sys
        ORDER BY started_at DESC
        LIMIT @limit OFFSET @offset`,
    )
    .all({
      sys: SYSTEM_RUN_ID,
      limit: opts.limit ?? 50,
      offset: opts.offset ?? 0,
    }) as RawQueryRunRow[];
  return rows.map(rowToQueryRun);
}

export interface PruneOptions {
  perSavedQuery?: number;
  standalone?: number;
}

/**
 * Count-based retention: keep the N most recent runs per saved query, plus the N most
 * recent standalone runs. The system run is exempt.
 */
export function pruneQueryRuns(opts: PruneOptions = {}): { pruned: number } {
  const perSavedQuery = opts.perSavedQuery ?? 10;
  const standalone = opts.standalone ?? 10;
  const db = getDb();

  let pruned = 0;
  const tx = db.transaction(() => {
    // Per-saved-query
    const savedRows = db
      .prepare('SELECT DISTINCT saved_query_id FROM query_run WHERE saved_query_id IS NOT NULL')
      .all() as Array<{ saved_query_id: string }>;
    const pickKeep = db.prepare(
      `SELECT id FROM query_run
        WHERE saved_query_id = ?
        ORDER BY started_at DESC
        LIMIT ?`,
    );
    const deleteByIdNotIn = (savedId: string, keepIds: string[]) => {
      if (keepIds.length === 0) {
        const r = db
          .prepare('DELETE FROM query_run WHERE saved_query_id = ? AND id != ?')
          .run(savedId, SYSTEM_RUN_ID);
        pruned += r.changes;
        return;
      }
      const placeholders = keepIds.map(() => '?').join(',');
      const r = db
        .prepare(
          `DELETE FROM query_run
            WHERE saved_query_id = ?
              AND id != ?
              AND id NOT IN (${placeholders})`,
        )
        .run(savedId, SYSTEM_RUN_ID, ...keepIds);
      pruned += r.changes;
    };
    for (const r of savedRows) {
      const keep = pickKeep.all(r.saved_query_id, perSavedQuery) as Array<{ id: string }>;
      deleteByIdNotIn(
        r.saved_query_id,
        keep.map((k) => k.id),
      );
    }

    // Standalone (saved_query_id IS NULL, excluding system)
    const keepStandalone = (
      db
        .prepare(
          `SELECT id FROM query_run
            WHERE saved_query_id IS NULL AND id != ?
            ORDER BY started_at DESC
            LIMIT ?`,
        )
        .all(SYSTEM_RUN_ID, standalone) as Array<{ id: string }>
    ).map((k) => k.id);
    if (keepStandalone.length === 0) {
      const r = db
        .prepare('DELETE FROM query_run WHERE saved_query_id IS NULL AND id != ?')
        .run(SYSTEM_RUN_ID);
      pruned += r.changes;
    } else {
      const placeholders = keepStandalone.map(() => '?').join(',');
      const r = db
        .prepare(
          `DELETE FROM query_run
            WHERE saved_query_id IS NULL
              AND id != ?
              AND id NOT IN (${placeholders})`,
        )
        .run(SYSTEM_RUN_ID, ...keepStandalone);
      pruned += r.changes;
    }
  });
  tx();
  return { pruned };
}

// ---- enrichments (stored in session_enrich, scoped by query_run_id)

export interface EnrichmentRow {
  version: number;
  value: unknown;
  computedAt: number;
}

export interface NamedEnrichmentRow extends EnrichmentRow {
  name: string;
}

export function upsertEnrichment(
  sessionId: string,
  queryRunId: string,
  name: string,
  version: number,
  value: unknown,
  computedAt: number,
): void {
  getDb()
    .prepare(
      `
    INSERT INTO session_enrich (session_id, query_run_id, name, version, value, computed_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(session_id, query_run_id, name) DO UPDATE SET
      version=excluded.version,
      value=excluded.value,
      computed_at=excluded.computed_at
  `,
    )
    .run(sessionId, queryRunId, name, version, JSON.stringify(value), computedAt);
}

export function getEnrichment(
  sessionId: string,
  queryRunId: string,
  name: string,
): EnrichmentRow | null {
  const row = getDb()
    .prepare(
      'SELECT version, value, computed_at FROM session_enrich WHERE session_id = ? AND query_run_id = ? AND name = ?',
    )
    .get(sessionId, queryRunId, name) as
    | { version: number; value: string; computed_at: number }
    | undefined;
  if (!row) return null;
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(row.value);
  } catch {
    parsed = null;
  }
  return { version: row.version, value: parsed, computedAt: row.computed_at };
}

export function listSessionEnrichments(
  sessionId: string,
  queryRunId?: string,
): NamedEnrichmentRow[] {
  const sql = queryRunId
    ? 'SELECT name, version, value, computed_at FROM session_enrich WHERE session_id = ? AND query_run_id = ? ORDER BY name ASC'
    : 'SELECT name, version, value, computed_at FROM session_enrich WHERE session_id = ? ORDER BY name ASC';
  const rows = (
    queryRunId
      ? getDb().prepare(sql).all(sessionId, queryRunId)
      : getDb().prepare(sql).all(sessionId)
  ) as Array<{ name: string; version: number; value: string; computed_at: number }>;
  return rows.map((row) => {
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(row.value);
    } catch {
      parsed = null;
    }
    return {
      name: row.name,
      version: row.version,
      value: parsed,
      computedAt: row.computed_at,
    };
  });
}

// ---- session_file / plan_refs (the Layer-1 join surface, projected from enrichments)

export interface SessionFileInput {
  pathRel: string;
  pathAbs: string;
  role: string;
  writes: number;
  reads: number;
  ops: Record<string, number>;
  firstTs: number | null;
  lastTs: number | null;
}

export interface PlanRefInput {
  slug: string;
  kind: string;
}

/** Replace a session's write/read footprint atomically (delete-then-insert). */
export function replaceSessionFiles(sessionId: string, files: SessionFileInput[]): void {
  const db = getDb();
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM session_file WHERE session_id = ?').run(sessionId);
    const insert = db.prepare(
      `INSERT OR REPLACE INTO session_file
         (session_id, path_rel, path_abs, role, writes, reads, ops, first_ts, last_ts)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const f of files) {
      insert.run(
        sessionId,
        f.pathRel,
        f.pathAbs,
        f.role,
        f.writes,
        f.reads,
        JSON.stringify(f.ops ?? {}),
        f.firstTs,
        f.lastTs,
      );
    }
  });
  tx();
}

/** Replace a session's plan references atomically (delete-then-insert). */
export function replacePlanRefs(sessionId: string, refs: PlanRefInput[]): void {
  const db = getDb();
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM plan_refs WHERE session_id = ?').run(sessionId);
    const insert = db.prepare(
      'INSERT OR IGNORE INTO plan_refs (session_id, plan_slug, kind) VALUES (?, ?, ?)',
    );
    for (const r of refs) insert.run(sessionId, r.slug, r.kind);
  });
  tx();
}

/** Inverse lookup: which sessions touched this pwd-relative path. */
export function sessionsByPathRel(pathRel: string): string[] {
  return (
    getDb()
      .prepare('SELECT session_id FROM session_file WHERE path_rel = ?')
      .all(pathRel) as Array<{ session_id: string }>
  ).map((r) => r.session_id);
}

/** Inverse lookup: which sessions reference this plan slug. */
export function sessionsByPlanSlug(slug: string): string[] {
  return (
    getDb()
      .prepare('SELECT DISTINCT session_id FROM plan_refs WHERE plan_slug = ?')
      .all(slug) as Array<{ session_id: string }>
  ).map((r) => r.session_id);
}

export interface InsightRunRow {
  sessionId: string;
  insightName: string;
  runId: string;
  version: number;
  answer: string | null;
  computedAt: number;
  session: Session;
}

export function listInsightRuns(limit = 200): InsightRunRow[] {
  const rows = getDb()
    .prepare(
      `
    SELECT s.*, se.value AS value, se.computed_at AS computed_at
      FROM session_enrich se
      JOIN sessions s ON s.id = se.session_id
     WHERE se.name = 'insight_run'
       AND se.query_run_id = ?
       AND se.value IS NOT NULL
       AND se.value != 'null'
     ORDER BY COALESCE(s.modified_at, se.computed_at) DESC
     LIMIT ?
  `,
    )
    .all(SYSTEM_RUN_ID, limit) as Array<SessionRow & { value: string; computed_at: number }>;

  const out: InsightRunRow[] = [];
  for (const r of rows) {
    let parsedRaw: unknown = null;
    try {
      parsedRaw = JSON.parse(r.value);
    } catch {
      parsedRaw = null;
    }
    if (!parsedRaw || typeof parsedRaw !== 'object') continue;
    const parsed = parsedRaw as Record<string, unknown>;
    if (typeof parsed.name !== 'string' || !parsed.name) continue;
    out.push({
      sessionId: r.id,
      insightName: parsed.name,
      runId: typeof parsed.runId === 'string' ? parsed.runId : '',
      version: typeof parsed.version === 'number' ? parsed.version : 1,
      answer: typeof parsed.answer === 'string' ? parsed.answer : null,
      computedAt: r.computed_at,
      session: rowToSession(r),
    });
  }
  return out;
}

import { existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, extname, isAbsolute, join, relative } from 'node:path';
import { getDb, SYSTEM_RUN_ID, withImmediateTransaction } from '../db.js';
import type {
  ArtifactDetector,
  ArtifactShape,
  ProjectContext,
  ProjectProfile,
  ProjectProfileResolution,
  ProjectProfileStatus,
  ProjectProfileSummary,
} from './types.js';

interface ProjectProfileRow {
  id: string;
  project_key: string;
  status: string;
  covered_by: string | null;
  name: string | null;
  description: string | null;
  roots: string;
  artifact_shapes: string;
  evidence_summary: string;
  notes: string | null;
  needs_human_attention: number;
  attention_reasons: string;
  first_seen_at: number;
  last_seen_at: number;
  profiled_at: number | null;
  updated_at: number;
}

const PROFILE_FIELDS = new Set([
  'name',
  'description',
  'roots',
  'artifactShapes',
  'evidenceSummary',
  'notes',
  'needsHumanAttention',
  'attentionReasons',
  'coveredProjectIds',
]);

const CENSUS_SKIP = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  '.next',
  'coverage',
  '.turbo',
]);
const MAX_CENSUS_FILES = 500;
const MAX_CENSUS_DIRS = 300;
const MAX_CENSUS_DEPTH = 5;

function parseJson<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function rowToSummary(row: ProjectProfileRow): ProjectProfileSummary {
  return {
    id: row.id,
    projectKey: row.project_key,
    status: row.status as ProjectProfileStatus,
    coveredBy: row.covered_by,
    name: row.name,
    description: row.description,
    roots: parseJson<string[]>(row.roots, []),
    artifactShapes: parseJson<ArtifactShape[]>(row.artifact_shapes, []),
    evidenceSummary: parseJson<string[]>(row.evidence_summary, []),
    notes: row.notes,
    needsHumanAttention: !!row.needs_human_attention,
    attentionReasons: parseJson<string[]>(row.attention_reasons, []),
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    profiledAt: row.profiled_at,
    updatedAt: row.updated_at,
  };
}

function coveredProjects(id: string): ProjectProfileSummary[] {
  return (
    getDb()
      .prepare('SELECT * FROM project_profile WHERE covered_by = ? ORDER BY project_key ASC')
      .all(id) as ProjectProfileRow[]
  ).map(rowToSummary);
}

function summaryToProfile(summary: ProjectProfileSummary): ProjectProfile {
  return { ...summary, coveredProjects: coveredProjects(summary.id) };
}

function rowForId(id: string): ProjectProfileRow | null {
  return (
    (getDb().prepare('SELECT * FROM project_profile WHERE id = ?').get(id) as
      | ProjectProfileRow
      | undefined) ?? null
  );
}

function resolveCanonicalRow(id: string): {
  row: ProjectProfileRow;
  redirectedFrom: string | null;
} {
  let row = rowForId(id);
  if (!row) throw new Error(`project not found: ${id}`);
  const redirectedFrom = row.covered_by ? id : null;
  const visited = new Set<string>();
  while (row.covered_by) {
    if (visited.has(row.id)) throw new Error(`project coverage cycle detected at: ${row.id}`);
    visited.add(row.id);
    const parent = rowForId(row.covered_by);
    if (!parent) throw new Error(`covered project target not found: ${row.covered_by}`);
    row = parent;
  }
  return { row, redirectedFrom };
}

export function getProjectProfile(id: string): ProjectProfile | null {
  try {
    return summaryToProfile(rowToSummary(resolveCanonicalRow(id).row));
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('project not found:')) return null;
    throw err;
  }
}

export function getProjectProfileResolution(id: string): ProjectProfileResolution | null {
  try {
    const resolved = resolveCanonicalRow(id);
    return {
      project: summaryToProfile(rowToSummary(resolved.row)),
      redirectedFrom: resolved.redirectedFrom,
    };
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('project not found:')) return null;
    throw err;
  }
}

export function listProjectProfiles(
  opts: { needsAction?: boolean; includeCovered?: boolean } = {},
): ProjectProfileSummary[] {
  const where: string[] = [];
  if (!opts.includeCovered) where.push("status != 'covered'");
  if (opts.needsAction) {
    where.push("(status = 'unprofiled' OR needs_human_attention = 1)");
  }
  const sql = `
    SELECT * FROM project_profile
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY
      CASE WHEN status = 'unprofiled' OR needs_human_attention = 1 THEN 0 ELSE 1 END,
      last_seen_at DESC,
      project_key ASC
  `;
  return (getDb().prepare(sql).all() as ProjectProfileRow[]).map(rowToSummary);
}

function expectString(value: unknown, field: string, opts: { nullable?: boolean } = {}): void {
  if (value === null && opts.nullable) return;
  if (typeof value !== 'string')
    throw new Error(`${field} must be a string${opts.nullable ? ' or null' : ''}`);
}

function expectStringArray(value: unknown, field: string): asserts value is string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || !item.trim())) {
    throw new Error(`${field} must be an array of non-empty strings`);
  }
}

function validateDetector(detector: unknown, field: string): asserts detector is ArtifactDetector {
  if (!detector || typeof detector !== 'object' || Array.isArray(detector)) {
    throw new Error(`${field} must be an object`);
  }
  const d = detector as Record<string, unknown>;
  if (d.kind === 'folder-leaf' || d.kind === 'file-glob') {
    expectStringArray(d.include, `${field}.include`);
    if (d.exclude !== undefined) expectStringArray(d.exclude, `${field}.exclude`);
    const allowed = new Set(['kind', 'include', 'exclude']);
    for (const key of Object.keys(d)) {
      if (!allowed.has(key)) throw new Error(`${field}.${key} is not supported`);
    }
    return;
  }
  if (d.kind === 'branch' || d.kind === 'whole-surface') {
    if (Object.keys(d).some((key) => key !== 'kind')) {
      throw new Error(`${field} does not accept extra fields`);
    }
    return;
  }
  throw new Error(`${field}.kind must be folder-leaf, file-glob, branch, or whole-surface`);
}

function validateArtifactShapes(value: unknown): asserts value is ArtifactShape[] {
  if (!Array.isArray(value)) throw new Error('artifactShapes must be an array');
  value.forEach((item, index) => {
    const field = `artifactShapes[${index}]`;
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error(`${field} must be an object`);
    }
    const shape = item as Record<string, unknown>;
    expectString(shape.type, `${field}.type`);
    if (!(shape.type as string).trim()) throw new Error(`${field}.type must not be empty`);
    validateDetector(shape.detector, `${field}.detector`);
    if (shape.outputHint !== undefined) {
      if (
        !shape.outputHint ||
        typeof shape.outputHint !== 'object' ||
        Array.isArray(shape.outputHint)
      ) {
        throw new Error(`${field}.outputHint must be an object`);
      }
      const hint = shape.outputHint as Record<string, unknown>;
      expectStringArray(hint.globs, `${field}.outputHint.globs`);
      if (hint.note !== undefined) expectString(hint.note, `${field}.outputHint.note`);
      for (const key of Object.keys(hint)) {
        if (key !== 'globs' && key !== 'note') {
          throw new Error(`${field}.outputHint.${key} is not supported`);
        }
      }
    }
    for (const key of Object.keys(shape)) {
      if (key !== 'type' && key !== 'detector' && key !== 'outputHint') {
        throw new Error(`${field}.${key} is not supported`);
      }
    }
  });
}

function validateProfile(profile: ProjectProfileSummary): void {
  if (profile.status !== 'profiled') throw new Error('canonical project status must be profiled');
  expectString(profile.name, 'name', { nullable: true });
  expectString(profile.description, 'description', { nullable: true });
  expectString(profile.notes, 'notes', { nullable: true });
  expectStringArray(profile.roots, 'roots');
  for (const root of profile.roots) {
    if (!isAbsolute(root)) throw new Error(`roots must contain absolute paths: ${root}`);
  }
  validateArtifactShapes(profile.artifactShapes);
  expectStringArray(profile.evidenceSummary, 'evidenceSummary');
  expectStringArray(profile.attentionReasons, 'attentionReasons');
  if (profile.needsHumanAttention && profile.attentionReasons.length === 0) {
    throw new Error('attentionReasons must not be empty when needsHumanAttention is true');
  }
}

function applyValue<T extends keyof ProjectProfileSummary>(
  target: ProjectProfileSummary,
  patch: Record<string, unknown>,
  field: T,
): void {
  if (Object.prototype.hasOwnProperty.call(patch, field)) {
    (target[field] as unknown) = patch[field];
  }
}

export function applyProjectProfilePatch(id: string, patch: unknown): ProjectProfile {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    throw new Error('profile patch must be an object');
  }
  const input = patch as Record<string, unknown>;
  for (const key of Object.keys(input)) {
    if (!PROFILE_FIELDS.has(key)) throw new Error(`unsupported project patch field: ${key}`);
  }
  if (Object.prototype.hasOwnProperty.call(input, 'coveredProjectIds')) {
    expectStringArray(input.coveredProjectIds, 'coveredProjectIds');
  }

  const db = getDb();
  const resolved = resolveCanonicalRow(id);
  const current = rowToSummary(resolved.row);
  const merged: ProjectProfileSummary = {
    ...current,
    status: 'profiled',
    coveredBy: null,
    profiledAt: current.profiledAt ?? Date.now(),
    updatedAt: Date.now(),
  };
  applyValue(merged, input, 'name');
  applyValue(merged, input, 'description');
  applyValue(merged, input, 'roots');
  applyValue(merged, input, 'artifactShapes');
  applyValue(merged, input, 'evidenceSummary');
  applyValue(merged, input, 'notes');
  applyValue(merged, input, 'needsHumanAttention');
  applyValue(merged, input, 'attentionReasons');
  if (typeof merged.needsHumanAttention !== 'boolean') {
    throw new Error('needsHumanAttention must be a boolean');
  }
  validateProfile(merged);

  const nextCoveredIds = Object.prototype.hasOwnProperty.call(input, 'coveredProjectIds')
    ? (input.coveredProjectIds as string[])
    : coveredProjects(merged.id).map((project) => project.id);
  if (nextCoveredIds.includes(merged.id)) throw new Error('a project cannot cover itself');
  if (new Set(nextCoveredIds).size !== nextCoveredIds.length) {
    throw new Error('coveredProjectIds must not contain duplicates');
  }

  const work = () => {
    for (const coveredId of nextCoveredIds) {
      const row = rowForId(coveredId);
      if (!row) throw new Error(`covered project not found: ${coveredId}`);
      if (row.status === 'profiled' && row.id !== merged.id) {
        throw new Error(`cannot cover an already profiled project: ${coveredId}`);
      }
      if (row.covered_by && row.covered_by !== merged.id) {
        throw new Error(`project is already covered by another profile: ${coveredId}`);
      }
      merged.firstSeenAt = Math.min(merged.firstSeenAt, row.first_seen_at);
      merged.lastSeenAt = Math.max(merged.lastSeenAt, row.last_seen_at);
    }

    db.prepare(
      `UPDATE project_profile
          SET status = 'unprofiled', covered_by = NULL, updated_at = ?
        WHERE covered_by = ?`,
    ).run(Date.now(), merged.id);

    const cover = db.prepare(
      `UPDATE project_profile
          SET status = 'covered', covered_by = ?, updated_at = ?
        WHERE id = ?`,
    );
    for (const coveredId of nextCoveredIds) cover.run(merged.id, Date.now(), coveredId);

    db.prepare(
      `UPDATE project_profile
          SET status = 'profiled',
              covered_by = NULL,
              name = @name,
              description = @description,
              roots = @roots,
              artifact_shapes = @artifactShapes,
              evidence_summary = @evidenceSummary,
              notes = @notes,
              needs_human_attention = @needsHumanAttention,
              attention_reasons = @attentionReasons,
              first_seen_at = @firstSeenAt,
              last_seen_at = @lastSeenAt,
              profiled_at = @profiledAt,
              updated_at = @updatedAt
        WHERE id = @id`,
    ).run({
      id: merged.id,
      name: merged.name,
      description: merged.description,
      roots: JSON.stringify(merged.roots),
      artifactShapes: JSON.stringify(merged.artifactShapes),
      evidenceSummary: JSON.stringify(merged.evidenceSummary),
      notes: merged.notes,
      needsHumanAttention: merged.needsHumanAttention ? 1 : 0,
      attentionReasons: JSON.stringify(merged.attentionReasons),
      firstSeenAt: merged.firstSeenAt,
      lastSeenAt: merged.lastSeenAt,
      profiledAt: merged.profiledAt,
      updatedAt: merged.updatedAt,
    });
  };
  withImmediateTransaction(db, work);
  return getProjectProfile(merged.id)!;
}

export function setProjectAttention(
  id: string,
  input: { needed: boolean; reasons?: string[] },
): ProjectProfile {
  if (typeof input.needed !== 'boolean') throw new Error('needed must be a boolean');
  const reasons = input.needed ? (input.reasons ?? []) : [];
  expectStringArray(reasons, 'reasons');
  if (input.needed && reasons.length === 0) {
    throw new Error('reasons must not be empty when attention is needed');
  }
  const resolved = resolveCanonicalRow(id);
  getDb()
    .prepare(
      `UPDATE project_profile
          SET needs_human_attention = ?, attention_reasons = ?, updated_at = ?
        WHERE id = ?`,
    )
    .run(input.needed ? 1 : 0, JSON.stringify(reasons), Date.now(), resolved.row.id);
  return getProjectProfile(resolved.row.id)!;
}

function projectKeys(profile: ProjectProfile): string[] {
  return [profile.projectKey, ...profile.coveredProjects.map((project) => project.projectKey)];
}

function inClause(values: string[]): string {
  return values.map(() => '?').join(',');
}

function filesystemCensus(candidates: string[]): ProjectContext['fileCensus'] {
  const warnings: string[] = [];
  const root = candidates.find((candidate) => {
    try {
      return existsSync(candidate) && statSync(candidate).isDirectory();
    } catch {
      return false;
    }
  });
  if (!root) {
    return {
      root: null,
      filesScanned: 0,
      directoriesScanned: 0,
      extensions: [],
      sampleFiles: [],
      truncated: false,
      warnings: candidates.length ? ['No accessible representative project root found'] : [],
    };
  }

  const extensionCounts = new Map<string, number>();
  const sampleFiles: string[] = [];
  const queue: Array<{ path: string; depth: number }> = [{ path: root, depth: 0 }];
  let filesScanned = 0;
  let directoriesScanned = 0;
  let truncated = false;

  while (queue.length > 0) {
    if (directoriesScanned >= MAX_CENSUS_DIRS || filesScanned >= MAX_CENSUS_FILES) {
      truncated = true;
      break;
    }
    const current = queue.shift()!;
    directoriesScanned++;
    let entries;
    try {
      entries = readdirSync(current.path, { withFileTypes: true });
    } catch {
      warnings.push(`Could not read ${current.path}`);
      continue;
    }
    for (const entry of entries) {
      if (filesScanned >= MAX_CENSUS_FILES) {
        truncated = true;
        break;
      }
      if (entry.name.startsWith('.') && entry.name !== '.github') continue;
      const absolute = join(current.path, entry.name);
      if (entry.isDirectory()) {
        if (current.depth < MAX_CENSUS_DEPTH && !CENSUS_SKIP.has(entry.name)) {
          queue.push({ path: absolute, depth: current.depth + 1 });
        }
        continue;
      }
      if (!entry.isFile()) continue;
      filesScanned++;
      const rel = relative(root, absolute);
      if (sampleFiles.length < 80) sampleFiles.push(rel);
      const extension = extname(entry.name).toLowerCase() || '(none)';
      extensionCounts.set(extension, (extensionCounts.get(extension) ?? 0) + 1);
    }
  }

  return {
    root,
    filesScanned,
    directoriesScanned,
    extensions: [...extensionCounts.entries()]
      .map(([extension, count]) => ({ extension, count }))
      .sort((a, b) => b.count - a.count || a.extension.localeCompare(b.extension))
      .slice(0, 30),
    sampleFiles,
    truncated,
    warnings,
  };
}

export function getProjectContext(id: string): ProjectContext | null {
  const resolution = getProjectProfileResolution(id);
  if (!resolution) return null;
  const project = resolution.project;
  const keys = projectKeys(project);
  const placeholders = inClause(keys);
  const db = getDb();
  const paths = db
    .prepare(
      `SELECT pwd, COUNT(*) AS sessions, MAX(modified_at) AS last_seen_at
         FROM sessions
        WHERE project_key IN (${placeholders})
        GROUP BY pwd
        ORDER BY COALESCE(last_seen_at, 0) DESC, pwd ASC`,
    )
    .all(...keys) as Array<{ pwd: string; sessions: number; last_seen_at: number | null }>;
  const sessionCount = (
    db
      .prepare(`SELECT COUNT(*) AS count FROM sessions WHERE project_key IN (${placeholders})`)
      .get(...keys) as { count: number }
  ).count;
  const firstIntents = (
    db
      .prepare(
        `SELECT DISTINCT json_extract(se.value, '$.intent') AS intent
           FROM session_enrich se
           JOIN sessions s ON s.id = se.session_id
          WHERE se.name = 'first_intent'
            AND se.query_run_id = ?
            AND json_extract(se.value, '$.intent') IS NOT NULL
            AND s.project_key IN (${placeholders})
          ORDER BY COALESCE(s.modified_at, 0) DESC
          LIMIT 12`,
      )
      .all(SYSTEM_RUN_ID, ...keys) as Array<{ intent: string }>
  ).map((row) => row.intent);
  const touchedFiles = db
    .prepare(
      `SELECT sf.path_rel AS path, COUNT(DISTINCT sf.session_id) AS sessions, SUM(sf.writes) AS writes
           FROM session_file sf
           JOIN sessions s ON s.id = sf.session_id
          WHERE s.project_key IN (${placeholders})
            AND sf.writes > 0
          GROUP BY sf.path_rel
          ORDER BY sessions DESC, writes DESC, path ASC
          LIMIT 40`,
    )
    .all(...keys) as Array<{ path: string; sessions: number; writes: number }>;
  const aggregateEnrichment = (name: string): Array<{ name: string; count: number }> =>
    db
      .prepare(
        `SELECT je.key AS name, SUM(CAST(je.value AS INTEGER)) AS count
             FROM session_enrich se
             JOIN sessions s ON s.id = se.session_id,
                  json_each(se.value) je
            WHERE se.name = ?
              AND se.query_run_id = ?
              AND s.project_key IN (${placeholders})
            GROUP BY je.key
            ORDER BY count DESC, name ASC
            LIMIT 20`,
      )
      .all(name, SYSTEM_RUN_ID, ...keys) as Array<{ name: string; count: number }>;
  const rootCandidates = [...project.roots, ...paths.map((path) => path.pwd), project.projectKey];
  const siblings = listProjectProfiles()
    .filter(
      (candidate) =>
        candidate.id !== project.id &&
        (dirname(candidate.projectKey) === dirname(project.projectKey) ||
          candidate.projectKey.startsWith(`${project.projectKey}/`) ||
          project.projectKey.startsWith(`${candidate.projectKey}/`)),
    )
    .slice(0, 12);

  return {
    project,
    observed: {
      projectKeys: keys,
      paths: paths.map((path) => ({
        pwd: path.pwd,
        sessions: path.sessions,
        lastSeenAt: path.last_seen_at,
      })),
      sessionCount,
      firstIntents,
      touchedFiles,
      tools: aggregateEnrichment('tool_counts'),
      clis: aggregateEnrichment('bash_cli_counts'),
    },
    siblingCandidates: siblings,
    fileCensus: filesystemCensus(rootCandidates),
  };
}

export type {
  ArtifactDetector,
  ArtifactShape,
  ProjectContext,
  ProjectProfile,
  ProjectProfileResolution,
  ProjectProfileStatus,
  ProjectProfileSummary,
} from './types.js';

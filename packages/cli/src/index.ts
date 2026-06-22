#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';
import semver from 'semver';
import {
  assembleInsightPrompt,
  applyCurationBatch,
  addExperimentMember,
  assessExternalization,
  applyProjectProfilePatch,
  CLAUDE_SKILLS_DIR,
  compactSession,
  CODEX_SKILLS_DIR,
  countQueryMatches,
  countSessions,
  createQuery,
  deleteQuery,
  ensureSuperdenseDirs,
  finalizeArtifact,
  getArtifact,
  getExperiment,
  getHypothesis,
  getCompactor,
  getCurationContext,
  getEnrichment,
  getExternalization,
  getArtifactRewards,
  getCohort,
  getVersionChain,
  getRewardStatus,
  getRewardNext,
  listExperiments,
  listHypotheses,
  listCohorts,
  listVersionChains,
  getProjectContext,
  getProjectProfileResolution,
  getQuery,
  SYSTEM_RUN_ID,
  getSession,
  getSessionChildren,
  getSessionCost,
  getSessionTree,
  getWorkThread,
  indexAll,
  listArtifacts,
  listArtifactInbox,
  listCompactors,
  listCurationInbox,
  listEnrichers,
  listExternalizationInbox,
  listExternalizations,
  listFilterCatalog,
  listFilters,
  listInsightRecipes,
  listQueries,
  listProjectProfiles,
  listQueryMatchDetails,
  listSessionEnrichments,
  listSessions,
  listWorkThreads,
  loadUserEnrichers,
  localClaudeSkillsDir,
  localCodexSkillsDir,
  runAdHocQuery,
  runDiscovery,
  runQueryEvaluation,
  runSavedQuery,
  setProjectAttention,
  markSessionForCuration,
  openExperiment,
  recordRewardSnapshot,
  recordRewardSnapshotBatch,
  retireCollectTarget,
  recordHypothesis,
  repairDatabase,
  renderExperimentVerdict,
  resolveHypothesis,
  validateQueryDefinition,
  type AdHocQueryResult,
  type ArtifactExternalization,
  type ArtifactRewards,
  type Cohort,
  type CohortMember,
  type Compactor,
  type Experiment,
  type ExperimentStatus,
  type ExperimentVerdictResult,
  type Hypothesis,
  type HypothesisStatus,
  type QueryMatchDetail,
  type QueryDefinition,
  type RewardSnapshot,
  type Session,
  type VersionChain,
  type WorkThread,
} from '@nimrobo/superdense-core';
import { startServer } from '@nimrobo/superdense-server';
import open from 'open';

const CLI_PACKAGE_NAME = '@nimrobo/superdense';
const NPM_REGISTRY_PACKAGE_URL = `https://registry.npmjs.org/${CLI_PACKAGE_NAME.replace('/', '%2f')}`;
const DEFAULT_REWARD_DOCS_BASE_URL = 'https://www.nimroboai.com/docs/reward';
const SKIP_UPDATE_CHECK_ENV = 'SUPERDENSE_SKIP_UPDATE_CHECK';
const REQUIRED_STUDIO_SKILLS = [
  'superdense',
  'chain',
  'outcome-setup',
  'outcome-run',
  'outcome-update',
];
// Reference files kept once under skills/_shared and copied into each
// consuming skill's references/ directory at install time.
const SHARED_SKILLS_DIR = '_shared';
const SHARED_SKILL_REFERENCES: Record<string, string[]> = {
  'outcome-setup': ['outcome-loop.md'],
  'outcome-run': ['outcome-loop.md', 'preflight.md'],
  'outcome-update': ['outcome-loop.md'],
};
const REWARD_DOC_SECTIONS = ['usage', 'install', 'troubleshoot'] as const;

type RewardDocSection = (typeof REWARD_DOC_SECTIONS)[number];

interface CliIo {
  stdout: Pick<typeof console, 'log'>;
  stderr: Pick<typeof console, 'error'>;
  isTty?: boolean;
}

type SkillScope = 'global' | 'local';
type SkillInstallStatus = 'missing' | 'current' | 'outdated';

interface SkillInstallMarker {
  version: string;
  installedAt: string;
  scope: SkillScope;
}

interface SkillInstallTarget {
  scope: SkillScope;
  claudeRoot: string;
  codexRoot: string;
}

interface CliPackageJson {
  name?: string;
  version?: string;
}

function parseArgs(argv: string[]): {
  cmd: string;
  args: string[];
  flags: Record<string, string | boolean>;
} {
  const flags: Record<string, string | boolean> = {};
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq > -1) flags[a.slice(2, eq)] = a.slice(eq + 1);
      else if (argv[i + 1] && !argv[i + 1]!.startsWith('--')) {
        flags[a.slice(2)] = argv[++i]!;
      } else flags[a.slice(2)] = true;
    } else {
      positional.push(a);
    }
  }
  return { cmd: positional[0] ?? 'help', args: positional.slice(1), flags };
}

function printJson(value: unknown, io: CliIo): void {
  io.stdout.log(JSON.stringify(value, null, io.isTty ? 2 : 0));
}

function printErrorJson(err: unknown, io: CliIo): void {
  io.stderr.error(
    JSON.stringify({
      error: err instanceof Error ? err.message : String(err),
      code: err instanceof Error ? err.name : 'Error',
    }),
  );
}

function intFlag(
  flags: Record<string, string | boolean>,
  name: string,
  fallback: number,
  max?: number,
): number {
  const raw = flags[name];
  if (raw == null || typeof raw === 'boolean') return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  const value = Math.max(0, Math.floor(parsed));
  return max == null ? value : Math.min(value, max);
}

function includePath(flags: Record<string, string | boolean>): boolean {
  return flags['include-path'] === true;
}

function serializeSession(
  session: Session,
  opts: { includePath?: boolean } = {},
): Record<string, unknown> {
  const out: Record<string, unknown> = {
    id: session.id,
    agent: session.agent,
    sessionId: session.sessionId,
    pwd: session.pwd,
    projectKey: session.projectKey,
    firstPrompt: session.firstPrompt ?? null,
    summary: session.summary ?? null,
    messageCount: session.messageCount ?? null,
    gitBranch: session.gitBranch ?? null,
    createdAt: session.createdAt ?? null,
    modifiedAt: session.modifiedAt ?? null,
    isSidechain: !!session.isSidechain,
    isSubagent: !!session.isSubagent,
    parentSessionId: session.parentSessionId ?? null,
    fileMtime: session.fileMtime ?? null,
    lastIndexedAt: session.lastIndexedAt ?? null,
    curationStatus: session.curationStatus ?? 'pending',
    curatedRevision: session.curatedRevision ?? null,
    curatedAt: session.curatedAt ?? null,
    curationNote: session.curationNote ?? null,
    curationPriorityAt: session.curationPriorityAt ?? null,
  };
  const workflowSummary = getEnrichment(session.id, SYSTEM_RUN_ID, 'workflow_summary')?.value;
  if (workflowSummaryHasWorkflow(workflowSummary)) {
    out.workflowSummary = workflowSummary;
  }
  if (opts.includePath) out.logPath = session.logPath;
  return out;
}

function workflowSummaryHasWorkflow(value: unknown): boolean {
  return (
    !!value &&
    typeof value === 'object' &&
    (value as { hasWorkflow?: unknown }).hasWorkflow === true
  );
}

function wantsFull(flags: Record<string, string | boolean>): boolean {
  return flags.full === true;
}

function truncateText(value: string, max = 240): string {
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(0, max - 3))}...`;
}

function compactValue(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') return truncateText(value, depth === 0 ? 360 : 180);
  if (value == null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) {
    if (depth >= 2) return { kind: 'array', length: value.length };
    const sample = value.slice(0, 5).map((item) => compactValue(item, depth + 1));
    return {
      kind: 'array',
      length: value.length,
      sample,
      omitted: Math.max(0, value.length - sample.length),
    };
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    if (depth >= 3) return { kind: 'object', keys: entries.map(([key]) => key) };
    const picked = entries.slice(0, 12);
    const out: Record<string, unknown> = {};
    for (const [key, item] of picked) out[key] = compactValue(item, depth + 1);
    const omitted = entries.length - picked.length;
    if (omitted > 0) out._omittedKeys = omitted;
    return out;
  }
  return String(value);
}

function countThreadSessions(thread: WorkThread): {
  contributors: number;
  evidence: number;
  total: number;
} {
  const sessions = thread.sessions ?? [];
  return {
    contributors: sessions.filter((session) => session.role === 'contributor').length,
    evidence: sessions.filter((session) => session.role === 'evidence').length,
    total: sessions.length,
  };
}

function compactThread(thread: WorkThread, opts: { includePayload?: boolean } = {}) {
  const counts = countThreadSessions(thread);
  const contributorSessionIds =
    thread.sessions
      ?.filter((session) => session.role === 'contributor')
      .map((session) => session.sessionId) ?? [];
  const evidenceSessionIds =
    thread.sessions
      ?.filter((session) => session.role === 'evidence')
      .map((session) => session.sessionId) ?? [];

  return {
    id: thread.id,
    projectId: thread.projectProfileId,
    lifecycle: thread.lifecycle,
    status: thread.status,
    title: thread.provisionalTitle,
    summary: thread.summary,
    artifactType: thread.artifactType,
    finalizedAt: thread.artifactFinalizedAt,
    readyAt: thread.readyAt,
    predecessorArtifactId: thread.predecessorArtifactId,
    humanOnly: thread.humanOnly,
    externalizationStatus: thread.externalizationStatus,
    headSessionId: thread.headSessionId ?? null,
    sessionCounts: counts,
    contributorSessionIds,
    evidenceSessionIds,
    lineageEventCount: thread.lineageEvents?.length ?? 0,
    ...(opts.includePayload && thread.payload ? { payload: compactValue(thread.payload) } : {}),
  };
}

function compactExternalization(externalization: ArtifactExternalization) {
  return {
    artifactId: externalization.artifactId,
    artifactType: externalization.artifactType,
    title: externalization.title,
    summary: externalization.summary,
    finalizedAt: externalization.artifactFinalizedAt,
    status: externalization.status,
    conclusion: externalization.conclusion,
    evidence: externalization.evidence ? truncateText(externalization.evidence) : null,
    updatedAt: externalization.updatedAt,
    targetCounts: externalization.targets.reduce<Record<string, number>>((counts, target) => {
      counts[target.status] = (counts[target.status] ?? 0) + 1;
      return counts;
    }, {}),
    targets: externalization.targets.map((target) => ({
      id: target.id,
      connector: target.connector,
      status: target.status,
      collectStatus: target.collectStatus,
      locator: target.locator,
      evidence: target.evidence ? truncateText(target.evidence) : null,
    })),
  };
}

function compactRewardSnapshot(snapshot: RewardSnapshot | null) {
  if (!snapshot) return null;
  return {
    id: snapshot.id,
    targetId: snapshot.targetId,
    capturedAt: snapshot.capturedAt,
    metrics: snapshot.metrics,
    primaryDim: snapshot.primaryDim,
    source: snapshot.source,
    evidence: snapshot.evidence ? truncateText(snapshot.evidence) : null,
  };
}

function compactRewards(rewards: ArtifactRewards) {
  return {
    artifactId: rewards.artifactId,
    targets: rewards.targets.map((target) => ({
      targetId: target.targetId,
      connector: target.connector,
      locator: target.locator,
      collectStatus: target.collectStatus,
      latest: compactRewardSnapshot(target.latest),
      snapshotCount: target.snapshots.length,
      metricKeys: [
        ...new Set(target.snapshots.flatMap((snapshot) => Object.keys(snapshot.metrics))),
      ],
    })),
  };
}

function compactHypothesis(hypothesis: Hypothesis) {
  return {
    id: hypothesis.id,
    projectId: hypothesis.projectId,
    leverKey: hypothesis.leverKey,
    status: hypothesis.status,
    createdAt: hypothesis.createdAt,
    resolvedAt: hypothesis.resolvedAt,
    action: hypothesis.statement.action,
    diagnostic: hypothesis.statement.diagnostic,
    northStar: hypothesis.statement.northStar,
    window: hypothesis.statement.window,
    mechanism: truncateText(hypothesis.statement.mechanism, 180),
    verdictEvidence: hypothesis.verdictEvidence ? compactValue(hypothesis.verdictEvidence) : null,
  };
}

function compactExperiment(experiment: Experiment) {
  return {
    id: experiment.id,
    hypothesisId: experiment.hypothesisId,
    status: experiment.status,
    targetReps: experiment.targetReps,
    rewardWindow: experiment.rewardWindow,
    predictedSummary: truncateText(experiment.predictedSummary, 220),
    verdict: experiment.verdict,
    createdAt: experiment.createdAt,
    resolvedAt: experiment.resolvedAt,
    memberCount: experiment.members.length,
    memberRunIds: experiment.members.map((member) => member.runId),
    memberArtifactIds: experiment.members.flatMap((member) =>
      member.artifactId ? [member.artifactId] : [],
    ),
    observedSummary: experiment.observedSummary ? compactValue(experiment.observedSummary) : null,
  };
}

function compactExperimentVerdict(result: ExperimentVerdictResult) {
  return {
    ok: result.ok,
    verdict: result.verdict,
    resolved: result.resolved,
    experiment: compactExperiment(result.experiment),
    hypothesis: compactHypothesis(result.hypothesis),
    observedSummary: compactValue(result.observedSummary),
  };
}

function compactCohortMember(member: CohortMember) {
  return {
    artifact: compactThread(member.artifact, { includePayload: true }),
    externalization: member.externalization ? compactExternalization(member.externalization) : null,
    rewards: compactRewards(member.rewards),
    cost: member.cost
      ? {
          contributorSessionIds: member.cost.contributorSessionIds,
          totalCostingWithSubagents: member.cost.totalCostingWithSubagents,
        }
      : null,
  };
}

function compactCohort(cohort: Cohort) {
  return {
    type: cohort.type,
    connector: cohort.connector,
    projectId: cohort.projectId,
    memberCount: cohort.members.length,
    members: cohort.members.map(compactCohortMember),
  };
}

function compactVersionChain(chain: VersionChain) {
  return {
    rootId: chain.rootId,
    type: chain.type,
    memberCount: chain.members.length,
    members: chain.members.map(compactCohortMember),
  };
}

function serializeQueryMatch(
  match: QueryMatchDetail,
  opts: { includePath?: boolean; enrichments?: Record<string, unknown> } = {},
): Record<string, unknown> {
  return {
    session: serializeSession(match.session, opts),
    addedAt: match.addedAt,
    evidence: match.evidence ?? null,
    enrichments: opts.enrichments ?? {},
  };
}

function serializeCompactor(compactor: Compactor): Record<string, unknown> {
  return {
    name: compactor.name,
    kind: compactor.kind,
    targetBytes: compactor.targetBytes ?? null,
    description: compactor.description ?? null,
  };
}

function printCommandHelp(lines: string[], io: CliIo): boolean {
  io.stdout.log(lines.join('\n'));
  return true;
}

async function readQueryDefinition(input: string | boolean | undefined): Promise<QueryDefinition> {
  if (typeof input !== 'string' || !input.trim()) throw new Error('--query is required');
  const raw = input.startsWith('@') ? await readFile(input.slice(1), 'utf8') : input;
  return JSON.parse(raw) as QueryDefinition;
}

async function readJsonObject(
  input: string | boolean | undefined,
  flag: string,
): Promise<Record<string, unknown>> {
  if (typeof input !== 'string' || !input.trim()) throw new Error(`--${flag} is required`);
  const raw = input.startsWith('@') ? await readFile(input.slice(1), 'utf8') : input;
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`--${flag} must contain a JSON object`);
  }
  return parsed as Record<string, unknown>;
}

async function validateCliQueryDefinition(definition: QueryDefinition): Promise<void> {
  await loadUserEnrichers();
  validateQueryDefinition(definition, { filters: await listFilters(), enrichers: listEnrichers() });
}

function getExistingQuery(id: string) {
  const q = getQuery(id);
  if (!q) throw new Error(`query not found: ${id}`);
  return q;
}

function getExistingSession(id: string): Session {
  const session = getSession(id);
  if (!session) throw new Error(`session not found: ${id}`);
  return session;
}

function serializeQueryResult(
  result: AdHocQueryResult,
  opts: { includePath?: boolean } = {},
): Record<string, unknown> {
  return {
    matched: result.matched,
    total: result.total,
    limit: result.limit,
    offset: result.offset,
    enrichers: result.enrichers,
    items: result.items.map((item) => {
      const session = getSession(item.sessionId);
      return {
        sessionId: item.sessionId,
        session: session ? serializeSession(session, { includePath: opts.includePath }) : null,
        evidence: item.evidence ?? null,
        enrichments: item.enrichments ?? {},
      };
    }),
  };
}

function compactFileFootprintValue(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const footprint = value as { v?: unknown; files?: unknown };
  if (!Array.isArray(footprint.files)) return value;
  return {
    v: footprint.v,
    fileCount: footprint.files.length,
    files: footprint.files.map((file) => {
      if (!file || typeof file !== 'object' || Array.isArray(file)) return file;
      const f = file as Record<string, unknown>;
      return {
        pathRel: f.pathRel,
        role: f.role,
        writes: f.writes,
        reads: f.reads,
        ops: f.ops,
      };
    }),
  };
}

function serializeEnrichmentItem(
  item: { name: string; version: number; computedAt: number; value: unknown },
  flags: Record<string, string | boolean>,
) {
  return {
    ...item,
    value:
      item.name === 'file_footprint' && !wantsFull(flags)
        ? compactFileFootprintValue(item.value)
        : item.value,
  };
}

async function runAdHocQueryCommand(
  flags: Record<string, string | boolean>,
  io: CliIo,
  opts: { defaultLimit: number } = { defaultLimit: 20 },
): Promise<void> {
  const definition = await readQueryDefinition(flags.query);
  await validateCliQueryDefinition(definition);
  const limit = intFlag(flags, 'limit', opts.defaultLimit, 1000);
  const offset = intFlag(flags, 'offset', 0);
  const result = await runAdHocQuery(definition, { limit, offset });
  printJson(serializeQueryResult(result, { includePath: includePath(flags) }), io);
}

async function saveQueryCommand(flags: Record<string, string | boolean>, io: CliIo): Promise<void> {
  if (typeof flags.name !== 'string' || !flags.name.trim()) throw new Error('--name is required');
  const definition = await readQueryDefinition(flags.query);
  await validateCliQueryDefinition(definition);
  const id = randomUUID();
  createQuery({
    id,
    name: flags.name.trim(),
    filters: definition.filters,
    enrichers: definition.enrichers ?? [],
    createdAt: Date.now(),
  });
  printJson(getQuery(id), io);
}

async function runSavedQueryCommand(
  id: string | undefined,
  flags: Record<string, string | boolean>,
  io: CliIo,
  commandName: string,
): Promise<void> {
  if (!id) throw new Error(`${commandName} requires <id>`);
  await loadUserEnrichers();
  const result = await runSavedQuery(id);
  if (!result) throw new Error(`query not found: ${id}`);
  const q = getExistingQuery(id);
  const limit = intFlag(flags, 'limit', 200, 1000);
  const offset = intFlag(flags, 'offset', 0);
  const details = listQueryMatchDetails(id, { limit, offset });
  const resultBySession = new Map(result.items.map((item) => [item.sessionId, item] as const));
  printJson(
    {
      query: q,
      matched: result.matched,
      total: countQueryMatches(id),
      limit,
      offset,
      items: details.map((m) =>
        serializeQueryMatch(m, {
          includePath: includePath(flags),
          enrichments: resultBySession.get(m.session.id)?.enrichments ?? {},
        }),
      ),
    },
    io,
  );
}

async function handleSavedQuery(
  args: string[],
  flags: Record<string, string | boolean>,
  io: CliIo,
): Promise<boolean> {
  const action = args[0] ?? 'list';
  if (action === 'list') {
    printJson({ items: listQueries() }, io);
    return true;
  }
  if (action === 'show') {
    const id = args[1];
    if (!id) throw new Error('saved-query show requires <id>');
    const q = getExistingQuery(id);
    const limit = intFlag(flags, 'limit', 200, 1000);
    const offset = intFlag(flags, 'offset', 0);
    const details = listQueryMatchDetails(id, { limit, offset });
    printJson(
      {
        ...q,
        total: countQueryMatches(id),
        limit,
        offset,
        items: details.map((m) => serializeQueryMatch(m, { includePath: includePath(flags) })),
        members: details.map((m) =>
          serializeSession(m.session, { includePath: includePath(flags) }),
        ),
      },
      io,
    );
    return true;
  }
  if (action === 'save' || action === 'create') {
    await saveQueryCommand(flags, io);
    return true;
  }
  if (action === 'run') {
    await runSavedQueryCommand(args[1], flags, io, 'saved-query run');
    return true;
  }
  if (action === 'delete') {
    const id = args[1];
    if (!id) throw new Error('saved-query delete requires <id>');
    deleteQuery(id);
    printJson({ ok: true }, io);
    return true;
  }
  throw new Error(`unknown saved-query command: ${action}`);
}

async function handleQuery(
  args: string[],
  flags: Record<string, string | boolean>,
  io: CliIo,
): Promise<boolean> {
  if (args.length === 0 && flags.query !== undefined) {
    await runAdHocQueryCommand(flags, io);
    return true;
  }
  const action = args[0] ?? 'help';
  if (action === 'list') {
    printJson({ items: listQueries() }, io);
    return true;
  }
  if (action === 'show') {
    const id = args[1];
    if (!id) throw new Error('query show requires <id>');
    const q = getExistingQuery(id);
    const limit = intFlag(flags, 'limit', 200, 1000);
    const offset = intFlag(flags, 'offset', 0);
    const details = listQueryMatchDetails(id, { limit, offset });
    printJson(
      {
        ...q,
        total: countQueryMatches(id),
        limit,
        offset,
        items: details.map((m) => serializeQueryMatch(m, { includePath: includePath(flags) })),
        members: details.map((m) =>
          serializeSession(m.session, { includePath: includePath(flags) }),
        ),
      },
      io,
    );
    return true;
  }
  if (action === 'create' || action === 'save') {
    await saveQueryCommand(flags, io);
    return true;
  }
  if (action === 'preview') {
    await runAdHocQueryCommand(flags, io, { defaultLimit: 5 });
    return true;
  }
  if (action === 'delete') {
    const id = args[1];
    if (!id) throw new Error('query delete requires <id>');
    deleteQuery(id);
    printJson({ ok: true }, io);
    return true;
  }
  if (action === 'run') {
    await runSavedQueryCommand(args[1], flags, io, 'query run');
    return true;
  }
  if (action === 'help') throw new Error('query requires --query or a legacy subcommand');
  throw new Error(`unknown query command: ${action}`);
}

async function handleSession(
  args: string[],
  flags: Record<string, string | boolean>,
  io: CliIo,
): Promise<boolean> {
  const action = args[0] ?? 'list';
  if (action === 'list') {
    const limit = intFlag(flags, 'limit', 200, 1000);
    const offset = intFlag(flags, 'offset', 0);
    const filter = {
      agent: typeof flags.agent === 'string' ? flags.agent : undefined,
      pwd: typeof flags.pwd === 'string' ? flags.pwd : undefined,
      q: typeof flags.q === 'string' ? flags.q : undefined,
      includeSubagents: flags['include-subagents'] === true,
      limit,
      offset,
    };
    printJson(
      {
        items: listSessions(filter).map((s) =>
          serializeSession(s, { includePath: includePath(flags) }),
        ),
        total: countSessions(filter),
        limit,
        offset,
      },
      io,
    );
    return true;
  }
  if (action === 'show') {
    const id = args[1];
    if (!id) throw new Error('session show requires <session-id>');
    const session = getExistingSession(id);
    const children = getSessionChildren(id);
    const serialized = serializeSession(session, { includePath: includePath(flags) });
    serialized.isSubagent = !!session.isSubagent;
    serialized.parentSessionId = session.parentSessionId ?? null;
    serialized.hasSubagents = children.length > 0;
    serialized.subagentCount = children.length;
    serialized.subagentIds = children.map((c) => c.childId);
    printJson({ session: serialized }, io);
    return true;
  }
  if (action === 'cost') {
    const id = args[1];
    if (!id) throw new Error('session cost requires <session-id>');
    getExistingSession(id);
    const result = getSessionCost(id, {
      tree: flags.tree === true,
      depth: intFlag(flags, 'depth', 20, 20),
    });
    printJson(result, io);
    return true;
  }
  if (action === 'children') {
    const id = args[1];
    if (!id) throw new Error('session children requires <session-id>');
    getExistingSession(id); // validate session exists
    const children = getSessionChildren(id);
    if (flags.full === true) {
      printJson(
        {
          parentId: id,
          items: children.map((c) => ({
            id: c.childId,
            relation: c.relation,
            metadata: c.metadata,
            session: (() => {
              const s = getSession(c.childId);
              return s ? serializeSession(s, { includePath: includePath(flags) }) : null;
            })(),
          })),
        },
        io,
      );
    } else {
      printJson(
        {
          parentId: id,
          items: children.map((c) => ({ id: c.childId, relation: c.relation })),
        },
        io,
      );
    }
    return true;
  }
  if (action === 'tree') {
    const id = args[1];
    if (!id) throw new Error('session tree requires <session-id>');
    getExistingSession(id); // validate session exists
    const depth = intFlag(flags, 'depth', 1, 20);
    const tree = getSessionTree(id, depth);
    printJson({ tree }, io);
    return true;
  }
  if (action === 'path') {
    const id = args[1];
    if (!id) throw new Error('session path requires <session-id>');
    const session = getExistingSession(id);
    printJson(
      {
        id: session.id,
        agent: session.agent,
        sessionId: session.sessionId,
        logPath: session.logPath,
      },
      io,
    );
    return true;
  }
  if (action === 'fields') {
    await loadUserEnrichers();
    printJson(
      {
        filters: await listFilterCatalog(),
        enrichers: listEnrichers().map(({ name, version, returns, jsonSchema, description }) => ({
          name,
          version,
          returns,
          jsonSchema,
          description,
        })),
      },
      io,
    );
    return true;
  }
  if (action === 'enrichments') {
    const id = args[1];
    if (!id) throw new Error('session enrichments requires <session-id>');
    const session = getExistingSession(id);
    let items;
    if (typeof flags.name === 'string' && flags.name.trim()) {
      const item = getEnrichment(id, SYSTEM_RUN_ID, flags.name.trim());
      items = item ? [serializeEnrichmentItem({ name: flags.name.trim(), ...item }, flags)] : [];
    } else {
      items = listSessionEnrichments(id, SYSTEM_RUN_ID).map((item) =>
        serializeEnrichmentItem(item, flags),
      );
    }
    printJson(
      {
        session: serializeSession(session, { includePath: includePath(flags) }),
        items,
      },
      io,
    );
    return true;
  }
  throw new Error(`unknown session command: ${action}`);
}

async function handleCompactor(
  args: string[],
  flags: Record<string, string | boolean>,
  io: CliIo,
): Promise<boolean> {
  const action = args[0] ?? 'list';
  if (action === 'list') {
    printJson({ items: listCompactors().map(serializeCompactor) }, io);
    return true;
  }
  if (action === 'show') {
    const name = args[1];
    if (!name) throw new Error('compactor show requires <name>');
    const compactor = getCompactor(name);
    if (!compactor) throw new Error(`compactor not found: ${name}`);
    printJson(serializeCompactor(compactor), io);
    return true;
  }
  if (action === 'run') {
    const name = args[1];
    const sessionId = args[2];
    if (!name || !sessionId) throw new Error('compactor run requires <name> <session-id>');
    const compactor = getCompactor(name);
    if (!compactor) throw new Error(`compactor not found: ${name}`);
    const session = getExistingSession(sessionId);
    const result = await compactSession(name, session);
    printJson(
      {
        session: serializeSession(session, { includePath: includePath(flags) }),
        compactor: serializeCompactor(compactor),
        result,
      },
      io,
    );
    return true;
  }
  throw new Error(`unknown compactor command: ${action}`);
}

async function handleEnricher(args: string[], io: CliIo): Promise<boolean> {
  const action = args[0] ?? 'list';
  await loadUserEnrichers();
  if (action === 'list') {
    printJson(
      {
        items: listEnrichers().map(({ name, version, returns, jsonSchema, description }) => ({
          name,
          version,
          returns,
          jsonSchema,
          description,
        })),
      },
      io,
    );
    return true;
  }
  if (action === 'show') {
    const name = args[1];
    if (!name) throw new Error('enricher show requires <name>');
    const e = listEnrichers().find((x) => x.name === name);
    if (!e) throw new Error(`enricher not found: ${name}`);
    const { run: _run, ...serializable } = e;
    printJson(serializable, io);
    return true;
  }
  throw new Error(`unknown enricher command: ${action}`);
}

async function handleProject(
  args: string[],
  flags: Record<string, string | boolean>,
  io: CliIo,
): Promise<boolean> {
  const action = args[0] ?? 'list';
  if (action === 'list') {
    printJson(
      {
        items: listProjectProfiles({ needsAction: flags['needs-action'] === true }),
      },
      io,
    );
    return true;
  }
  const id = args[1];
  if (!id) throw new Error(`project ${action} requires <id>`);
  if (action === 'show') {
    const result = getProjectProfileResolution(id);
    if (!result) throw new Error(`project not found: ${id}`);
    printJson(result, io);
    return true;
  }
  if (action === 'context') {
    const context = getProjectContext(id);
    if (!context) throw new Error(`project not found: ${id}`);
    printJson(context, io);
    return true;
  }
  if (action === 'apply') {
    const patch = await readJsonObject(flags.patch, 'patch');
    printJson({ project: applyProjectProfilePatch(id, patch) }, io);
    return true;
  }
  if (action === 'attention') {
    if (flags.needed === true) {
      const reasons =
        typeof flags.reasons === 'string'
          ? (JSON.parse(flags.reasons) as unknown)
          : ['Marked for human attention'];
      if (!Array.isArray(reasons) || reasons.some((reason) => typeof reason !== 'string')) {
        throw new Error('--reasons must be a JSON array of strings');
      }
      printJson({ project: setProjectAttention(id, { needed: true, reasons }) }, io);
      return true;
    }
    if (flags.resolved === true) {
      printJson({ project: setProjectAttention(id, { needed: false }) }, io);
      return true;
    }
    throw new Error('project attention requires --needed or --resolved');
  }
  throw new Error(`unknown project command: ${action}`);
}

function resolveCurrentSessionId(env: NodeJS.ProcessEnv = process.env): string {
  if (env.SUPERDENSE_CURRENT_SESSION_ID) return env.SUPERDENSE_CURRENT_SESSION_ID;
  if (env.CODEX_THREAD_ID) return `codex:${env.CODEX_THREAD_ID}`;
  if (env.CLAUDE_CODE_SESSION_ID) return `claude-code:${env.CLAUDE_CODE_SESSION_ID}`;
  if (env.CLAUDE_CODE_REMOTE_SESSION_ID) return `claude-code:${env.CLAUDE_CODE_REMOTE_SESSION_ID}`;
  throw new Error(
    'could not resolve the current session from the environment; use `superdense artifact mark --session <adapter:id>`',
  );
}

async function handleArtifact(
  args: string[],
  flags: Record<string, string | boolean>,
  io: CliIo,
): Promise<boolean> {
  const action = args[0];
  if (flags.help === true && action === 'finalize') {
    return printCommandHelp(
      [
        'Usage: superdense artifact finalize --input <json|@file>',
        '',
        'Input: {"threadId":"<ready-thread>","type":"<lower-kebab-type>","title":"<optional>","payload":{...},"predecessorArtifactId":"<optional>"}',
        'Example: superdense artifact finalize --input \'{"threadId":"thread-1","type":"post","title":"Launch post","payload":{"text":"Shipped"}}\'',
      ],
      io,
    );
  }
  if (action === 'mark-current') {
    printJson({ marker: markSessionForCuration(resolveCurrentSessionId()) }, io);
    return true;
  }
  if (action === 'mark') {
    if (typeof flags.session !== 'string' || !flags.session.trim()) {
      throw new Error('artifact mark requires --session <adapter:id>');
    }
    printJson({ marker: markSessionForCuration(flags.session.trim()) }, io);
    return true;
  }
  if (action === 'inbox') {
    const inbox = listArtifactInbox({
      ...(typeof flags.project === 'string' ? { projectId: flags.project } : {}),
      limit: intFlag(flags, 'limit', 10, 1000),
    });
    printJson(
      wantsFull(flags)
        ? inbox
        : { ...inbox, items: inbox.items.map((item) => compactThread(item)) },
      io,
    );
    return true;
  }
  if (action === 'finalize') {
    printJson(finalizeArtifact(await readJsonObject(flags.input, 'input')), io);
    return true;
  }
  if (action === 'list') {
    const items = listArtifacts({
      projectId: typeof flags.project === 'string' ? flags.project : undefined,
      type: typeof flags.type === 'string' ? flags.type : undefined,
    });
    printJson(
      {
        items: wantsFull(flags) ? items : items.map((item) => compactThread(item)),
      },
      io,
    );
    return true;
  }
  if (action === 'show') {
    const id = args[1];
    if (!id) throw new Error('artifact show requires <thread-id>');
    const artifact = getArtifact(id);
    if (!artifact) throw new Error(`artifact not found: ${id}`);
    printJson(
      { artifact: wantsFull(flags) ? artifact : compactThread(artifact, { includePayload: true }) },
      io,
    );
    return true;
  }
  throw new Error(`unknown artifact command: ${action ?? '(none)'}`);
}

async function handleCuration(
  args: string[],
  flags: Record<string, string | boolean>,
  io: CliIo,
): Promise<boolean> {
  const action = args[0];
  if (flags.help === true && action === 'apply') {
    return printCommandHelp(
      [
        'Usage: superdense curation apply --input <json|@file>',
        '',
        'Input: {"actions":[{"type":"thread.create|thread.update|thread.attach|thread.detach|thread.mark-ready|thread.reopen|session.consume|session.skip|session.defer|..."}]}',
        'Human-only example: superdense curation apply --input \'{"actions":[{"type":"thread.create","id":"human-post-1","projectProfileId":"<project-id>","provisionalTitle":"Manual post","summary":"Written directly by the human","humanOnly":true},{"type":"thread.mark-ready","threadId":"human-post-1","rationale":"Final posted text is known"}]}\'',
      ],
      io,
    );
  }
  if (action === 'inbox') {
    printJson(
      listCurationInbox({
        projectId: typeof flags.project === 'string' ? flags.project : undefined,
        limit: intFlag(flags, 'limit', 10, 1000),
      }),
      io,
    );
    return true;
  }
  if (action === 'context') {
    const sessionId = args[1];
    if (!sessionId) throw new Error('curation context requires <root-session-id>');
    printJson(getCurationContext(sessionId), io);
    return true;
  }
  if (action === 'apply') {
    printJson(applyCurationBatch(await readJsonObject(flags.input, 'input')), io);
    return true;
  }
  throw new Error(`unknown curation command: ${action ?? '(none)'}`);
}

function handleThread(args: string[], flags: Record<string, string | boolean>, io: CliIo): boolean {
  const action = args[0] ?? 'list';
  if (action === 'list') {
    const items = listWorkThreads({
      projectId: typeof flags.project === 'string' ? flags.project : undefined,
    });
    printJson(
      {
        items: wantsFull(flags) ? items : items.map((item) => compactThread(item)),
      },
      io,
    );
    return true;
  }
  if (action === 'show') {
    const id = args[1];
    if (!id) throw new Error('thread show requires <thread-id>');
    const thread = getWorkThread(id);
    if (!thread) throw new Error(`thread not found: ${id}`);
    printJson(
      { thread: wantsFull(flags) ? thread : compactThread(thread, { includePayload: true }) },
      io,
    );
    return true;
  }
  throw new Error(`unknown thread command: ${action}`);
}

async function handleExternalization(
  args: string[],
  flags: Record<string, string | boolean>,
  io: CliIo,
): Promise<boolean> {
  const action = args[0];
  if (flags.help === true && action === 'assess') {
    return printCommandHelp(
      [
        'Usage: superdense externalization assess --input <json|@file>',
        '',
        'Input: {"artifactId":"<id>","status":"external|not_external","evidence":"<non-empty>","targets":[{"connector":"x","status":"linked","locator":"<authoritative-id-or-url>","evidence":"<optional>"}]}',
        'Example: superdense externalization assess --input \'{"artifactId":"human-post-1","status":"external","evidence":"Published manually","targets":[{"connector":"x","status":"linked","locator":"https://x.com/user/status/123"}]}\'',
      ],
      io,
    );
  }
  if (action === 'inbox') {
    const inbox = listExternalizationInbox({
      ...(typeof flags.project === 'string' ? { projectId: flags.project } : {}),
      limit: intFlag(flags, 'limit', 10, 1000),
      cursor: typeof flags.cursor === 'string' ? flags.cursor : undefined,
    });
    printJson(
      wantsFull(flags)
        ? inbox
        : { ...inbox, items: inbox.items.map((item) => compactExternalization(item)) },
      io,
    );
    return true;
  }
  if (action === 'list') {
    const status = typeof flags.status === 'string' ? flags.status : undefined;
    const items = listExternalizations({
      ...(status ? { status } : {}),
      ...(typeof flags.project === 'string' ? { projectId: flags.project } : {}),
      ...(flags['include-retired'] === true ? { includeRetired: true } : {}),
    });
    printJson(
      { items: wantsFull(flags) ? items : items.map((item) => compactExternalization(item)) },
      io,
    );
    return true;
  }
  if (action === 'show') {
    const id = args[1];
    if (!id) throw new Error('externalization show requires <artifact-id>');
    const externalization = getExternalization(id);
    if (!externalization) throw new Error(`artifact not found: ${id}`);
    printJson(
      {
        externalization: wantsFull(flags)
          ? externalization
          : compactExternalization(externalization),
      },
      io,
    );
    return true;
  }
  if (action === 'assess') {
    printJson(assessExternalization(await readJsonObject(flags.input, 'input')), io);
    return true;
  }
  throw new Error(`unknown externalization command: ${args.join(' ') || '(none)'}`);
}

function rewardDocsBaseUrl(): string {
  const base =
    typeof process.env.SUPERDENSE_DOCS_BASE_URL === 'string' &&
    process.env.SUPERDENSE_DOCS_BASE_URL.trim() !== ''
      ? process.env.SUPERDENSE_DOCS_BASE_URL.trim()
      : DEFAULT_REWARD_DOCS_BASE_URL;
  return base.replace(/\/+$/, '');
}

function rewardDocsPath(...segments: string[]): string {
  return `/${segments.map((segment) => encodeURIComponent(segment)).join('/')}`;
}

function isRewardDocSection(value: string): value is RewardDocSection {
  return REWARD_DOC_SECTIONS.includes(value as RewardDocSection);
}

async function fetchRewardDocs(path: string): Promise<string> {
  const url = `${rewardDocsBaseUrl()}${path}`;
  try {
    const response = await fetch(url, {
      headers: { accept: 'text/markdown, text/plain;q=0.9, */*;q=0.1' },
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) {
      const statusText = response.statusText ? ` ${response.statusText}` : '';
      throw new Error(`HTTP ${response.status}${statusText}`);
    }
    return await response.text();
  } catch (err) {
    throw new Error(
      `reward docs unavailable: ${url} (${err instanceof Error ? err.message : String(err)}) - check your connection`,
    );
  }
}

async function handleRewardDocs(
  args: string[],
  flags: Record<string, string | boolean>,
  io: CliIo,
): Promise<boolean> {
  const action = args[0];
  if (action === 'artifacts') {
    io.stdout.log(await fetchRewardDocs(rewardDocsPath('artifacts')));
    return true;
  }

  if (action === 'connectors') {
    const artifact = typeof flags.artifact === 'string' ? flags.artifact : undefined;
    const connector = typeof flags.connector === 'string' ? flags.connector : undefined;
    if ((artifact ? 1 : 0) + (connector ? 1 : 0) !== 1) {
      throw new Error('reward docs connectors requires exactly one of --artifact or --connector');
    }

    if (artifact) {
      io.stdout.log(await fetchRewardDocs(rewardDocsPath('artifacts', artifact, 'connectors')));
      return true;
    }

    const section = typeof flags.section === 'string' ? flags.section : 'usage';
    if (!isRewardDocSection(section)) {
      throw new Error(
        "reward docs connectors --section must be 'usage', 'install', or 'troubleshoot'",
      );
    }
    io.stdout.log(await fetchRewardDocs(rewardDocsPath('connectors', connector!, section)));
    return true;
  }

  throw new Error(`unknown reward docs command: ${args.join(' ') || '(none)'}`);
}

async function handleReward(
  args: string[],
  flags: Record<string, string | boolean>,
  io: CliIo,
): Promise<boolean> {
  const action = args[0];
  if (flags.help === true && (action === 'record' || action === 'record-batch')) {
    return printCommandHelp(
      action === 'record'
        ? [
            'Usage: superdense reward record --input <json|@file>',
            '',
            'Input: {"targetId":"<linked-target-id>","metrics":{"views":1200},"primaryDim":"views","source":"<optional>","evidence":"<optional>","capturedAt":1700000000000}',
            'Example: superdense reward record --input \'{"targetId":"target-1","metrics":{"views":1200},"primaryDim":"views"}\'',
          ]
        : [
            'Usage: superdense reward record-batch --input <json|@file>',
            '',
            'Input: {"snapshots":[{"targetId":"<linked-target-id>","metrics":{"views":1200},"primaryDim":"views","source":"<optional>","evidence":"<optional>","capturedAt":1700000000000}]}',
            'The batch is atomic, preserves input order, and accepts at most 100 snapshots.',
            'Example: superdense reward record-batch --input \'{"snapshots":[{"targetId":"target-1","metrics":{"views":1200}},{"targetId":"target-2","metrics":{"views":800}}]}\'',
          ],
      io,
    );
  }
  if (action === 'docs') {
    return handleRewardDocs(args.slice(1), flags, io);
  }
  if (action === 'record') {
    printJson(recordRewardSnapshot(await readJsonObject(flags.input, 'input')), io);
    return true;
  }
  if (action === 'record-batch') {
    printJson(recordRewardSnapshotBatch(await readJsonObject(flags.input, 'input')), io);
    return true;
  }
  if (action === 'show') {
    const id = args[1];
    if (!id) throw new Error('reward show requires <artifact-id>');
    const rewards = getArtifactRewards(id);
    if (!rewards) throw new Error(`artifact not found: ${id}`);
    printJson({ rewards: wantsFull(flags) ? rewards : compactRewards(rewards) }, io);
    return true;
  }
  if (action === 'status') {
    const projectId = typeof flags.project === 'string' ? flags.project : undefined;
    printJson(getRewardStatus({ projectId }), io);
    return true;
  }
  if (action === 'next') {
    if (flags.help === true) {
      return printCommandHelp(
        [
          'Usage: superdense reward next --project <project-id> [--items <n>]',
          '',
          'Plans the next maintenance items (profile -> curate -> finalize ->',
          'reconcile -> collect) in one call so the preflight need not re-run',
          'status between stages. --items budgets actionable items across the',
          'pipeline (default 10), walked stage by stage; each step reports its',
          'take. compare is excluded; it is the run agent’s job. Retires matured',
          'linked and non-located targets first, then stamps the project’s',
          'reward_next_run_at and returns the prior value plus project name/roots.',
        ],
        io,
      );
    }
    const projectId = typeof flags.project === 'string' ? flags.project : undefined;
    if (!projectId) throw new Error('reward next requires --project <project-id>');
    const items = intFlag(flags, 'items', 10, 1000);
    printJson(getRewardNext({ projectId, items }), io);
    return true;
  }
  if (action === 'collect') {
    return handleRewardCollect(args.slice(1), flags, io);
  }
  throw new Error(`unknown reward command: ${args.join(' ') || '(none)'}`);
}

async function handleRewardCollect(
  args: string[],
  flags: Record<string, string | boolean>,
  io: CliIo,
): Promise<boolean> {
  const action = args[0];
  if (action === 'retire') {
    const targetId = args[1];
    if (flags.help === true) {
      return printCommandHelp(
        [
          'Usage: superdense reward collect retire <target-id> --project <project-id>',
          '',
          'Retires one linked target so it drops out of the collectable set.',
          'Both the target id and --project are required.',
        ],
        io,
      );
    }
    const projectId = typeof flags.project === 'string' ? flags.project : undefined;
    if (!targetId || !projectId) {
      throw new Error('reward collect retire requires --project <project-id> and <target-id>');
    }
    printJson(retireCollectTarget(targetId), io);
    return true;
  }
  throw new Error(`unknown reward collect command: ${args.join(' ') || '(none)'}`);
}

async function handleHypothesis(
  args: string[],
  flags: Record<string, string | boolean>,
  io: CliIo,
): Promise<boolean> {
  const action = args[0] ?? 'list';
  if (flags.help === true && (action === 'record' || action === 'resolve')) {
    return printCommandHelp(
      action === 'record'
        ? [
            'Usage: superdense hypothesis record --input <json|@file>',
            '',
            'Input: {"projectId":"<project-id>","leverKey":"<lever>","statement":{"action":"...","diagnostic":{"metric":"reply_rate","direction":"increase","magnitude":0.05},"northStar":{"metric":"qualified_calls","direction":"increase","magnitude":3},"window":{"durationMs":604800000,"label":"7 days"},"mechanism":"..."}}',
          ]
        : [
            'Usage: superdense hypothesis resolve <id> --input <json|@file>',
            '',
            'Input: {"status":"supported|refuted|inconclusive|open","verdictEvidence":{"experimentId":"<id>","reason":"..."}}',
          ],
      io,
    );
  }
  if (action === 'record') {
    printJson(recordHypothesis(await readJsonObject(flags.input, 'input')), io);
    return true;
  }
  if (action === 'list') {
    if (typeof flags.project !== 'string' || !flags.project.trim()) {
      throw new Error('hypothesis list requires --project <project-id>');
    }
    const items = listHypotheses({
      projectId: flags.project,
      status: typeof flags.status === 'string' ? (flags.status as HypothesisStatus) : undefined,
      leverKey: typeof flags.lever === 'string' ? flags.lever : undefined,
      limit: intFlag(flags, 'limit', 100, 1000),
    });
    printJson({ items: wantsFull(flags) ? items : items.map(compactHypothesis) }, io);
    return true;
  }
  if (action === 'show') {
    const id = args[1];
    if (!id) throw new Error('hypothesis show requires <id>');
    const hypothesis = getHypothesis(id);
    if (!hypothesis) throw new Error(`hypothesis not found: ${id}`);
    printJson({ hypothesis: wantsFull(flags) ? hypothesis : compactHypothesis(hypothesis) }, io);
    return true;
  }
  if (action === 'resolve') {
    const id = args[1];
    if (!id) throw new Error('hypothesis resolve requires <id>');
    printJson(resolveHypothesis(id, await readJsonObject(flags.input, 'input')), io);
    return true;
  }
  throw new Error(`unknown hypothesis command: ${args.join(' ') || '(none)'}`);
}

async function handleExperiment(
  args: string[],
  flags: Record<string, string | boolean>,
  io: CliIo,
): Promise<boolean> {
  const action = args[0] ?? 'list';
  if (flags.help === true && (action === 'open' || action === 'add-member')) {
    return printCommandHelp(
      action === 'open'
        ? [
            'Usage: superdense experiment open --input <json|@file>',
            '',
            'Input: {"hypothesisId":"<id>","targetReps":2,"rewardWindow":{"startAt":1700000000000,"endAt":1700604800000,"label":"7 days"},"predictedSummary":"<optional>"}',
          ]
        : [
            'Usage: superdense experiment add-member --input <json|@file>',
            '',
            'Input: {"experimentId":"<id>","runId":"2026-06-19-topic","artifactId":"<optional-artifact-id>","role":"rep"}',
          ],
      io,
    );
  }
  if (action === 'open') {
    printJson(openExperiment(await readJsonObject(flags.input, 'input')), io);
    return true;
  }
  if (action === 'add-member') {
    printJson(addExperimentMember(await readJsonObject(flags.input, 'input')), io);
    return true;
  }
  if (action === 'verdict') {
    const id = args[1];
    if (!id) throw new Error('experiment verdict requires <id>');
    const now = typeof flags.now === 'string' ? Number(flags.now) : undefined;
    if (now != null && (!Number.isSafeInteger(now) || now < 0)) {
      throw new Error('--now must be a non-negative integer epoch millisecond timestamp');
    }
    const result = renderExperimentVerdict(id, now == null ? {} : { now });
    printJson(wantsFull(flags) ? result : compactExperimentVerdict(result), io);
    return true;
  }
  if (action === 'list') {
    const projectId = typeof flags.project === 'string' ? flags.project : undefined;
    const hypothesisId = typeof flags.hypothesis === 'string' ? flags.hypothesis : undefined;
    if (!projectId && !hypothesisId) {
      throw new Error('experiment list requires --project <project-id> or --hypothesis <id>');
    }
    const items = listExperiments({
      projectId,
      hypothesisId,
      status: typeof flags.status === 'string' ? (flags.status as ExperimentStatus) : undefined,
      limit: intFlag(flags, 'limit', 100, 1000),
    });
    printJson({ items: wantsFull(flags) ? items : items.map(compactExperiment) }, io);
    return true;
  }
  if (action === 'show') {
    const id = args[1];
    if (!id) throw new Error('experiment show requires <id>');
    const experiment = getExperiment(id);
    if (!experiment) throw new Error(`experiment not found: ${id}`);
    printJson({ experiment: wantsFull(flags) ? experiment : compactExperiment(experiment) }, io);
    return true;
  }
  throw new Error(`unknown experiment command: ${args.join(' ') || '(none)'}`);
}

function handleCohort(args: string[], flags: Record<string, string | boolean>, io: CliIo): boolean {
  const action = args[0];
  const projectId = typeof flags.project === 'string' ? flags.project : undefined;
  if (action === 'list') {
    const by = typeof flags.by === 'string' ? flags.by : 'type';
    if (by !== 'type' && by !== 'connector') {
      throw new Error("cohort list --by must be 'type' or 'connector'");
    }
    printJson({ items: listCohorts({ projectId, by }) }, io);
    return true;
  }
  if (action === 'show') {
    const type = args[1];
    if (!type) throw new Error('cohort show requires <type>');
    const connector = typeof flags.connector === 'string' ? flags.connector : undefined;
    const cohort = getCohort({ type, connector, projectId });
    printJson({ cohort: wantsFull(flags) ? cohort : compactCohort(cohort) }, io);
    return true;
  }
  if (action === 'chains') {
    printJson({ items: listVersionChains({ projectId }) }, io);
    return true;
  }
  if (action === 'chain') {
    const id = args[1];
    if (!id) throw new Error('cohort chain requires <artifact-id>');
    const chain = getVersionChain(id);
    if (!chain) throw new Error(`artifact not found: ${id}`);
    printJson({ chain: wantsFull(flags) ? chain : compactVersionChain(chain) }, io);
    return true;
  }
  throw new Error(`unknown cohort command: ${args.join(' ') || '(none)'}`);
}

function handleInsight(args: string[], io: CliIo): boolean {
  const action = args[0] ?? 'list';
  if (action === 'list') {
    printJson({ items: listInsightRecipes() }, io);
    return true;
  }
  if (action === 'prompt') {
    const name = args[1];
    if (!name) throw new Error('insight prompt requires <name>');
    const runId = randomUUID();
    const body = assembleInsightPrompt(name, runId);
    io.stdout.log(body);
    return true;
  }
  throw new Error(`unknown insight command: ${action}`);
}

async function handleFilter(args: string[], io: CliIo): Promise<boolean> {
  const action = args[0] ?? 'list';
  if (action === 'list') {
    printJson({ items: await listFilterCatalog() }, io);
    return true;
  }
  if (action === 'show') {
    const name = args[1];
    if (!name) throw new Error('filter show requires <name>');
    const item = (await listFilterCatalog()).find((x) => x.name === name);
    if (!item) throw new Error(`filter not found: ${name}`);
    printJson(item, io);
    return true;
  }
  throw new Error(`unknown filter command: ${action}`);
}

function bundledSkillsRoot(): string {
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const skillsRoot = [join(moduleDir, 'skills'), join(moduleDir, '..', '..', '..', 'skills')].find(
    (candidate) => existsSync(candidate),
  );
  if (!skillsRoot) throw new Error(`skills directory not found: ${join(moduleDir, 'skills')}`);
  return skillsRoot;
}

function readSkillVersion(skillDir: string): string | null {
  const skillPath = join(skillDir, 'SKILL.md');
  if (!existsSync(skillPath)) return null;
  const raw = readFileSync(skillPath, 'utf8');
  const frontmatter = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!frontmatter) return null;
  const version = frontmatter[1].match(/^version:\s*["']?([^"'\s]+)["']?\s*$/m);
  return version?.[1] ?? null;
}

function readInstalledMarker(dest: string): SkillInstallMarker | null {
  const markerPath = join(dest, '.superdense-install.json');
  if (!existsSync(markerPath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(markerPath, 'utf8')) as Partial<SkillInstallMarker>;
    if (
      typeof parsed.version === 'string' &&
      typeof parsed.installedAt === 'string' &&
      (parsed.scope === 'global' || parsed.scope === 'local')
    ) {
      return parsed as SkillInstallMarker;
    }
  } catch {
    return null;
  }
  return null;
}

function compareVersions(a: string, b: string): number {
  const left = a.split('.').map((part) => Number.parseInt(part, 10));
  const right = b.split('.').map((part) => Number.parseInt(part, 10));
  const len = Math.max(left.length, right.length);
  for (let i = 0; i < len; i++) {
    const l = Number.isFinite(left[i]) ? left[i]! : 0;
    const r = Number.isFinite(right[i]) ? right[i]! : 0;
    if (l !== r) return l > r ? 1 : -1;
  }
  return 0;
}

function skillInstallTarget(scope: SkillScope, cwd: string): SkillInstallTarget {
  if (scope === 'local') {
    return { scope, claudeRoot: localClaudeSkillsDir(cwd), codexRoot: localCodexSkillsDir(cwd) };
  }
  return {
    scope,
    claudeRoot: process.env.CLAUDE_SKILLS_DIR ?? CLAUDE_SKILLS_DIR,
    codexRoot: process.env.CODEX_SKILLS_DIR ?? CODEX_SKILLS_DIR,
  };
}

function writeInstallMarker(dest: string, version: string, scope: SkillScope): void {
  const marker: SkillInstallMarker = {
    version,
    installedAt: new Date().toISOString(),
    scope,
  };
  writeFileSync(join(dest, '.superdense-install.json'), `${JSON.stringify(marker, null, 2)}\n`);
}

function classifySkillInstall(
  dest: string,
  sourceVersion: string,
): { status: SkillInstallStatus; version: string | null } {
  if (!existsSync(dest)) return { status: 'missing', version: null };
  const marker = readInstalledMarker(dest);
  if (!marker) return { status: 'outdated', version: readSkillVersion(dest) };
  return compareVersions(marker.version, sourceVersion) >= 0
    ? { status: 'current', version: marker.version }
    : { status: 'outdated', version: marker.version };
}

function materializeSharedReferences(skillsRoot: string, name: string, dest: string): void {
  const files = SHARED_SKILL_REFERENCES[name];
  if (!files) return;
  const refDir = join(dest, 'references');
  mkdirSync(refDir, { recursive: true });
  for (const file of files) {
    cpSync(join(skillsRoot, SHARED_SKILLS_DIR, file), join(refDir, file));
  }
}

function installSkills(
  names: string[],
  opts: { scope: SkillScope; cwd: string },
): Array<{ name: string; claude: string; codex: string }> {
  const skillsRoot = bundledSkillsRoot();
  const targetNames = names.length
    ? names
    : readdirSync(skillsRoot).filter(
        (entry) => entry !== SHARED_SKILLS_DIR && statSync(join(skillsRoot, entry)).isDirectory(),
      );

  const target = skillInstallTarget(opts.scope, opts.cwd);
  const installed: Array<{ name: string; claude: string; codex: string }> = [];

  for (const name of targetNames) {
    const src = join(skillsRoot, name);
    if (!existsSync(src) || !statSync(src).isDirectory()) {
      throw new Error(`skill not found: ${name}`);
    }
    const version = readSkillVersion(src);
    if (!version) throw new Error(`skill version not found: ${name}`);

    const claudeDest = join(target.claudeRoot, name);
    mkdirSync(claudeDest, { recursive: true });
    cpSync(src, claudeDest, { recursive: true });
    rmSync(join(claudeDest, 'SKILL.codex.md'), { force: true });
    materializeSharedReferences(skillsRoot, name, claudeDest);
    writeInstallMarker(claudeDest, version, target.scope);

    const codexDest = join(target.codexRoot, name);
    mkdirSync(codexDest, { recursive: true });
    cpSync(src, codexDest, { recursive: true });
    const codexSkillPath = join(codexDest, 'SKILL.codex.md');
    if (existsSync(codexSkillPath)) {
      cpSync(codexSkillPath, join(codexDest, 'SKILL.md'));
      rmSync(codexSkillPath, { force: true });
    }
    materializeSharedReferences(skillsRoot, name, codexDest);
    writeInstallMarker(codexDest, version, target.scope);

    installed.push({ name, claude: claudeDest, codex: codexDest });
  }

  return installed;
}

function handleSkillInstall(
  args: string[],
  flags: Record<string, string | boolean>,
  io: CliIo,
): void {
  const installed = installSkills(args, {
    scope: flags.locally === true ? 'local' : 'global',
    cwd: process.cwd(),
  });
  printJson({ installed }, io);
}

function studioSkillSummary(
  name: string,
  cwd: string,
): {
  sourceVersion: string;
  global: {
    claude: ReturnType<typeof classifySkillInstall>;
    codex: ReturnType<typeof classifySkillInstall>;
  };
  local: {
    claude: ReturnType<typeof classifySkillInstall>;
    codex: ReturnType<typeof classifySkillInstall>;
  };
} {
  const src = join(bundledSkillsRoot(), name);
  const sourceVersion = readSkillVersion(src);
  if (!sourceVersion) throw new Error(`skill version not found: ${name}`);
  const globalTarget = skillInstallTarget('global', cwd);
  const localTarget = skillInstallTarget('local', cwd);
  return {
    sourceVersion,
    global: {
      claude: classifySkillInstall(join(globalTarget.claudeRoot, name), sourceVersion),
      codex: classifySkillInstall(join(globalTarget.codexRoot, name), sourceVersion),
    },
    local: {
      claude: classifySkillInstall(join(localTarget.claudeRoot, name), sourceVersion),
      codex: classifySkillInstall(join(localTarget.codexRoot, name), sourceVersion),
    },
  };
}

function scopeStatus(
  summary: ReturnType<typeof studioSkillSummary>,
  scope: SkillScope,
): { status: SkillInstallStatus; version: string | null } {
  const entry = summary[scope];
  if (entry.claude.status === 'current' && entry.codex.status === 'current') {
    return { status: 'current', version: entry.claude.version ?? entry.codex.version };
  }
  if (entry.claude.status === 'outdated' || entry.codex.status === 'outdated') {
    return { status: 'outdated', version: entry.claude.version ?? entry.codex.version };
  }
  return { status: 'missing', version: null };
}

function chooseStudioSkillAction(summary: ReturnType<typeof studioSkillSummary>): {
  scope: SkillScope;
  status: Exclude<SkillInstallStatus, 'current'>;
  version: string | null;
} | null {
  const local = scopeStatus(summary, 'local');
  const global = scopeStatus(summary, 'global');
  if (local.status === 'current') return null;
  if (local.status === 'outdated')
    return { scope: 'local', status: 'outdated', version: local.version };
  if (global.status === 'current') return null;
  if (global.status === 'outdated')
    return { scope: 'global', status: 'outdated', version: global.version };
  return { scope: 'global', status: 'missing', version: null };
}

function chooseRequiredStudioSkillAction(
  names: string[],
  cwd: string,
): {
  scope: SkillScope;
  status: Exclude<SkillInstallStatus, 'current'>;
  names: string[];
} | null {
  const actions = names.flatMap((name) => {
    const action = chooseStudioSkillAction(studioSkillSummary(name, cwd));
    return action ? [{ name, ...action }] : [];
  });
  if (actions.length === 0) return null;

  const scope: SkillScope = actions.some((action) => action.scope === 'local') ? 'local' : 'global';
  return {
    scope,
    status: actions.some((action) => action.status === 'outdated') ? 'outdated' : 'missing',
    names: actions.map((action) => action.name),
  };
}

async function confirm(prompt: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(prompt);
    return answer.trim() === '' || answer.trim().toLowerCase().startsWith('y');
  } finally {
    rl.close();
  }
}

function cliPackageVersion(): string {
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const packageJsonPath = [
    join(moduleDir, '..', 'package.json'),
    join(moduleDir, 'package.json'),
  ].find((candidate) => existsSync(candidate));
  if (!packageJsonPath) throw new Error('CLI package.json not found');

  const parsed = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as CliPackageJson;
  if (parsed.name !== CLI_PACKAGE_NAME)
    throw new Error(`unexpected CLI package name: ${parsed.name ?? '(missing)'}`);
  if (typeof parsed.version !== 'string' || !semver.valid(parsed.version)) {
    throw new Error(`invalid CLI package version: ${parsed.version ?? '(missing)'}`);
  }
  return parsed.version;
}

async function fetchLatestCliVersion(): Promise<string> {
  const response = await fetch(NPM_REGISTRY_PACKAGE_URL, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(2500),
  });
  if (!response.ok) throw new Error(`npm registry returned ${response.status}`);

  const body = (await response.json()) as { 'dist-tags'?: { latest?: unknown } };
  const latest = body['dist-tags']?.latest;
  if (typeof latest !== 'string' || !semver.valid(latest)) {
    throw new Error('npm registry response did not include a valid latest version');
  }
  return latest;
}

function spawnAndWait(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', env });
    child.once('error', reject);
    child.once('close', (code) => resolve(code ?? 1));
  });
}

async function checkNpmUpdateForStudio(
  argv: string[],
  io: CliIo,
): Promise<{ restarted: boolean; exitCode: number }> {
  let current: string;
  let latest: string;
  try {
    current = cliPackageVersion();
    latest = await fetchLatestCliVersion();
  } catch (err) {
    io.stderr.error(
      `[superdense] update check skipped: ${err instanceof Error ? err.message : String(err)}`,
    );
    return { restarted: false, exitCode: 0 };
  }

  if (!semver.gt(latest, current)) return { restarted: false, exitCode: 0 };

  const installCommand = `npm install -g ${CLI_PACKAGE_NAME}@latest`;
  if (!io.isTty || !process.stdin.isTTY) {
    io.stdout.log(
      `[superdense] update available: ${current} -> ${latest}. Run \`${installCommand}\` to update.`,
    );
    return { restarted: false, exitCode: 0 };
  }

  if (!(await confirm(`Update Superdense ${current} -> ${latest} with npm? [Y/n] `))) {
    return { restarted: false, exitCode: 0 };
  }

  io.stdout.log(`[superdense] updating with \`${installCommand}\`...`);
  try {
    const updateCode = await spawnAndWait('npm', ['install', '-g', `${CLI_PACKAGE_NAME}@latest`]);
    if (updateCode !== 0) {
      io.stderr.error(
        `[superdense] npm update failed with exit code ${updateCode}; continuing with ${current}.`,
      );
      return { restarted: false, exitCode: 0 };
    }
  } catch (err) {
    io.stderr.error(
      `[superdense] npm update failed: ${err instanceof Error ? err.message : String(err)}; continuing with ${current}.`,
    );
    return { restarted: false, exitCode: 0 };
  }

  io.stdout.log('[superdense] update installed; restarting studio...');
  const restartEnv = { ...process.env, [SKIP_UPDATE_CHECK_ENV]: '1' };
  const exitCode = await spawnAndWait('superdense', argv, restartEnv);
  return { restarted: true, exitCode };
}

async function checkSkillsForStudio(io: CliIo, opts: { cwd: string }): Promise<void> {
  const action = chooseRequiredStudioSkillAction(REQUIRED_STUDIO_SKILLS, opts.cwd);
  if (!action) return;

  const scopeLabel = action.scope === 'global' ? 'globally' : 'locally';
  if (!io.isTty || !process.stdin.isTTY) {
    const detail =
      action.status === 'outdated' ? 'required skills outdated' : 'required skills missing';
    const command =
      action.scope === 'local' ? 'superdense skill install --locally' : 'superdense skill install';
    io.stdout.log(`[superdense] hint: ${detail}. Run \`${command}\` to update.`);
    return;
  }

  const prompt =
    action.status === 'outdated'
      ? `Update Superdense skills ${scopeLabel}? [Y/n] `
      : `Install Superdense skills ${scopeLabel}? [Y/n] `;
  if (await confirm(prompt)) {
    installSkills(action.names, { scope: action.scope, cwd: opts.cwd });
    io.stdout.log(
      `[superdense] ${action.status === 'outdated' ? 'updated' : 'installed'} Superdense skills ${scopeLabel}.`,
    );
  }
}

export async function runCli(
  argv: string[],
  io: CliIo = {
    stdout: console,
    stderr: console,
    isTty: process.stdout.isTTY,
  },
): Promise<number> {
  ensureSuperdenseDirs();
  const { cmd, args, flags } = parseArgs(argv);

  if (cmd === 'skill') {
    const action = args[0];
    if (action !== 'install') throw new Error(`unknown skill command: ${action ?? '(none)'}`);
    handleSkillInstall(args.slice(1), flags, io);
    return 0;
  }

  if (cmd === 'query') {
    await handleQuery(args, flags, io);
    return 0;
  }

  if (cmd === 'saved-query') {
    await handleSavedQuery(args, flags, io);
    return 0;
  }

  if (cmd === 'session') {
    await handleSession(args, flags, io);
    return 0;
  }

  if (cmd === 'compactor') {
    await handleCompactor(args, flags, io);
    return 0;
  }

  if (cmd === 'enricher') {
    await handleEnricher(args, io);
    return 0;
  }

  if (cmd === 'filter') {
    await handleFilter(args, io);
    return 0;
  }

  if (cmd === 'project') {
    await handleProject(args, flags, io);
    return 0;
  }

  if (cmd === 'artifact') {
    await handleArtifact(args, flags, io);
    return 0;
  }

  if (cmd === 'curation') {
    await handleCuration(args, flags, io);
    return 0;
  }

  if (cmd === 'thread') {
    handleThread(args, flags, io);
    return 0;
  }

  if (cmd === 'externalization') {
    await handleExternalization(args, flags, io);
    return 0;
  }

  if (cmd === 'reward') {
    await handleReward(args, flags, io);
    return 0;
  }

  if (cmd === 'hypothesis') {
    await handleHypothesis(args, flags, io);
    return 0;
  }

  if (cmd === 'experiment') {
    await handleExperiment(args, flags, io);
    return 0;
  }

  if (cmd === 'db') {
    const action = args[0];
    if (action !== 'repair') throw new Error(`unknown db command: ${action ?? '(none)'}`);
    printJson(repairDatabase(), io);
    return 0;
  }

  if (cmd === 'cohort') {
    handleCohort(args, flags, io);
    return 0;
  }

  if (cmd === 'insight') {
    handleInsight(args, io);
    return 0;
  }

  if (cmd === 'index') {
    io.stdout.log('[superdense] running incremental index...');
    await indexAll({ full: !!flags.full });
    io.stdout.log('[superdense] done.');
    return 0;
  }

  if (cmd === 'reindex') {
    io.stdout.log('[superdense] running full reindex...');
    await indexAll({ full: true });
    io.stdout.log('[superdense] done.');
    return 0;
  }

  if (cmd === 'discover') {
    const r = await runDiscovery();
    io.stdout.log(`[superdense] discovered ${r.discovered} sessions.`);
    return 0;
  }

  if (cmd === 'help') {
    io.stdout.log(
      [
        'Usage: superdense <command> [options]',
        '',
        'Commands:',
        '  start|studio        Start the Superdense web UI',
        '  session list        List indexed sessions (root sessions only by default)',
        '      --include-subagents  Include sub-agent sessions in listing',
        '  session show <id>   Show session metadata (includes hasSubagents, subagentIds)',
        '  session cost <id>   Show estimated API-equivalent cost (--tree, --depth N)',
        '  session children <id>  List direct sub-agent children of a session',
        '      --full          Include full session metadata for each child',
        '  session tree <id>   Show recursive sub-agent tree (--depth N, default 1)',
        '  session path <id>   Get raw log file path',
        '  session fields      List filters and enrichers',
        '  session enrichments <id>  Get computed enrichments [--name <n>] [--full]',
        '  filter list         List available filters',
        '  filter show <n>     Show filter params and examples',
        '  query --query <json|@file>  Run an unsaved ad hoc query',
        '  saved-query list          List saved queries',
        '  saved-query show <id>     Show saved query with matching sessions',
        '  saved-query save          Save a query without running it',
        '  saved-query run <id>      Evaluate a saved query and return results',
        '  saved-query delete <id>   Delete a saved query',
        '  compactor list      List available compactors',
        '  compactor show <n>  Show compactor details',
        '  compactor run <n> <id>  Run a compactor on a session',
        '  enricher list       List available enrichers',
        '  enricher show <n>   Show enricher details',
        '  insight list        List available insight recipes',
        '  insight prompt <n>  Print a copy-pasteable insight prompt for your coding agent',
        '  project list        List detected projects',
        '      --needs-action  Show unprofiled and human-attention projects only',
        '  project show <id>   Show a canonical project profile',
        '  project context <id>  Gather bounded evidence for profiling',
        '  project apply <id>  Apply an atomic profile merge patch (--patch <json|@file>)',
        '  project attention <id>  Mark attention --needed [--reasons <json>] or --resolved',
        '  artifact mark-current  Mark the current agent session for curation',
        '  artifact mark --session <adapter:id>  Mark an explicit session for curation',
        '  artifact inbox     List ready threads awaiting artifact creation [--limit N] [--full]',
        '  curation inbox      Get a bounded root-session review batch [--project <id>] [--limit N]',
        '  curation context <root-session-id>  Load root and linked sub-agent review hints',
        '  curation apply --input <json|@file>  Apply an atomic batch of reversible actions',
        '  thread list         List mutable work threads [--project <id>] [--full]',
        '  thread show <id>    Show a compact work thread summary [--full]',
        '  artifact finalize --input <json|@file>  Create a stable artifact payload from a ready thread',
        '  artifact list       List finalized artifacts [--project <id>] [--type <t>] [--full]',
        '  artifact show <thread-id>  Show compact stable artifact payload and lineage [--full]',
        '  externalization inbox  List unprocessed and blocked finalized artifacts [--limit N] [--cursor <opaque>] [--full]',
        '  externalization list   List artifact externalization states [--status <s>] [--full]',
        '  externalization show <artifact-id>  Show compact assessment and connector targets [--full]',
        '  externalization assess --input <json|@file>  Replace one artifact assessment',
        '  reward record --input <json|@file>  Record one multidimensional reward snapshot for a linked target',
        '  reward record-batch --input <json|@file>  Atomically record up to 100 reward snapshots',
        '  reward show <artifact-id>  Show compact latest rewards per linked target [--full]',
        '  reward status       Show reward-layer punch-list and next action [--project <id>]',
        '  reward docs artifacts  Fetch live reward artifact guidance markdown',
        '  reward docs connectors --artifact <type>  Fetch live connector guidance for an artifact type',
        '  reward docs connectors --connector <name> [--section usage|install|troubleshoot]',
        '  hypothesis record --input <json|@file>  Record a structured falsifiable outcome hypothesis',
        '  hypothesis list --project <id>  List hypotheses [--status <s>] [--lever <k>] [--full]',
        '  hypothesis show <id>  Show a hypothesis [--full]',
        '  hypothesis resolve <id> --input <json|@file>  Resolve a hypothesis verdict',
        '  experiment open --input <json|@file>  Open an experiment for a hypothesis',
        '  experiment add-member --input <json|@file>  Attach a run/artifact as an experiment rep',
        '  experiment verdict <id>  Fold member reward snapshots into a verdict [--now <ms>] [--full]',
        '  experiment list     List experiments (--project <id> or --hypothesis <id>) [--status <s>] [--full]',
        '  experiment show <id>  Show an experiment [--full]',
        '  db repair           Explicitly reconcile an interrupted development schema migration',
        '  cohort list         List comparable peer cohorts [--project <id>] [--by type|connector]',
        '  cohort show <type>  Surface a compact cohort for comparison [--connector <c>] [--project <id>] [--full]',
        '  cohort chains       List version chains (a deliverable across versions) [--project <id>]',
        '  cohort chain <artifact-id>  Surface compact artifact versions [--full]',
        '  skill install [n]   Install skills into Claude and Codex',
        '      --locally       Install skills into ./.claude and ./.codex for this cwd',
        '  index               Incremental session index',
        '  reindex             Full session reindex',
        '  discover            Discover sessions from adapters',
        '',
        'Studio options:',
        '  --no-update-check   Skip the startup npm version check',
        '  --no-skill-check    Skip the startup skill freshness check',
      ].join('\n'),
    );
    return 0;
  }

  if (cmd !== 'studio' && cmd !== 'start') {
    throw new Error(`unknown command: ${cmd}`);
  }

  const explicitPort = flags.port != null;
  const port = explicitPort ? parseInt(String(flags.port), 10) : 4242;

  if (!flags['no-update-check'] && process.env[SKIP_UPDATE_CHECK_ENV] !== '1') {
    const update = await checkNpmUpdateForStudio(argv, io);
    if (update.restarted) return update.exitCode;
  }

  if (!flags['no-skill-check']) {
    await checkSkillsForStudio(io, { cwd: process.cwd() });
  }

  // Run discovery synchronously so the UI immediately shows sessions.
  io.stdout.log('[superdense] discovering sessions...');
  const d = await runDiscovery();
  io.stdout.log(`[superdense] discovered ${d.discovered} sessions.`);

  const { url } = await startServer({
    port,
    host: '127.0.0.1',
    ...(explicitPort ? {} : { portFallbackAttempts: 50 }),
  });
  io.stdout.log(`[superdense] ${url}`);

  // Background: run query evaluation if any queries exist.
  runQueryEvaluation().catch((e) => io.stderr.error('[superdense] query eval failed:', e));

  if (!flags['no-open']) {
    open(url).catch(() => {
      /* ignore */
    });
  }

  return 0;
}

async function main(): Promise<void> {
  try {
    process.exitCode = await runCli(process.argv.slice(2));
  } catch (err) {
    printErrorJson(err, { stdout: console, stderr: console, isTty: process.stderr.isTTY });
    process.exitCode = 1;
  }
}

function isMainModule(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  const here = fileURLToPath(import.meta.url);
  if (entry === here) return true;
  try {
    return realpathSync(entry) === here;
  } catch {
    return false;
  }
}

if (isMainModule()) {
  main();
}

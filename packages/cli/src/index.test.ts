import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const spawnMock = vi.hoisted(() => vi.fn());
const readlineMocks = vi.hoisted(() => ({
  createInterface: vi.fn(),
  question: vi.fn(),
  close: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  spawn: spawnMock,
}));

vi.mock('node:readline/promises', () => ({
  createInterface: readlineMocks.createInterface,
}));

vi.mock('@nimrobo/superdense-server', () => ({
  startServer: vi.fn(),
}));

vi.mock('open', () => ({
  default: vi.fn(),
}));

vi.mock('@nimrobo/superdense-core', () => ({
  CLAUDE_SKILLS_DIR: '/unused/claude/skills',
  CODEX_SKILLS_DIR: '/unused/codex/skills',
  SYSTEM_RUN_ID: 'system',
  applyCurationBatch: vi.fn(),
  assessExternalization: vi.fn(),
  applyProjectProfilePatch: vi.fn(),
  backfillQuery: vi.fn(),
  compactSession: vi.fn(),
  countQueryMatches: vi.fn(),
  countSessions: vi.fn(),
  createQuery: vi.fn(),
  deleteQuery: vi.fn(),
  ensureSuperdenseDirs: vi.fn(),
  finalizeArtifact: vi.fn(),
  getArtifact: vi.fn(),
  getArtifactRewards: vi.fn(),
  getCohort: vi.fn(),
  getCompactor: vi.fn(),
  getCurationContext: vi.fn(),
  getEnrichment: vi.fn(),
  getExternalization: vi.fn(),
  getProjectContext: vi.fn(),
  getProjectProfileResolution: vi.fn(),
  getQuery: vi.fn(),
  getRewardStatus: vi.fn(),
  getVersionChain: vi.fn(),
  getSession: vi.fn(),
  getSessionChildren: vi.fn(),
  getSessionCost: vi.fn(),
  getSessionTree: vi.fn(),
  getWorkThread: vi.fn(),
  indexAll: vi.fn(),
  listCompactors: vi.fn(),
  listCohorts: vi.fn(),
  listArtifactInbox: vi.fn(),
  listArtifacts: vi.fn(),
  listCurationInbox: vi.fn(),
  listEnrichers: vi.fn(),
  listExternalizationInbox: vi.fn(),
  listExternalizations: vi.fn(),
  listFilterCatalog: vi.fn(),
  listFilters: vi.fn(),
  listQueries: vi.fn(),
  listProjectProfiles: vi.fn(),
  listQueryMatchDetails: vi.fn(),
  listQueryMatches: vi.fn(),
  listSessionEnrichments: vi.fn(),
  listSessions: vi.fn(),
  listVersionChains: vi.fn(),
  listWorkThreads: vi.fn(),
  loadUserEnrichers: vi.fn(),
  markSessionForCuration: vi.fn(),
  recordRewardSnapshot: vi.fn(),
  localClaudeSkillsDir: (cwd: string) => join(cwd, '.claude', 'skills'),
  localCodexSkillsDir: (cwd: string) => join(cwd, '.codex', 'skills'),
  previewQuery: vi.fn(),
  runAdHocQuery: vi.fn(),
  runDiscovery: vi.fn(),
  runQueryEvaluation: vi.fn(),
  runSavedQuery: vi.fn(),
  setProjectAttention: vi.fn(),
  validateQueryDefinition: vi.fn(),
}));

import * as core from '@nimrobo/superdense-core';
import { startServer } from '@nimrobo/superdense-server';
import open from 'open';
import { runCli } from './index.js';

const cliPackageJson = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
) as {
  version: string;
};
const currentCliVersion = cliPackageJson.version;
const currentSkillVersion = (() => {
  const skill = readFileSync(
    new URL('../../../skills/superdense/SKILL.md', import.meta.url),
    'utf8',
  );
  const match = /^version:\s*(\S+)/m.exec(skill);
  if (!match) throw new Error('could not read bundled superdense skill version');
  return match[1]!;
})();
const newerCliVersion = (() => {
  const parts = currentCliVersion.split('.').map(Number);
  if (parts.length !== 3 || parts.some((part) => !Number.isInteger(part))) {
    throw new Error(`unsupported test package version: ${currentCliVersion}`);
  }
  return `${parts[0]}.${parts[1]}.${parts[2] + 1}`;
})();

const session = {
  id: 'codex:abc123',
  agent: 'codex',
  sessionId: 'abc123',
  logPath: '/tmp/superdense/abc123.jsonl',
  pwd: '/repo',
  projectKey: '/repo',
  summary: 'Fix tests',
  modifiedAt: 1779321000000,
};
const sessionTwo = {
  ...session,
  id: 'claude:def456',
  agent: 'claude',
  sessionId: 'def456',
  logPath: '/tmp/superdense/def456.jsonl',
  summary: 'Review code',
  modifiedAt: 1779322000000,
};
const project = {
  id: 'p1',
  projectKey: '/repo',
  status: 'profiled' as const,
  coveredBy: null,
  name: 'Repo',
  description: 'Software project',
  roots: ['/repo'],
  artifactShapes: [{ type: 'feature', detector: { kind: 'branch' as const } }],
  evidenceSummary: ['branch-shaped software work'],
  notes: null,
  needsHumanAttention: false,
  attentionReasons: [],
  firstSeenAt: 1,
  lastSeenAt: 2,
  profiledAt: 2,
  updatedAt: 2,
  coveredProjects: [],
};
const externalization: core.ArtifactExternalization = {
  artifactId: 't1',
  artifactType: 'launch',
  title: 'Launch',
  summary: null,
  artifactFinalizedAt: 1,
  status: 'blocked' as const,
  conclusion: 'external' as const,
  evidence: 'Published launch',
  updatedAt: 2,
  targets: [
    {
      id: 'target-1',
      artifactId: 't1',
      connector: 'x',
      status: 'needs_connector' as const,
      locator: '187123456789',
      evidence: 'X connector is not installed',
      createdAt: 2,
      updatedAt: 2,
    },
  ],
};
const artifact: core.WorkThread = {
  id: 't1',
  projectProfileId: 'p1',
  provisionalTitle: 'Launch',
  summary: 'A launch artifact with enough context to publish',
  status: 'ready',
  createdAt: 1,
  updatedAt: 3,
  artifactType: 'launch',
  payload: {
    text: 'x'.repeat(600),
    files: ['README.md', 'packages/cli/src/index.ts', 'packages/core/src/rewards/index.ts'],
    details: {
      audience: 'agents',
      notes: ['first', 'second', 'third', 'fourth', 'fifth', 'sixth'],
    },
  },
  artifactFinalizedAt: 3,
  readyAt: 2,
  readinessRationale: 'Ready for artifact creation',
  predecessorArtifactId: null,
  externalizationStatus: 'external' as const,
  externalizationEvidence: 'Published launch',
  externalizationUpdatedAt: 4,
  lifecycle: 'artifact' as const,
  headSessionId: 'codex:abc123',
  sessions: [
    { sessionId: 'codex:abc123', role: 'contributor' as const, rationale: 'created it' },
    { sessionId: 'claude:def456', role: 'evidence' as const, rationale: 'review evidence' },
  ],
  lineageEvents: [
    {
      id: 'e1',
      sessionId: 'codex:abc123',
      eventType: 'attach' as const,
      role: 'contributor' as const,
      rationale: 'created it',
      createdAt: 3,
    },
  ],
};
const rewards: core.ArtifactRewards = {
  artifactId: 't1',
  targets: [
    {
      targetId: 'target-1',
      connector: 'x',
      locator: '187123456789',
      latest: {
        id: 'reward-2',
        targetId: 'target-1',
        capturedAt: 5,
        metrics: { reach: 1000, reactions: 40 },
        primaryDim: 'reach',
        source: 'x-cli',
        evidence: 'e'.repeat(500),
        createdAt: 5,
      },
      snapshots: [
        {
          id: 'reward-2',
          targetId: 'target-1',
          capturedAt: 5,
          metrics: { reach: 1000, reactions: 40 },
          primaryDim: 'reach',
          source: 'x-cli',
          evidence: 'e'.repeat(500),
          createdAt: 5,
        },
        {
          id: 'reward-1',
          targetId: 'target-1',
          capturedAt: 4,
          metrics: { reach: 500 },
          primaryDim: 'reach',
          source: 'x-cli',
          evidence: 'initial',
          createdAt: 4,
        },
      ],
    },
  ],
};
const rewardStatus: core.RewardStatus = {
  projectId: 'p1',
  stages: [
    {
      key: 'profile',
      label: 'Profile',
      unit: 'projects',
      actionable: 0,
      skill: 'superdense/reward/profile.md',
    },
    {
      key: 'curate',
      label: 'Curate',
      unit: 'sessions',
      actionable: 1,
      skill: 'superdense/reward/curate.md',
    },
  ],
  nextAction: {
    stage: 'curate',
    skill: 'superdense/reward/curate.md',
    command: 'Read superdense/reward/curate.md for project p1',
    why: '1 sessions at Curate',
  },
};

const originalClaudeSkillsDir = process.env.CLAUDE_SKILLS_DIR;
const originalCodexSkillsDir = process.env.CODEX_SKILLS_DIR;
const originalSkipUpdateCheck = process.env.SUPERDENSE_SKIP_UPDATE_CHECK;
const originalDocsBaseUrl = process.env.SUPERDENSE_DOCS_BASE_URL;
const originalCwd = process.cwd();
const originalStdinIsTty = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
const tempRoots: string[] = [];

function io(opts: { isTty?: boolean } = {}) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    stdout,
    stderr,
    io: {
      stdout: { log: (value: string) => stdout.push(value) },
      stderr: { error: (value: string) => stderr.push(value) },
      isTty: opts.isTty ?? false,
    },
  };
}

function json(value: string) {
  return JSON.parse(value) as Record<string, unknown>;
}

function setStdinTty(value: boolean): void {
  Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value });
}

function mockSpawnExit(code = 0): void {
  spawnMock.mockImplementation(() => {
    const child = new EventEmitter();
    process.nextTick(() => child.emit('close', code));
    return child;
  });
}

function mockLatestVersion(version: string): void {
  vi.mocked(fetch).mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ 'dist-tags': { latest: version } }),
  } as Response);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', vi.fn());
  mockLatestVersion('0.1.0');
  mockSpawnExit(0);
  readlineMocks.createInterface.mockReturnValue({
    question: readlineMocks.question,
    close: readlineMocks.close,
  });
  readlineMocks.question.mockResolvedValue('');
  setStdinTty(false);
  delete process.env.CLAUDE_SKILLS_DIR;
  delete process.env.CODEX_SKILLS_DIR;
  delete process.env.SUPERDENSE_SKIP_UPDATE_CHECK;
  delete process.env.SUPERDENSE_DOCS_BASE_URL;
  vi.mocked(core.getSession).mockReturnValue(session);
  vi.mocked(core.getSessionCost).mockReturnValue({
    sessionId: 'codex:abc123',
    self: {
      v: 1,
      kind: 'api_equivalent_estimate',
      pricingCatalogVersion: '2026-06-05',
      pricingSources: [],
      pricingStatus: 'estimated',
      estimatedCostUsd: 0.012345,
      tokenTotals: {
        inputTokens: 1000,
        cachedInputTokens: 0,
        cacheCreationInputTokens: 0,
        cacheCreation5mInputTokens: 0,
        cacheCreation1hInputTokens: 0,
        outputTokens: 100,
        reasoningOutputTokens: 0,
        totalTokens: 1100,
      },
      modelBreakdown: [],
      unpricedModels: [],
      usageEventCount: 1,
    },
    directSubagents: [],
    totalWithSubagents: {
      estimatedCostUsd: 0.012345,
      pricingStatus: 'estimated',
      tokenTotals: {
        inputTokens: 1000,
        cachedInputTokens: 0,
        cacheCreationInputTokens: 0,
        cacheCreation5mInputTokens: 0,
        cacheCreation1hInputTokens: 0,
        outputTokens: 100,
        reasoningOutputTokens: 0,
        totalTokens: 1100,
      },
      unpricedModels: [],
      sessionCount: 1,
      pricedSessionCount: 1,
    },
  });
  vi.mocked(core.getSessionChildren).mockReturnValue([]);
  vi.mocked(core.getSessionTree).mockReturnValue({
    id: 'codex:abc123',
    relation: 'root',
    children: [],
  });
  vi.mocked(core.listSessions).mockReturnValue([sessionTwo, session]);
  vi.mocked(core.countSessions).mockReturnValue(2);
  vi.mocked(core.listSessionEnrichments).mockReturnValue([
    { name: 'has_errors', version: 1, computedAt: 2, value: true },
  ]);
  vi.mocked(core.getEnrichment).mockReturnValue({ version: 1, computedAt: 2, value: { Bash: 3 } });
  vi.mocked(core.listCompactors).mockReturnValue([
    { name: 'salience', kind: 'semantic', targetBytes: 4000, description: 'summary', run: vi.fn() },
  ]);
  vi.mocked(core.getCompactor).mockReturnValue({
    name: 'salience',
    kind: 'semantic',
    targetBytes: 4000,
    description: 'summary',
    run: vi.fn(),
  });
  vi.mocked(core.compactSession).mockResolvedValue({ v: 1, firstAsk: 'fix it' });
  vi.mocked(core.getQuery).mockReturnValue({
    id: 'q1',
    name: 'Interesting',
    filters: { filter: { name: 'session', params: { agent: 'codex' } } },
    enrichers: [],
    createdAt: 1,
    lastRunAt: null,
    memberCount: 1,
  });
  vi.mocked(core.backfillQuery).mockResolvedValue({
    matched: 1,
    items: [
      { sessionId: 'codex:abc123', evidence: 'matched', enrichments: { tool_counts: { Bash: 3 } } },
    ],
  });
  vi.mocked(core.runSavedQuery).mockResolvedValue({
    matched: 1,
    items: [
      { sessionId: 'codex:abc123', evidence: 'matched', enrichments: { tool_counts: { Bash: 3 } } },
    ],
  });
  vi.mocked(core.countQueryMatches).mockReturnValue(1);
  vi.mocked(core.listQueryMatchDetails).mockReturnValue([
    { session, addedAt: 3, evidence: 'matched' },
  ]);
  vi.mocked(core.listEnrichers).mockReturnValue([
    { name: 'tool_counts', version: 1, returns: 'json', description: 'tools', run: vi.fn() },
  ]);
  vi.mocked(core.listFilters).mockResolvedValue([
    { name: 'session', title: 'Session', paramsSchema: {}, run: vi.fn() },
  ]);
  vi.mocked(core.listFilterCatalog).mockResolvedValue([
    { name: 'session', title: 'Session', paramsSchema: {}, examples: [] },
  ]);
  vi.mocked(core.previewQuery).mockResolvedValue({
    items: [{ sessionId: 'codex:abc123', evidence: 'preview matched', enrichments: {} }],
    enrichers: [],
  });
  vi.mocked(core.runAdHocQuery).mockImplementation(async (_definition, opts = {}) => ({
    matched: 1,
    total: 1,
    limit: opts.limit ?? 500,
    offset: opts.offset ?? 0,
    items: [{ sessionId: 'codex:abc123', evidence: 'query matched', enrichments: {} }],
    enrichers: [],
  }));
  vi.mocked(core.runDiscovery).mockResolvedValue({ discovered: 2 });
  vi.mocked(core.runQueryEvaluation).mockResolvedValue({ evaluated: 0 });
  vi.mocked(core.listProjectProfiles).mockReturnValue([project]);
  vi.mocked(core.getProjectProfileResolution).mockReturnValue({ project, redirectedFrom: null });
  vi.mocked(core.getProjectContext).mockReturnValue({
    project,
    observed: {
      projectKeys: ['/repo'],
      paths: [{ pwd: '/repo', sessions: 2, lastSeenAt: 2 }],
      sessionCount: 2,
      firstIntents: [],
      touchedFiles: [],
      tools: [],
      clis: [],
    },
    siblingCandidates: [],
    fileCensus: {
      root: '/repo',
      filesScanned: 0,
      directoriesScanned: 0,
      extensions: [],
      sampleFiles: [],
      truncated: false,
      warnings: [],
    },
  });
  vi.mocked(core.applyProjectProfilePatch).mockReturnValue(project);
  vi.mocked(core.markSessionForCuration).mockImplementation((sessionId) => ({
    sessionId,
    buffered: false,
    markedAt: 1,
  }));
  vi.mocked(core.listCurationInbox).mockReturnValue({
    items: [],
    limit: 10,
    remaining: 0,
    counts: { pending: 0, consumed: 0, skipped: 0, deferred: 0 },
  });
  vi.mocked(core.getCurationContext).mockReturnValue({
    requestedSessionId: 'codex:abc123',
    rootSessionId: 'codex:abc123',
    tree: { id: 'codex:abc123', relation: 'root', children: [] },
    sessions: [],
  });
  vi.mocked(core.applyCurationBatch).mockReturnValue({
    ok: true,
    createdThreadIds: [],
    resolvedSessions: [],
  });
  vi.mocked(core.listWorkThreads).mockReturnValue([artifact]);
  vi.mocked(core.listArtifactInbox).mockReturnValue({ items: [artifact], limit: 10, remaining: 1 });
  vi.mocked(core.listArtifacts).mockReturnValue([artifact]);
  vi.mocked(core.getArtifact).mockReturnValue(artifact);
  vi.mocked(core.getWorkThread).mockReturnValue({
    id: 't1',
    projectProfileId: 'p1',
    provisionalTitle: 'Thread',
    summary: null,
    status: 'open',
    createdAt: 1,
    updatedAt: 1,
    artifactType: null,
    payload: null,
    artifactFinalizedAt: null,
    readyAt: null,
    readinessRationale: null,
    predecessorArtifactId: null,
    externalizationStatus: null,
    externalizationEvidence: null,
    externalizationUpdatedAt: null,
    lifecycle: 'open',
    headSessionId: null,
    sessions: [],
  });
  vi.mocked(core.listExternalizationInbox).mockReturnValue({
    items: [externalization],
    limit: 10,
    remaining: 1,
    counts: { unprocessed: 0, blocked: 1 },
    nextCursor: 'next-page',
  });
  vi.mocked(core.listExternalizations).mockReturnValue([externalization]);
  vi.mocked(core.getExternalization).mockReturnValue(externalization);
  vi.mocked(core.assessExternalization).mockReturnValue({
    ok: true,
    artifactId: 't1',
    externalization,
  });
  vi.mocked(core.getArtifactRewards).mockReturnValue(rewards);
  vi.mocked(core.recordRewardSnapshot).mockReturnValue({
    ok: true,
    snapshot: rewards.targets[0]!.latest!,
  });
  vi.mocked(core.listCohorts).mockReturnValue([
    {
      type: 'launch',
      connector: null,
      artifactCount: 1,
      externalizedCount: 1,
      withRewardsCount: 1,
    },
  ]);
  vi.mocked(core.getCohort).mockReturnValue({
    type: 'launch',
    connector: null,
    projectId: null,
    members: [
      {
        artifact,
        externalization,
        rewards,
        cost: {
          contributorSessionIds: ['codex:abc123'],
          contributors: [
            {
              sessionId: 'codex:abc123',
              totalCostingWithSubagents: {
                estimatedCostUsd: 0.012345,
                pricingStatus: 'estimated',
                tokenTotals: {
                  inputTokens: 1000,
                  cachedInputTokens: 0,
                  cacheCreationInputTokens: 0,
                  cacheCreation5mInputTokens: 0,
                  cacheCreation1hInputTokens: 0,
                  outputTokens: 100,
                  reasoningOutputTokens: 0,
                  totalTokens: 1100,
                },
                unpricedModels: [],
                sessionCount: 1,
                pricedSessionCount: 1,
              },
            },
          ],
          totalCostingWithSubagents: {
            estimatedCostUsd: 0.012345,
            pricingStatus: 'estimated',
            tokenTotals: {
              inputTokens: 1000,
              cachedInputTokens: 0,
              cacheCreationInputTokens: 0,
              cacheCreation5mInputTokens: 0,
              cacheCreation1hInputTokens: 0,
              outputTokens: 100,
              reasoningOutputTokens: 0,
              totalTokens: 1100,
            },
            unpricedModels: [],
            sessionCount: 1,
            pricedSessionCount: 1,
          },
        },
      },
    ],
  });
  vi.mocked(core.listVersionChains).mockReturnValue([{ rootId: 't1', type: 'launch', length: 1 }]);
  vi.mocked(core.getVersionChain).mockReturnValue({
    rootId: 't1',
    type: 'launch',
    members: [
      {
        artifact,
        externalization,
        rewards,
        cost: null,
      },
    ],
  });
  vi.mocked(core.getRewardStatus).mockReturnValue(rewardStatus);
  vi.mocked(core.setProjectAttention).mockReturnValue(project);
  vi.mocked(startServer).mockResolvedValue({ url: 'http://127.0.0.1:4242', close: vi.fn() });
  vi.mocked(open).mockResolvedValue({} as Awaited<ReturnType<typeof open>>);
});

afterEach(() => {
  vi.unstubAllGlobals();
  process.chdir(originalCwd);
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
  if (originalClaudeSkillsDir == null) delete process.env.CLAUDE_SKILLS_DIR;
  else process.env.CLAUDE_SKILLS_DIR = originalClaudeSkillsDir;
  if (originalCodexSkillsDir == null) delete process.env.CODEX_SKILLS_DIR;
  else process.env.CODEX_SKILLS_DIR = originalCodexSkillsDir;
  if (originalSkipUpdateCheck == null) delete process.env.SUPERDENSE_SKIP_UPDATE_CHECK;
  else process.env.SUPERDENSE_SKIP_UPDATE_CHECK = originalSkipUpdateCheck;
  if (originalDocsBaseUrl == null) delete process.env.SUPERDENSE_DOCS_BASE_URL;
  else process.env.SUPERDENSE_DOCS_BASE_URL = originalDocsBaseUrl;
  if (originalStdinIsTty) Object.defineProperty(process.stdin, 'isTTY', originalStdinIsTty);
  else delete (process.stdin as Partial<typeof process.stdin>).isTTY;
});

describe('superdense cli agent commands', () => {
  it('prints help with no args and keeps start compatibility for the web UI', async () => {
    const noArgs = io();
    const start = io();

    await runCli([], noArgs.io);
    await runCli(['start', '--no-open'], start.io);

    expect(core.runDiscovery).toHaveBeenCalledTimes(1);
    expect(startServer).toHaveBeenCalledTimes(1);
    expect(startServer).toHaveBeenCalledWith({
      port: 4242,
      host: '127.0.0.1',
      portFallbackAttempts: 50,
    });
    expect(noArgs.stdout[0]).toContain('Usage: superdense <command> [options]');
    expect(start.stdout).toContain('[superdense] http://127.0.0.1:4242');
    expect(noArgs.stdout[0]).toContain('reward status');
  });

  it('starts the studio command without opening the browser when requested', async () => {
    const out = io();

    await runCli(['studio', '--port', '5050', '--no-open'], out.io);

    expect(startServer).toHaveBeenCalledWith({ port: 5050, host: '127.0.0.1' });
    expect(open).not.toHaveBeenCalled();
    expect(out.stdout).toContain('[superdense] discovered 2 sessions.');
  });

  it('checks npm version on studio startup and does nothing when current', async () => {
    const out = io();

    await runCli(['studio', '--no-open', '--no-skill-check'], out.io);

    expect(fetch).toHaveBeenCalledWith(
      'https://registry.npmjs.org/@nimrobo%2fsuperdense',
      expect.objectContaining({
        headers: { accept: 'application/json' },
      }),
    );
    expect(spawnMock).not.toHaveBeenCalled();
    expect(out.stdout[0]).toBe('[superdense] discovering sessions...');
    expect(startServer).toHaveBeenCalled();
  });

  it('prints a non-tty npm update hint without mutating or blocking studio startup', async () => {
    mockLatestVersion(newerCliVersion);
    const out = io();

    await runCli(['studio', '--no-open', '--no-skill-check'], out.io);

    expect(spawnMock).not.toHaveBeenCalled();
    expect(out.stdout[0]).toBe(
      `[superdense] update available: ${currentCliVersion} -> ${newerCliVersion}. Run \`npm install -g @nimrobo/superdense@latest\` to update.`,
    );
    expect(out.stdout).toContain('[superdense] discovering sessions...');
    expect(startServer).toHaveBeenCalled();
  });

  it('updates global npm and restarts studio when a tty user confirms', async () => {
    mockLatestVersion(newerCliVersion);
    setStdinTty(true);
    readlineMocks.question.mockResolvedValue('y');
    const out = io({ isTty: true });

    const code = await runCli(['studio', '--no-open', '--no-skill-check'], out.io);

    expect(code).toBe(0);
    expect(readlineMocks.question).toHaveBeenCalledWith(
      `Update Superdense ${currentCliVersion} -> ${newerCliVersion} with npm? [Y/n] `,
    );
    expect(spawnMock).toHaveBeenNthCalledWith(
      1,
      'npm',
      ['install', '-g', '@nimrobo/superdense@latest'],
      expect.objectContaining({
        stdio: 'inherit',
      }),
    );
    expect(spawnMock).toHaveBeenNthCalledWith(
      2,
      'superdense',
      ['studio', '--no-open', '--no-skill-check'],
      expect.objectContaining({
        stdio: 'inherit',
        env: expect.objectContaining({ SUPERDENSE_SKIP_UPDATE_CHECK: '1' }),
      }),
    );
    expect(startServer).not.toHaveBeenCalled();
    expect(out.stdout).toEqual([
      '[superdense] updating with `npm install -g @nimrobo/superdense@latest`...',
      '[superdense] update installed; restarting studio...',
    ]);
  });

  it('continues launching current studio when a tty user declines npm update', async () => {
    mockLatestVersion(newerCliVersion);
    setStdinTty(true);
    readlineMocks.question.mockResolvedValue('n');
    const out = io({ isTty: true });

    await runCli(['studio', '--no-open', '--no-skill-check'], out.io);

    expect(spawnMock).not.toHaveBeenCalled();
    expect(startServer).toHaveBeenCalled();
    expect(out.stdout).toContain('[superdense] discovering sessions...');
  });

  it('does not fail studio startup when the npm registry check fails', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('offline'));
    const out = io();

    await runCli(['studio', '--no-open', '--no-skill-check'], out.io);

    expect(out.stderr).toEqual(['[superdense] update check skipped: offline']);
    expect(startServer).toHaveBeenCalled();
  });

  it('skips npm update checks with the flag and restart guard env', async () => {
    const flagged = io();
    await runCli(['studio', '--no-open', '--no-skill-check', '--no-update-check'], flagged.io);
    expect(fetch).not.toHaveBeenCalled();
    expect(startServer).toHaveBeenCalledTimes(1);

    process.env.SUPERDENSE_SKIP_UPDATE_CHECK = '1';
    const guarded = io();
    await runCli(['studio', '--no-open', '--no-skill-check'], guarded.io);

    expect(fetch).not.toHaveBeenCalled();
    expect(startServer).toHaveBeenCalledTimes(2);
  });

  it('lists sessions with filters and paging without exposing logPath by default', async () => {
    const out = io();

    await runCli(
      [
        'session',
        'list',
        '--agent',
        'codex',
        '--pwd',
        '/repo',
        '--q',
        'tests',
        '--limit',
        '20',
        '--offset',
        '5',
      ],
      out.io,
    );

    expect(core.listSessions).toHaveBeenCalledWith({
      agent: 'codex',
      pwd: '/repo',
      q: 'tests',
      includeSubagents: false,
      limit: 20,
      offset: 5,
    });
    expect(core.countSessions).toHaveBeenCalledWith({
      agent: 'codex',
      pwd: '/repo',
      q: 'tests',
      includeSubagents: false,
      limit: 20,
      offset: 5,
    });
    const body = json(out.stdout[0]!);
    expect(body).toMatchObject({ total: 2, limit: 20, offset: 5 });
    expect(body.items).toHaveLength(2);
    expect((body.items as Array<Record<string, unknown>>)[0]).not.toHaveProperty('logPath');
  });

  it('shows a session with logPath only when include-path is passed', async () => {
    const out = io();

    await runCli(['session', 'show', 'codex:abc123', '--include-path'], out.io);

    expect(json(out.stdout[0]!)).toMatchObject({
      session: {
        id: 'codex:abc123',
        logPath: '/tmp/superdense/abc123.jsonl',
      },
    });
  });

  it('passes include-subagents through session list', async () => {
    const out = io();

    await runCli(['session', 'list', '--include-subagents'], out.io);

    expect(core.listSessions).toHaveBeenCalledWith({
      agent: undefined,
      pwd: undefined,
      q: undefined,
      includeSubagents: true,
      limit: 200,
      offset: 0,
    });
    expect(core.countSessions).toHaveBeenCalledWith({
      agent: undefined,
      pwd: undefined,
      q: undefined,
      includeSubagents: true,
      limit: 200,
      offset: 0,
    });
  });

  it('augments session show with sub-agent relationship fields', async () => {
    const out = io();
    vi.mocked(core.getSessionChildren).mockReturnValue([
      { childId: 'codex:child', parentId: 'codex:abc123', relation: 'subagent', metadata: null },
    ]);

    await runCli(['session', 'show', 'codex:abc123'], out.io);

    expect(core.getSessionChildren).toHaveBeenCalledWith('codex:abc123');
    expect(json(out.stdout[0]!)).toMatchObject({
      session: {
        id: 'codex:abc123',
        isSubagent: false,
        parentSessionId: null,
        hasSubagents: true,
        subagentCount: 1,
        subagentIds: ['codex:child'],
      },
    });
  });

  it('lists direct session children with optional full metadata', async () => {
    vi.mocked(core.getSessionChildren).mockReturnValue([
      {
        childId: 'codex:child',
        parentId: 'codex:abc123',
        relation: 'subagent',
        metadata: { agent_role: 'explorer' },
      },
    ]);
    vi.mocked(core.getSession).mockImplementation((id: string) =>
      id === 'codex:child'
        ? {
            ...session,
            id: 'codex:child',
            sessionId: 'child',
            isSubagent: true,
            parentSessionId: 'codex:abc123',
          }
        : session,
    );
    const compact = io();
    const full = io();

    await runCli(['session', 'children', 'codex:abc123'], compact.io);
    await runCli(['session', 'children', 'codex:abc123', '--full'], full.io);

    expect(json(compact.stdout[0]!)).toEqual({
      parentId: 'codex:abc123',
      items: [{ id: 'codex:child', relation: 'subagent' }],
    });
    expect(json(full.stdout[0]!)).toMatchObject({
      parentId: 'codex:abc123',
      items: [
        {
          id: 'codex:child',
          relation: 'subagent',
          metadata: { agent_role: 'explorer' },
          session: { id: 'codex:child', isSubagent: true, parentSessionId: 'codex:abc123' },
        },
      ],
    });
  });

  it('prints a capped session tree', async () => {
    const out = io();
    vi.mocked(core.getSessionTree).mockReturnValue({
      id: 'codex:abc123',
      relation: 'root',
      children: [{ id: 'codex:child', relation: 'subagent', children: [] }],
    });

    await runCli(['session', 'tree', 'codex:abc123', '--depth', '2'], out.io);

    expect(core.getSessionTree).toHaveBeenCalledWith('codex:abc123', 2);
    expect(json(out.stdout[0]!)).toEqual({
      tree: {
        id: 'codex:abc123',
        relation: 'root',
        children: [{ id: 'codex:child', relation: 'subagent', children: [] }],
      },
    });
  });

  it('prints estimated session cost with optional tree aggregation', async () => {
    const out = io();

    await runCli(['session', 'cost', 'codex:abc123', '--tree', '--depth', '3'], out.io);

    expect(core.getSession).toHaveBeenCalledWith('codex:abc123');
    expect(core.getSessionCost).toHaveBeenCalledWith('codex:abc123', { tree: true, depth: 3 });
    expect(json(out.stdout[0]!)).toMatchObject({
      sessionId: 'codex:abc123',
      self: { estimatedCostUsd: 0.012345 },
      totalWithSubagents: { estimatedCostUsd: 0.012345 },
    });
  });

  it('returns session enrichments without exposing logPath by default', async () => {
    const out = io();
    vi.mocked(core.listSessionEnrichments).mockImplementation((_sessionId, queryRunId) =>
      queryRunId === 'system'
        ? [
            { name: 'has_errors', version: 1, computedAt: 2, value: true },
            {
              name: 'file_footprint',
              version: 3,
              computedAt: 2,
              value: {
                v: 1,
                files: [
                  {
                    pathRel: 'src/a.ts',
                    pathAbs: '/repo/src/a.ts',
                    role: 'deliverable',
                    writes: 1,
                    reads: 0,
                    ops: { Edit: 1 },
                    firstTs: 100,
                    lastTs: 100,
                  },
                ],
              },
            },
          ]
        : [
            { name: 'has_errors', version: 1, computedAt: 2, value: true },
            { name: 'has_errors', version: 1, computedAt: 3, value: false },
          ],
    );

    await runCli(['session', 'enrichments', 'codex:abc123'], out.io);

    expect(core.listSessionEnrichments).toHaveBeenCalledWith('codex:abc123', 'system');
    const body = json(out.stdout[0]!);
    expect(body.session).toMatchObject({ id: 'codex:abc123', agent: 'codex' });
    expect(body.session).not.toHaveProperty('logPath');
    expect(body.items).toEqual([
      { name: 'has_errors', version: 1, computedAt: 2, value: true },
      {
        name: 'file_footprint',
        version: 3,
        computedAt: 2,
        value: {
          v: 1,
          fileCount: 1,
          files: [
            {
              pathRel: 'src/a.ts',
              role: 'deliverable',
              writes: 1,
              reads: 0,
              ops: { Edit: 1 },
            },
          ],
        },
      },
    ]);
  });

  it('returns a named enrichment when requested', async () => {
    const out = io();

    await runCli(['session', 'enrichments', 'codex:abc123', '--name', 'tool_counts'], out.io);

    expect(core.getEnrichment).toHaveBeenCalledWith('codex:abc123', 'system', 'tool_counts');
    expect(core.listSessionEnrichments).not.toHaveBeenCalled();
    expect(json(out.stdout[0]!)).toMatchObject({
      items: [{ name: 'tool_counts', version: 1, computedAt: 2, value: { Bash: 3 } }],
    });
  });

  it('compacts file footprint enrichments by default and returns raw data with --full', async () => {
    const value = {
      v: 1,
      files: [
        {
          pathRel: 'src/a.ts',
          pathAbs: '/repo/src/a.ts',
          role: 'deliverable',
          writes: 2,
          reads: 1,
          ops: { Edit: 2, Read: 1 },
          firstTs: 100,
          lastTs: 200,
        },
      ],
    };
    vi.mocked(core.getEnrichment).mockReturnValue({ version: 3, computedAt: 2, value });
    const compact = io();
    const full = io();

    await runCli(
      ['session', 'enrichments', 'codex:abc123', '--name', 'file_footprint'],
      compact.io,
    );
    await runCli(
      ['session', 'enrichments', 'codex:abc123', '--name', 'file_footprint', '--full'],
      full.io,
    );

    const compactItem = (json(compact.stdout[0]!).items as Array<Record<string, unknown>>)[0]!;
    expect(compactItem).toMatchObject({
      name: 'file_footprint',
      value: {
        fileCount: 1,
        files: [{ pathRel: 'src/a.ts', writes: 2, reads: 1, ops: { Edit: 2, Read: 1 } }],
      },
    });
    expect(JSON.stringify(compactItem)).not.toContain('firstTs');
    expect(JSON.stringify(compactItem)).not.toContain('lastTs');
    expect(JSON.stringify(compactItem)).not.toContain('pathAbs');

    expect(json(full.stdout[0]!)).toMatchObject({
      items: [{ name: 'file_footprint', value }],
    });
  });

  it('exposes raw source path only through session path', async () => {
    const out = io();

    await runCli(['session', 'path', 'codex:abc123'], out.io);

    expect(json(out.stdout[0]!)).toEqual({
      id: 'codex:abc123',
      agent: 'codex',
      sessionId: 'abc123',
      logPath: '/tmp/superdense/abc123.jsonl',
    });
  });

  it('runs compactors for selected sessions', async () => {
    const out = io();

    await runCli(['compactor', 'run', 'salience', 'codex:abc123'], out.io);

    expect(core.compactSession).toHaveBeenCalledWith('salience', session);
    expect(json(out.stdout[0]!)).toMatchObject({
      session: { id: 'codex:abc123', agent: 'codex' },
      compactor: { name: 'salience', kind: 'semantic', targetBytes: 4000 },
      result: { v: 1, firstAsk: 'fix it' },
    });
  });

  it('runs ad hoc queries with session metadata and evidence without saving', async () => {
    const out = io();
    const query = {
      filters: { filter: { name: 'session', params: { agent: 'codex' } } },
      enrichers: [],
    };

    await runCli(
      ['query', '--query', JSON.stringify(query), '--limit', '12', '--offset', '2'],
      out.io,
    );

    expect(core.validateQueryDefinition).toHaveBeenCalledWith(query, {
      filters: await core.listFilters(),
      enrichers: core.listEnrichers(),
    });
    expect(core.runAdHocQuery).toHaveBeenCalledWith(query, { limit: 12, offset: 2 });
    expect(core.createQuery).not.toHaveBeenCalled();
    expect(core.getSession).toHaveBeenCalledWith('codex:abc123');
    expect(json(out.stdout[0]!)).toMatchObject({
      matched: 1,
      total: 1,
      limit: 12,
      offset: 2,
      items: [
        {
          sessionId: 'codex:abc123',
          evidence: 'query matched',
          session: { id: 'codex:abc123' },
        },
      ],
    });
  });

  it('shows saved query matches with metadata, members, totals, and paging', async () => {
    const out = io();

    await runCli(['saved-query', 'show', 'q1', '--limit', '10', '--offset', '2'], out.io);

    expect(core.listQueryMatchDetails).toHaveBeenCalledWith('q1', { limit: 10, offset: 2 });
    const body = json(out.stdout[0]!);
    expect(body).toMatchObject({
      id: 'q1',
      total: 1,
      limit: 10,
      offset: 2,
      items: [{ addedAt: 3, evidence: 'matched', session: { id: 'codex:abc123' } }],
      members: [{ id: 'codex:abc123' }],
    });
    expect(
      (body.items as Array<{ session: Record<string, unknown> }>)[0].session,
    ).not.toHaveProperty('logPath');
    expect((body.members as Array<Record<string, unknown>>)[0]).not.toHaveProperty('logPath');
  });

  it('saves queries without running them', async () => {
    const out = io();
    const query = {
      filters: { filter: { name: 'session', params: { agent: 'codex' } } },
      enrichers: [],
    };

    await runCli(
      ['saved-query', 'save', '--name', 'Interesting', '--query', JSON.stringify(query)],
      out.io,
    );

    expect(core.createQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Interesting',
        filters: query.filters,
        enrichers: [],
      }),
    );
    expect(core.runSavedQuery).not.toHaveBeenCalled();
    expect(core.backfillQuery).not.toHaveBeenCalled();
    expect(json(out.stdout[0]!)).toMatchObject({ id: 'q1', name: 'Interesting' });
  });

  it('returns saved query run matches with metadata and evidence', async () => {
    const out = io();

    await runCli(['saved-query', 'run', 'q1', '--limit', '20'], out.io);

    expect(core.runSavedQuery).toHaveBeenCalledWith('q1');
    expect(json(out.stdout[0]!)).toMatchObject({
      matched: 1,
      total: 1,
      limit: 20,
      offset: 0,
      items: [{ addedAt: 3, evidence: 'matched', session: { id: 'codex:abc123' } }],
    });
  });

  it('keeps legacy query run for saved queries', async () => {
    const out = io();

    await runCli(['query', 'run', 'q1', '--limit', '20'], out.io);

    expect(core.runSavedQuery).toHaveBeenCalledWith('q1');
    expect(json(out.stdout[0]!)).toMatchObject({
      matched: 1,
      total: 1,
      limit: 20,
      offset: 0,
      items: [{ addedAt: 3, evidence: 'matched', session: { id: 'codex:abc123' } }],
    });
  });

  it('keeps legacy query preview as a small ad hoc query alias', async () => {
    const out = io();
    const query = {
      filters: { filter: { name: 'session', params: { agent: 'codex' } } },
      enrichers: [],
    };

    await runCli(['query', 'preview', '--query', JSON.stringify(query), '--limit', '12'], out.io);

    expect(core.validateQueryDefinition).toHaveBeenCalledWith(query, {
      filters: await core.listFilters(),
      enrichers: core.listEnrichers(),
    });
    expect(core.runAdHocQuery).toHaveBeenCalledWith(query, { limit: 12, offset: 0 });
    expect(core.getSession).toHaveBeenCalledWith('codex:abc123');
    expect(json(out.stdout[0]!)).toMatchObject({
      limit: 12,
      items: [
        {
          sessionId: 'codex:abc123',
          evidence: 'query matched',
          session: { id: 'codex:abc123' },
        },
      ],
    });
  });

  it('lists filters and enrichers for agents', async () => {
    const out = io();

    await runCli(['session', 'fields'], out.io);

    expect(json(out.stdout[0]!)).toMatchObject({
      filters: expect.arrayContaining([
        expect.objectContaining({ name: 'session', title: 'Session' }),
      ]),
      enrichers: expect.arrayContaining([
        expect.objectContaining({ name: 'tool_counts', returns: 'json' }),
      ]),
    });
  });

  it('lists project work needing action and applies a merge patch', async () => {
    const list = io();
    await runCli(['project', 'list', '--needs-action'], list.io);
    expect(core.listProjectProfiles).toHaveBeenCalledWith({ needsAction: true });
    expect(json(list.stdout[0]!)).toMatchObject({ items: [{ id: 'p1' }] });

    const apply = io();
    await runCli(['project', 'apply', 'p1', '--patch', '{"description":"Updated"}'], apply.io);
    expect(core.applyProjectProfilePatch).toHaveBeenCalledWith('p1', {
      description: 'Updated',
    });
    expect(json(apply.stdout[0]!)).toMatchObject({ project: { id: 'p1' } });
  });

  it('shows project profiling context and resolves attention', async () => {
    const context = io();
    await runCli(['project', 'context', 'p1'], context.io);
    expect(core.getProjectContext).toHaveBeenCalledWith('p1');
    expect(json(context.stdout[0]!)).toMatchObject({ project: { id: 'p1' } });

    const attention = io();
    await runCli(['project', 'attention', 'p1', '--resolved'], attention.io);
    expect(core.setProjectAttention).toHaveBeenCalledWith('p1', { needed: false });
  });

  it('marks the current session from supported environment ids without guessing', async () => {
    const keys = [
      'SUPERDENSE_CURRENT_SESSION_ID',
      'CODEX_THREAD_ID',
      'CLAUDE_CODE_SESSION_ID',
      'CLAUDE_CODE_REMOTE_SESSION_ID',
    ] as const;
    const original = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
    try {
      for (const key of keys) delete process.env[key];
      process.env.SUPERDENSE_CURRENT_SESSION_ID = 'claude-code:override';
      process.env.CODEX_THREAD_ID = 'ignored';
      await runCli(['artifact', 'mark-current'], io().io);
      expect(core.markSessionForCuration).toHaveBeenLastCalledWith('claude-code:override');

      delete process.env.SUPERDENSE_CURRENT_SESSION_ID;
      await runCli(['artifact', 'mark-current'], io().io);
      expect(core.markSessionForCuration).toHaveBeenLastCalledWith('codex:ignored');

      delete process.env.CODEX_THREAD_ID;
      process.env.CLAUDE_CODE_SESSION_ID = 'local';
      await runCli(['artifact', 'mark-current'], io().io);
      expect(core.markSessionForCuration).toHaveBeenLastCalledWith('claude-code:local');

      delete process.env.CLAUDE_CODE_SESSION_ID;
      process.env.CLAUDE_CODE_REMOTE_SESSION_ID = 'remote';
      await runCli(['artifact', 'mark-current'], io().io);
      expect(core.markSessionForCuration).toHaveBeenLastCalledWith('claude-code:remote');

      delete process.env.CLAUDE_CODE_REMOTE_SESSION_ID;
      await expect(runCli(['artifact', 'mark-current'], io().io)).rejects.toThrow(
        'artifact mark --session',
      );
    } finally {
      for (const key of keys) {
        const value = original[key];
        if (value == null) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  it('marks an explicit session id', async () => {
    await runCli(['artifact', 'mark', '--session', 'codex:explicit'], io().io);
    expect(core.markSessionForCuration).toHaveBeenCalledWith('codex:explicit');
  });

  it('exposes the autonomous artifact ready queue', async () => {
    await runCli(['artifact', 'inbox', '--limit', '7'], io().io);
    expect(core.listArtifactInbox).toHaveBeenCalledWith({ limit: 7 });
  });

  it('exposes curation inbox, apply, and mutable thread reads', async () => {
    await runCli(['curation', 'inbox', '--project', 'p1', '--limit', '7'], io().io);
    expect(core.listCurationInbox).toHaveBeenCalledWith({ projectId: 'p1', limit: 7 });

    await runCli(['curation', 'context', 'codex:abc123'], io().io);
    expect(core.getCurationContext).toHaveBeenCalledWith('codex:abc123');

    await runCli(
      [
        'curation',
        'apply',
        '--input',
        '{"actions":[{"type":"session.defer","sessionId":"codex:abc123"}]}',
      ],
      io().io,
    );
    expect(core.applyCurationBatch).toHaveBeenCalledWith({
      actions: [{ type: 'session.defer', sessionId: 'codex:abc123' }],
    });

    await runCli(['thread', 'list', '--project', 'p1'], io().io);
    expect(core.listWorkThreads).toHaveBeenCalledWith({ projectId: 'p1' });
    await runCli(['thread', 'show', 't1'], io().io);
    expect(core.getWorkThread).toHaveBeenCalledWith('t1');
  });

  it('exposes externalization inbox, reads, and assessment writes', async () => {
    const inbox = io();
    await runCli(
      ['externalization', 'inbox', '--limit', '7', '--cursor', 'current-page'],
      inbox.io,
    );
    expect(core.listExternalizationInbox).toHaveBeenCalledWith({
      limit: 7,
      cursor: 'current-page',
    });
    expect(json(inbox.stdout[0]!)).toMatchObject({
      items: [{ artifactId: 't1', status: 'blocked' }],
      remaining: 1,
      nextCursor: 'next-page',
    });

    await runCli(['externalization', 'list', '--status', 'blocked'], io().io);
    expect(core.listExternalizations).toHaveBeenCalledWith({ status: 'blocked' });

    await runCli(['externalization', 'show', 't1'], io().io);
    expect(core.getExternalization).toHaveBeenCalledWith('t1');

    await runCli(
      [
        'externalization',
        'assess',
        '--input',
        '{"artifactId":"t1","status":"not_external","evidence":"internal","targets":[]}',
      ],
      io().io,
    );
    expect(core.assessExternalization).toHaveBeenCalledWith({
      artifactId: 't1',
      status: 'not_external',
      evidence: 'internal',
      targets: [],
    });
  });

  it('uses compact reward-layer read output by default and keeps full output behind --full', async () => {
    const compactArtifact = io();
    const fullArtifact = io();
    await runCli(['artifact', 'show', 't1'], compactArtifact.io);
    await runCli(['artifact', 'show', 't1', '--full'], fullArtifact.io);

    const compactArtifactBody = json(compactArtifact.stdout[0]!);
    const fullArtifactBody = json(fullArtifact.stdout[0]!);
    expect(compactArtifactBody).toMatchObject({
      artifact: {
        id: 't1',
        sessionCounts: { contributors: 1, evidence: 1, total: 2 },
        contributorSessionIds: ['codex:abc123'],
        lineageEventCount: 1,
      },
    });
    expect(
      (compactArtifactBody.artifact as { payload: { text: string } }).payload.text.length,
    ).toBeLessThan(400);
    expect(fullArtifactBody).toMatchObject({
      artifact: {
        payload: { text: 'x'.repeat(600) },
        sessions: expect.arrayContaining([
          expect.objectContaining({ sessionId: 'codex:abc123', role: 'contributor' }),
        ]),
      },
    });

    const compactRewards = io();
    const fullRewards = io();
    await runCli(['reward', 'show', 't1'], compactRewards.io);
    await runCli(['reward', 'show', 't1', '--full'], fullRewards.io);
    expect(json(compactRewards.stdout[0]!)).toMatchObject({
      rewards: {
        targets: [
          {
            targetId: 'target-1',
            snapshotCount: 2,
            metricKeys: expect.arrayContaining(['reach', 'reactions']),
          },
        ],
      },
    });
    expect(compactRewards.stdout[0]).not.toContain('"snapshots"');
    expect(json(fullRewards.stdout[0]!)).toMatchObject({
      rewards: { targets: [{ snapshots: [{ id: 'reward-2' }, { id: 'reward-1' }] }] },
    });

    const compactCohort = io();
    const fullCohort = io();
    await runCli(['cohort', 'show', 'launch'], compactCohort.io);
    await runCli(['cohort', 'show', 'launch', '--full'], fullCohort.io);
    expect(json(compactCohort.stdout[0]!)).toMatchObject({
      cohort: {
        memberCount: 1,
        members: [{ artifact: { id: 't1' }, rewards: { targets: [{ snapshotCount: 2 }] } }],
      },
    });
    const compactCohortBody = json(compactCohort.stdout[0]!);
    const compactCost = (
      compactCohortBody.cohort as { members: Array<{ cost: Record<string, unknown> }> }
    ).members[0]!.cost;
    expect(compactCost).not.toHaveProperty('contributors');
    expect(json(fullCohort.stdout[0]!)).toMatchObject({
      cohort: { members: [{ cost: { contributors: [{ sessionId: 'codex:abc123' }] } }] },
    });
  });

  it('exposes reward status as a JSON reward-layer punch list', async () => {
    const out = io();

    await runCli(['reward', 'status', '--project', 'p1'], out.io);

    expect(core.getRewardStatus).toHaveBeenCalledWith({ projectId: 'p1' });
    expect(json(out.stdout[0]!)).toEqual(rewardStatus);
  });

  it('fetches live reward artifact docs from the default base URL', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => '# Artifact docs',
    } as Response);
    const out = io();

    await runCli(['reward', 'docs', 'artifacts'], out.io);

    expect(fetch).toHaveBeenCalledWith(
      'https://www.nimroboai.com/docs/reward/artifacts',
      expect.objectContaining({
        headers: { accept: 'text/markdown, text/plain;q=0.9, */*;q=0.1' },
      }),
    );
    expect(out.stdout).toEqual(['# Artifact docs']);
  });

  it('fetches live reward connector docs using slash routes and an overridable base URL', async () => {
    process.env.SUPERDENSE_DOCS_BASE_URL = 'https://docs.test/reward/';
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => 'connector docs',
    } as Response);

    const artifactOut = io();
    await runCli(['reward', 'docs', 'connectors', '--artifact', 'post'], artifactOut.io);
    expect(fetch).toHaveBeenLastCalledWith(
      'https://docs.test/reward/artifacts/post/connectors',
      expect.any(Object),
    );
    expect(artifactOut.stdout).toEqual(['connector docs']);

    const usageOut = io();
    await runCli(['reward', 'docs', 'connectors', '--connector', 'x'], usageOut.io);
    expect(fetch).toHaveBeenLastCalledWith(
      'https://docs.test/reward/connectors/x/usage',
      expect.any(Object),
    );
    expect(usageOut.stdout).toEqual(['connector docs']);

    const installOut = io();
    await runCli(
      ['reward', 'docs', 'connectors', '--connector', 'x', '--section', 'install'],
      installOut.io,
    );
    expect(fetch).toHaveBeenLastCalledWith(
      'https://docs.test/reward/connectors/x/install',
      expect.any(Object),
    );
    expect(installOut.stdout).toEqual(['connector docs']);
  });

  it('validates reward connector doc selectors and sections', async () => {
    await expect(runCli(['reward', 'docs', 'connectors'], io().io)).rejects.toThrow(
      'reward docs connectors requires exactly one of --artifact or --connector',
    );

    await expect(
      runCli(['reward', 'docs', 'connectors', '--artifact', 'post', '--connector', 'x'], io().io),
    ).rejects.toThrow('reward docs connectors requires exactly one of --artifact or --connector');

    await expect(
      runCli(['reward', 'docs', 'connectors', '--connector', 'x', '--section', 'setup'], io().io),
    ).rejects.toThrow(
      "reward docs connectors --section must be 'usage', 'install', or 'troubleshoot'",
    );

    expect(fetch).not.toHaveBeenCalled();
  });

  it('surfaces reward docs fetch failures with the attempted URL and connectivity hint', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('offline'));

    await expect(runCli(['reward', 'docs', 'artifacts'], io().io)).rejects.toThrow(
      'reward docs unavailable: https://www.nimroboai.com/docs/reward/artifacts (offline) - check your connection',
    );
  });

  it('throws intended errors for missing query, session, and compactor', async () => {
    vi.mocked(core.getQuery).mockReturnValue(null);
    await expect(runCli(['query', 'show', 'missing'], io().io)).rejects.toThrow(
      'query not found: missing',
    );

    vi.mocked(core.getSession).mockReturnValue(null);
    await expect(runCli(['session', 'show', 'missing'], io().io)).rejects.toThrow(
      'session not found: missing',
    );

    vi.mocked(core.getCompactor).mockReturnValue(undefined);
    await expect(runCli(['compactor', 'show', 'missing'], io().io)).rejects.toThrow(
      'compactor not found: missing',
    );
  });

  it('installs one named bundled skill into configured Claude and Codex skill dirs', async () => {
    const root = mkdtempSync(join(tmpdir(), 'superdense-skills-'));
    tempRoots.push(root);
    process.env.CLAUDE_SKILLS_DIR = join(root, 'claude');
    process.env.CODEX_SKILLS_DIR = join(root, 'codex');
    const out = io();

    await runCli(['skill', 'install', 'superdense'], out.io);

    const claudeSkill = join(root, 'claude', 'superdense');
    const codexSkill = join(root, 'codex', 'superdense');
    expect(readFileSync(join(claudeSkill, 'SKILL.md'), 'utf8')).toContain(
      '# Superdense Stored Sessions',
    );
    expect(readFileSync(join(codexSkill, 'SKILL.md'), 'utf8')).toContain(
      '# Superdense Stored Sessions',
    );
    expect(existsSync(join(claudeSkill, 'agents', 'openai.yaml'))).toBe(true);
    expect(existsSync(join(codexSkill, 'agents', 'openai.yaml'))).toBe(true);
    expect(json(readFileSync(join(claudeSkill, '.superdense-install.json'), 'utf8'))).toMatchObject(
      {
        version: currentSkillVersion,
        scope: 'global',
      },
    );
    expect(json(readFileSync(join(codexSkill, '.superdense-install.json'), 'utf8'))).toMatchObject({
      version: currentSkillVersion,
      scope: 'global',
    });
    expect(json(out.stdout[0]!)).toEqual({
      installed: [
        {
          name: 'superdense',
          claude: claudeSkill,
          codex: codexSkill,
        },
      ],
    });
  });

  it('installs the chain skill with agent-specific Codex instructions', async () => {
    const root = mkdtempSync(join(tmpdir(), 'superdense-chain-skill-'));
    tempRoots.push(root);
    process.env.CLAUDE_SKILLS_DIR = join(root, 'claude');
    process.env.CODEX_SKILLS_DIR = join(root, 'codex');
    const out = io();

    await runCli(['skill', 'install', 'chain'], out.io);

    const claudeSkill = join(root, 'claude', 'chain');
    const codexSkill = join(root, 'codex', 'chain');
    expect(readFileSync(join(claudeSkill, 'SKILL.md'), 'utf8')).toContain(
      '!`bash ~/.claude/skills/chain/chain-sessions.sh`',
    );
    expect(readFileSync(join(codexSkill, 'SKILL.md'), 'utf8')).toContain(
      'bash ~/.codex/skills/chain/chain-sessions.sh',
    );
    expect(readFileSync(join(codexSkill, 'SKILL.md'), 'utf8')).not.toContain(
      '~/.claude/skills/chain',
    );
    expect(existsSync(join(claudeSkill, 'SKILL.codex.md'))).toBe(false);
    expect(existsSync(join(codexSkill, 'SKILL.codex.md'))).toBe(false);
    expect(existsSync(join(claudeSkill, 'chain-sessions.sh'))).toBe(true);
    expect(existsSync(join(codexSkill, 'chain-sessions.sh'))).toBe(true);
    expect(json(readFileSync(join(claudeSkill, '.superdense-install.json'), 'utf8'))).toMatchObject(
      {
        version: '0.1.1',
        scope: 'global',
      },
    );
    expect(json(readFileSync(join(codexSkill, '.superdense-install.json'), 'utf8'))).toMatchObject({
      version: '0.1.1',
      scope: 'global',
    });
    expect(json(out.stdout[0]!)).toEqual({
      installed: [
        {
          name: 'chain',
          claude: claudeSkill,
          codex: codexSkill,
        },
      ],
    });
  });

  it('installs an outcome skill with shared reference material', async () => {
    const root = mkdtempSync(join(tmpdir(), 'superdense-outcome-skill-'));
    tempRoots.push(root);
    process.env.CLAUDE_SKILLS_DIR = join(root, 'claude');
    process.env.CODEX_SKILLS_DIR = join(root, 'codex');
    const out = io();

    await runCli(['skill', 'install', 'outcome-run'], out.io);

    const claudeSkill = join(root, 'claude', 'outcome-run');
    const codexSkill = join(root, 'codex', 'outcome-run');
    expect(readFileSync(join(claudeSkill, 'SKILL.md'), 'utf8')).toContain('# Outcome Run');
    expect(readFileSync(join(codexSkill, 'SKILL.md'), 'utf8')).toContain('# Outcome Run');
    expect(readFileSync(join(claudeSkill, 'references', 'outcome-loop.md'), 'utf8')).toContain(
      'Do not create `metrics.md`',
    );
    expect(readFileSync(join(claudeSkill, 'references', 'outcome-loop.md'), 'utf8')).toContain(
      '## Gate Template',
    );
    expect(readFileSync(join(codexSkill, 'references', 'outcome-loop.md'), 'utf8')).toContain(
      'runs/<run-id>/work.md',
    );
    expect(existsSync(join(claudeSkill, 'agents', 'openai.yaml'))).toBe(true);
    expect(existsSync(join(codexSkill, 'agents', 'openai.yaml'))).toBe(true);
    expect(json(readFileSync(join(claudeSkill, '.superdense-install.json'), 'utf8'))).toMatchObject(
      {
        version: '0.2.0',
        scope: 'global',
      },
    );
    expect(json(out.stdout[0]!)).toEqual({
      installed: [
        {
          name: 'outcome-run',
          claude: claudeSkill,
          codex: codexSkill,
        },
      ],
    });
  });

  it('materializes the shared outcome-loop reference into each installed outcome skill', async () => {
    const root = mkdtempSync(join(tmpdir(), 'superdense-shared-ref-'));
    tempRoots.push(root);
    process.env.CLAUDE_SKILLS_DIR = join(root, 'claude');
    process.env.CODEX_SKILLS_DIR = join(root, 'codex');
    const out = io();

    await runCli(['skill', 'install', 'outcome-setup', 'outcome-run', 'outcome-update'], out.io);

    const canonical = readFileSync(
      new URL('../../../skills/_shared/outcome-loop.md', import.meta.url),
      'utf8',
    );
    expect(canonical).toContain('### runs/<run-id>/work.md');
    expect(canonical).toContain('### runs/<run-id>/learnings.md');
    expect(canonical).toContain('  gate.md');
    expect(canonical).toContain('## Gate Status');
    expect(canonical).toContain(
      'If a required check fails, try to fix the issue within the current run',
    );
    expect(canonical).toContain('A compulsory `gate.md` may be operationally empty');
    expect(canonical).not.toContain(
      'from the Work Template and Learnings Template in this reference',
    );
    for (const name of ['outcome-setup', 'outcome-run', 'outcome-update']) {
      for (const surface of ['claude', 'codex']) {
        expect(
          readFileSync(join(root, surface, name, 'references', 'outcome-loop.md'), 'utf8'),
        ).toBe(canonical);
      }
    }
  });

  it('does not install the _shared reference directory as a skill', async () => {
    const root = mkdtempSync(join(tmpdir(), 'superdense-shared-dir-'));
    tempRoots.push(root);
    process.env.CLAUDE_SKILLS_DIR = join(root, 'claude');
    process.env.CODEX_SKILLS_DIR = join(root, 'codex');
    const out = io();

    await runCli(['skill', 'install'], out.io);

    const body = json(out.stdout[0]!) as { installed: Array<{ name: string }> };
    expect(body.installed.map((item) => item.name)).not.toContain('_shared');
    expect(existsSync(join(root, 'claude', '_shared'))).toBe(false);
    expect(existsSync(join(root, 'codex', '_shared'))).toBe(false);
  });

  it('installs all bundled skills when no skill name is provided', async () => {
    const root = mkdtempSync(join(tmpdir(), 'superdense-skills-'));
    tempRoots.push(root);
    process.env.CLAUDE_SKILLS_DIR = join(root, 'claude');
    process.env.CODEX_SKILLS_DIR = join(root, 'codex');
    const out = io();

    await runCli(['skill', 'install'], out.io);

    const body = json(out.stdout[0]!);
    expect(body.installed).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'superdense',
          claude: join(root, 'claude', 'superdense'),
          codex: join(root, 'codex', 'superdense'),
        }),
        expect.objectContaining({
          name: 'chain',
          claude: join(root, 'claude', 'chain'),
          codex: join(root, 'codex', 'chain'),
        }),
        expect.objectContaining({
          name: 'outcome-setup',
          claude: join(root, 'claude', 'outcome-setup'),
          codex: join(root, 'codex', 'outcome-setup'),
        }),
        expect.objectContaining({
          name: 'outcome-run',
          claude: join(root, 'claude', 'outcome-run'),
          codex: join(root, 'codex', 'outcome-run'),
        }),
        expect.objectContaining({
          name: 'outcome-update',
          claude: join(root, 'claude', 'outcome-update'),
          codex: join(root, 'codex', 'outcome-update'),
        }),
      ]),
    );
    expect(existsSync(join(root, 'claude', 'superdense', 'agents', 'openai.yaml'))).toBe(true);
    expect(existsSync(join(root, 'codex', 'superdense', 'agents', 'openai.yaml'))).toBe(true);
    expect(existsSync(join(root, 'claude', 'superdense', 'reward', 'profile.md'))).toBe(true);
    expect(existsSync(join(root, 'codex', 'superdense', 'reward', 'profile.md'))).toBe(true);
    expect(existsSync(join(root, 'claude', 'superdense', 'reward', 'reconcile.md'))).toBe(true);
    expect(existsSync(join(root, 'codex', 'superdense', 'reward', 'reconcile.md'))).toBe(true);
    expect(existsSync(join(root, 'claude', 'chain', 'chain-sessions.sh'))).toBe(true);
    expect(existsSync(join(root, 'codex', 'chain', 'chain-sessions.sh'))).toBe(true);
    expect(existsSync(join(root, 'claude', 'outcome-setup', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(root, 'codex', 'outcome-run', 'references', 'outcome-loop.md'))).toBe(
      true,
    );
    expect(existsSync(join(root, 'claude', 'outcome-update', 'agents', 'openai.yaml'))).toBe(true);
    expect(
      existsSync(join(root, 'claude', 'superdense-externalization-reconcile', 'SKILL.md')),
    ).toBe(false);
    expect(
      existsSync(join(root, 'codex', 'superdense-externalization-reconcile', 'SKILL.md')),
    ).toBe(false);
    expect(
      readFileSync(join(root, 'claude', 'superdense', 'reward', 'reconcile.md'), 'utf8'),
    ).toContain('--cursor <opaque>');
    expect(
      readFileSync(join(root, 'codex', 'superdense', 'reward', 'reconcile.md'), 'utf8'),
    ).toContain('--cursor <opaque>');
  });

  it('installs a skill locally under the current working directory', async () => {
    const root = mkdtempSync(join(tmpdir(), 'superdense-local-skills-'));
    tempRoots.push(root);
    process.chdir(root);
    const cwd = process.cwd();
    process.env.CLAUDE_SKILLS_DIR = join(root, 'global-claude');
    process.env.CODEX_SKILLS_DIR = join(root, 'global-codex');
    const out = io();

    await runCli(['skill', 'install', 'superdense', '--locally'], out.io);

    const claudeSkill = join(cwd, '.claude', 'skills', 'superdense');
    const codexSkill = join(cwd, '.codex', 'skills', 'superdense');
    expect(existsSync(join(claudeSkill, 'SKILL.md'))).toBe(true);
    expect(existsSync(join(codexSkill, 'SKILL.md'))).toBe(true);
    expect(existsSync(join(root, 'global-claude', 'superdense'))).toBe(false);
    expect(existsSync(join(root, 'global-codex', 'superdense'))).toBe(false);
    expect(json(readFileSync(join(claudeSkill, '.superdense-install.json'), 'utf8'))).toMatchObject(
      {
        version: currentSkillVersion,
        scope: 'local',
      },
    );
    expect(json(out.stdout[0]!)).toEqual({
      installed: [
        {
          name: 'superdense',
          claude: claudeSkill,
          codex: codexSkill,
        },
      ],
    });
  });

  it('prints a non-tty studio hint for missing skills without mutating disk', async () => {
    const root = mkdtempSync(join(tmpdir(), 'superdense-studio-missing-'));
    tempRoots.push(root);
    process.chdir(root);
    process.env.CLAUDE_SKILLS_DIR = join(root, 'global-claude');
    process.env.CODEX_SKILLS_DIR = join(root, 'global-codex');
    const out = io();

    await runCli(['studio', '--no-open'], out.io);

    expect(out.stdout[0]).toBe(
      '[superdense] hint: required skills missing. Run `superdense skill install` to update.',
    );
    expect(existsSync(join(root, 'global-claude', 'superdense'))).toBe(false);
    expect(existsSync(join(root, 'global-codex', 'superdense'))).toBe(false);
    expect(existsSync(join(root, 'global-claude', 'chain'))).toBe(false);
    expect(existsSync(join(root, 'global-codex', 'chain'))).toBe(false);
    expect(startServer).toHaveBeenCalled();
  });

  it('installs required studio skills when a tty user confirms', async () => {
    const root = mkdtempSync(join(tmpdir(), 'superdense-studio-install-skills-'));
    tempRoots.push(root);
    process.chdir(root);
    process.env.CLAUDE_SKILLS_DIR = join(root, 'global-claude');
    process.env.CODEX_SKILLS_DIR = join(root, 'global-codex');
    setStdinTty(true);
    readlineMocks.question.mockResolvedValue('y');
    const out = io({ isTty: true });

    await runCli(['studio', '--no-open'], out.io);

    expect(readlineMocks.question).toHaveBeenCalledWith(
      'Install Superdense skills globally? [Y/n] ',
    );
    expect(readlineMocks.question).toHaveBeenCalledTimes(1);
    expect(existsSync(join(root, 'global-claude', 'superdense', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(root, 'global-codex', 'superdense', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(root, 'global-claude', 'superdense', 'reward', 'profile.md'))).toBe(
      true,
    );
    expect(existsSync(join(root, 'global-codex', 'superdense', 'reward', 'profile.md'))).toBe(true);
    expect(existsSync(join(root, 'global-claude', 'superdense', 'reward', 'reconcile.md'))).toBe(
      true,
    );
    expect(existsSync(join(root, 'global-codex', 'superdense', 'reward', 'reconcile.md'))).toBe(
      true,
    );
    expect(existsSync(join(root, 'global-claude', 'chain', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(root, 'global-codex', 'chain', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(root, 'global-claude', 'outcome-setup', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(root, 'global-codex', 'outcome-run', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(root, 'global-claude', 'outcome-update', 'SKILL.md'))).toBe(true);
    expect(
      existsSync(join(root, 'global-claude', 'superdense-externalization-reconcile', 'SKILL.md')),
    ).toBe(false);
    expect(
      existsSync(join(root, 'global-codex', 'superdense-externalization-reconcile', 'SKILL.md')),
    ).toBe(false);
    expect(out.stdout).toContain('[superdense] installed Superdense skills globally.');
    expect(startServer).toHaveBeenCalled();
  });

  it('does not print a studio skill hint when the installed skill is current', async () => {
    const root = mkdtempSync(join(tmpdir(), 'superdense-studio-current-'));
    tempRoots.push(root);
    process.chdir(root);
    process.env.CLAUDE_SKILLS_DIR = join(root, 'global-claude');
    process.env.CODEX_SKILLS_DIR = join(root, 'global-codex');
    await runCli(['skill', 'install'], io().io);
    vi.clearAllMocks();
    vi.mocked(core.runDiscovery).mockResolvedValue({ discovered: 2 });
    vi.mocked(core.runQueryEvaluation).mockResolvedValue({ evaluated: 0 });
    vi.mocked(startServer).mockResolvedValue({ url: 'http://127.0.0.1:4242', close: vi.fn() });
    vi.mocked(open).mockResolvedValue({} as Awaited<ReturnType<typeof open>>);
    const out = io();

    await runCli(['studio', '--no-open'], out.io);

    expect(out.stdout[0]).toBe('[superdense] discovering sessions...');
    expect(out.stdout.some((line) => line.includes('hint: skill'))).toBe(false);
    expect(startServer).toHaveBeenCalled();
  });

  it('prints a studio skill hint when only one required skill is installed', async () => {
    const root = mkdtempSync(join(tmpdir(), 'superdense-studio-partial-'));
    tempRoots.push(root);
    process.chdir(root);
    process.env.CLAUDE_SKILLS_DIR = join(root, 'global-claude');
    process.env.CODEX_SKILLS_DIR = join(root, 'global-codex');
    await runCli(['skill', 'install', 'superdense'], io().io);
    vi.clearAllMocks();
    vi.mocked(core.runDiscovery).mockResolvedValue({ discovered: 2 });
    vi.mocked(core.runQueryEvaluation).mockResolvedValue({ evaluated: 0 });
    vi.mocked(startServer).mockResolvedValue({ url: 'http://127.0.0.1:4242', close: vi.fn() });
    vi.mocked(open).mockResolvedValue({} as Awaited<ReturnType<typeof open>>);
    const out = io();

    await runCli(['studio', '--no-open'], out.io);

    expect(out.stdout[0]).toBe(
      '[superdense] hint: required skills missing. Run `superdense skill install` to update.',
    );
    expect(startServer).toHaveBeenCalled();
  });

  it('prints a non-tty studio hint for outdated legacy installs without mutating disk', async () => {
    const root = mkdtempSync(join(tmpdir(), 'superdense-studio-outdated-'));
    tempRoots.push(root);
    process.chdir(root);
    process.env.CLAUDE_SKILLS_DIR = join(root, 'global-claude');
    process.env.CODEX_SKILLS_DIR = join(root, 'global-codex');
    const claudeSkill = join(root, 'global-claude', 'superdense');
    const codexSkill = join(root, 'global-codex', 'superdense');
    mkdirSync(claudeSkill, { recursive: true });
    mkdirSync(codexSkill, { recursive: true });
    writeFileSync(join(claudeSkill, 'SKILL.md'), '---\nname: superdense\nversion: 0.0.1\n---\n');
    writeFileSync(join(codexSkill, 'SKILL.md'), '---\nname: superdense\nversion: 0.0.1\n---\n');
    const out = io();

    await runCli(['studio', '--no-open'], out.io);

    expect(out.stdout[0]).toBe(
      '[superdense] hint: required skills outdated. Run `superdense skill install` to update.',
    );
    expect(existsSync(join(claudeSkill, '.superdense-install.json'))).toBe(false);
    expect(existsSync(join(codexSkill, '.superdense-install.json'))).toBe(false);
    expect(startServer).toHaveBeenCalled();
  });
});

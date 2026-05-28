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
  backfillQuery: vi.fn(),
  compactSession: vi.fn(),
  countQueryMatches: vi.fn(),
  countSessions: vi.fn(),
  createQuery: vi.fn(),
  deleteQuery: vi.fn(),
  ensureSuperdenseDirs: vi.fn(),
  getCompactor: vi.fn(),
  getEnrichment: vi.fn(),
  getQuery: vi.fn(),
  getSession: vi.fn(),
  indexAll: vi.fn(),
  listCompactors: vi.fn(),
  listEnrichers: vi.fn(),
  listFilterCatalog: vi.fn(),
  listFilters: vi.fn(),
  listQueries: vi.fn(),
  listQueryMatchDetails: vi.fn(),
  listQueryMatches: vi.fn(),
  listSessionEnrichments: vi.fn(),
  listSessions: vi.fn(),
  loadUserEnrichers: vi.fn(),
  localClaudeSkillsDir: (cwd: string) => join(cwd, '.claude', 'skills'),
  localCodexSkillsDir: (cwd: string) => join(cwd, '.codex', 'skills'),
  previewQuery: vi.fn(),
  runAdHocQuery: vi.fn(),
  runDiscovery: vi.fn(),
  runQueryEvaluation: vi.fn(),
  runSavedQuery: vi.fn(),
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

const originalClaudeSkillsDir = process.env.CLAUDE_SKILLS_DIR;
const originalCodexSkillsDir = process.env.CODEX_SKILLS_DIR;
const originalSkipUpdateCheck = process.env.SUPERDENSE_SKIP_UPDATE_CHECK;
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
  vi.mocked(core.getSession).mockReturnValue(session);
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
      limit: 20,
      offset: 5,
    });
    expect(core.countSessions).toHaveBeenCalledWith({
      agent: 'codex',
      pwd: '/repo',
      q: 'tests',
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

  it('returns session enrichments without exposing logPath by default', async () => {
    const out = io();
    vi.mocked(core.listSessionEnrichments).mockImplementation((_sessionId, queryRunId) =>
      queryRunId === 'system'
        ? [{ name: 'has_errors', version: 1, computedAt: 2, value: true }]
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
    expect(body.items).toEqual([{ name: 'has_errors', version: 1, computedAt: 2, value: true }]);
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
        version: '0.1.2',
        scope: 'global',
      },
    );
    expect(json(readFileSync(join(codexSkill, '.superdense-install.json'), 'utf8'))).toMatchObject({
      version: '0.1.2',
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
        version: '0.1.0',
        scope: 'global',
      },
    );
    expect(json(readFileSync(join(codexSkill, '.superdense-install.json'), 'utf8'))).toMatchObject({
      version: '0.1.0',
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
      ]),
    );
    expect(existsSync(join(root, 'claude', 'superdense', 'agents', 'openai.yaml'))).toBe(true);
    expect(existsSync(join(root, 'codex', 'superdense', 'agents', 'openai.yaml'))).toBe(true);
    expect(existsSync(join(root, 'claude', 'chain', 'chain-sessions.sh'))).toBe(true);
    expect(existsSync(join(root, 'codex', 'chain', 'chain-sessions.sh'))).toBe(true);
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
        version: '0.1.2',
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
    expect(existsSync(join(root, 'global-claude', 'chain', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(root, 'global-codex', 'chain', 'SKILL.md'))).toBe(true);
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

import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@road42/server', () => ({
  startServer: vi.fn(),
}));

vi.mock('open', () => ({
  default: vi.fn(),
}));

vi.mock('@road42/core', () => ({
  CLAUDE_SKILLS_DIR: '/unused/claude/skills',
  CODEX_SKILLS_DIR: '/unused/codex/skills',
  backfillQuery: vi.fn(),
  compactSession: vi.fn(),
  countQueryMatches: vi.fn(),
  countSessions: vi.fn(),
  createQuery: vi.fn(),
  deleteQuery: vi.fn(),
  ensureRoad42Dirs: vi.fn(),
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
  previewQuery: vi.fn(),
  runDiscovery: vi.fn(),
  runQueryEvaluation: vi.fn(),
  validateQueryDefinition: vi.fn(),
}));

import * as core from '@road42/core';
import { startServer } from '@road42/server';
import open from 'open';
import { runCli } from './index.js';

const session = {
  id: 'codex:abc123',
  agent: 'codex',
  sessionId: 'abc123',
  logPath: '/tmp/road42/abc123.jsonl',
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
  logPath: '/tmp/road42/def456.jsonl',
  summary: 'Review code',
  modifiedAt: 1779322000000,
};

const originalClaudeSkillsDir = process.env.CLAUDE_SKILLS_DIR;
const originalCodexSkillsDir = process.env.CODEX_SKILLS_DIR;
const tempRoots: string[] = [];

function io() {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    stdout,
    stderr,
    io: {
      stdout: { log: (value: string) => stdout.push(value) },
      stderr: { error: (value: string) => stderr.push(value) },
      isTty: false,
    },
  };
}

function json(value: string) {
  return JSON.parse(value) as Record<string, unknown>;
}

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.CLAUDE_SKILLS_DIR;
  delete process.env.CODEX_SKILLS_DIR;
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
    items: [{ sessionId: 'codex:abc123', evidence: 'matched', enrichments: { tool_counts: { Bash: 3 } } }],
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
  vi.mocked(core.runDiscovery).mockResolvedValue({ discovered: 2 });
  vi.mocked(core.runQueryEvaluation).mockResolvedValue({ evaluated: 0 });
  vi.mocked(startServer).mockResolvedValue({ url: 'http://127.0.0.1:4242', close: vi.fn() });
  vi.mocked(open).mockResolvedValue({} as Awaited<ReturnType<typeof open>>);
});

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
  if (originalClaudeSkillsDir == null) delete process.env.CLAUDE_SKILLS_DIR;
  else process.env.CLAUDE_SKILLS_DIR = originalClaudeSkillsDir;
  if (originalCodexSkillsDir == null) delete process.env.CODEX_SKILLS_DIR;
  else process.env.CODEX_SKILLS_DIR = originalCodexSkillsDir;
});

describe('road42 cli agent commands', () => {
  it('prints help with no args and keeps start compatibility for the web UI', async () => {
    const noArgs = io();
    const start = io();

    await runCli([], noArgs.io);
    await runCli(['start', '--no-open'], start.io);

    expect(core.runDiscovery).toHaveBeenCalledTimes(1);
    expect(startServer).toHaveBeenCalledTimes(1);
    expect(startServer).toHaveBeenCalledWith({ port: 4242, host: '127.0.0.1' });
    expect(noArgs.stdout[0]).toContain('Usage: road42 <command> [options]');
    expect(start.stdout).toContain('[road42] http://127.0.0.1:4242');
  });

  it('starts the studio command without opening the browser when requested', async () => {
    const out = io();

    await runCli(['studio', '--port', '5050', '--no-open'], out.io);

    expect(startServer).toHaveBeenCalledWith({ port: 5050, host: '127.0.0.1' });
    expect(open).not.toHaveBeenCalled();
    expect(out.stdout).toContain('[road42] discovered 2 sessions.');
  });

  it('lists sessions with filters and paging without exposing logPath by default', async () => {
    const out = io();

    await runCli([
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
    ], out.io);

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
        logPath: '/tmp/road42/abc123.jsonl',
      },
    });
  });

  it('returns session enrichments without exposing logPath by default', async () => {
    const out = io();

    await runCli(['session', 'enrichments', 'codex:abc123'], out.io);

    const body = json(out.stdout[0]!);
    expect(body.session).toMatchObject({ id: 'codex:abc123', agent: 'codex' });
    expect(body.session).not.toHaveProperty('logPath');
    expect(body.items).toEqual([{ name: 'has_errors', version: 1, computedAt: 2, value: true }]);
  });

  it('returns a named enrichment when requested', async () => {
    const out = io();

    await runCli(['session', 'enrichments', 'codex:abc123', '--name', 'tool_counts'], out.io);

    expect(core.getEnrichment).toHaveBeenCalledWith('codex:abc123', 'tool_counts');
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
      logPath: '/tmp/road42/abc123.jsonl',
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

  it('shows query matches with metadata, members, totals, and paging', async () => {
    const out = io();

    await runCli(['query', 'show', 'q1', '--limit', '10', '--offset', '2'], out.io);

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
    expect((body.items as Array<{ session: Record<string, unknown> }>)[0].session).not.toHaveProperty('logPath');
    expect((body.members as Array<Record<string, unknown>>)[0]).not.toHaveProperty('logPath');
  });

  it('returns query run matches with metadata and evidence', async () => {
    const out = io();

    await runCli(['query', 'run', 'q1', '--limit', '20'], out.io);

    expect(core.backfillQuery).toHaveBeenCalledWith('q1');
    expect(json(out.stdout[0]!)).toMatchObject({
      matched: 1,
      total: 1,
      limit: 20,
      offset: 0,
      items: [{ addedAt: 3, evidence: 'matched', session: { id: 'codex:abc123' } }],
    });
  });

  it('previews queries with session metadata and evidence', async () => {
    const out = io();
    const query = { filters: { filter: { name: 'session', params: { agent: 'codex' } } }, enrichers: [] };

    await runCli(['query', 'preview', '--query', JSON.stringify(query), '--limit', '12'], out.io);

    expect(core.validateQueryDefinition).toHaveBeenCalledWith(query, { filters: await core.listFilters(), enrichers: core.listEnrichers() });
    expect(core.previewQuery).toHaveBeenCalledWith(query, { limit: 12 });
    expect(core.getSession).toHaveBeenCalledWith('codex:abc123');
    expect(json(out.stdout[0]!)).toMatchObject({
      limit: 12,
      items: [{
        sessionId: 'codex:abc123',
        evidence: 'preview matched',
        session: { id: 'codex:abc123' },
      }],
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
    await expect(runCli(['query', 'show', 'missing'], io().io)).rejects.toThrow('query not found: missing');

    vi.mocked(core.getSession).mockReturnValue(null);
    await expect(runCli(['session', 'show', 'missing'], io().io)).rejects.toThrow('session not found: missing');

    vi.mocked(core.getCompactor).mockReturnValue(undefined);
    await expect(runCli(['compactor', 'show', 'missing'], io().io)).rejects.toThrow('compactor not found: missing');
  });

  it('installs one named bundled skill into configured Claude and Codex skill dirs', async () => {
    const root = mkdtempSync(join(tmpdir(), 'road42-skills-'));
    tempRoots.push(root);
    process.env.CLAUDE_SKILLS_DIR = join(root, 'claude');
    process.env.CODEX_SKILLS_DIR = join(root, 'codex');
    const out = io();

    await runCli(['skill', 'install', 'road42'], out.io);

    const claudeSkill = join(root, 'claude', 'road42');
    const codexSkill = join(root, 'codex', 'road42');
    expect(readFileSync(join(claudeSkill, 'SKILL.md'), 'utf8')).toContain('# Road42 Stored Sessions');
    expect(readFileSync(join(codexSkill, 'SKILL.md'), 'utf8')).toContain('# Road42 Stored Sessions');
    expect(existsSync(join(claudeSkill, 'agents', 'openai.yaml'))).toBe(true);
    expect(existsSync(join(codexSkill, 'agents', 'openai.yaml'))).toBe(true);
    expect(json(out.stdout[0]!)).toEqual({
      installed: [{
        name: 'road42',
        claude: claudeSkill,
        codex: codexSkill,
      }],
    });
  });

  it('installs all bundled skills when no skill name is provided', async () => {
    const root = mkdtempSync(join(tmpdir(), 'road42-skills-'));
    tempRoots.push(root);
    process.env.CLAUDE_SKILLS_DIR = join(root, 'claude');
    process.env.CODEX_SKILLS_DIR = join(root, 'codex');
    const out = io();

    await runCli(['skill', 'install'], out.io);

    const body = json(out.stdout[0]!);
    expect(body.installed).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: 'road42',
        claude: join(root, 'claude', 'road42'),
        codex: join(root, 'codex', 'road42'),
      }),
    ]));
    expect(existsSync(join(root, 'claude', 'road42', 'agents', 'openai.yaml'))).toBe(true);
    expect(existsSync(join(root, 'codex', 'road42', 'agents', 'openai.yaml'))).toBe(true);
  });
});

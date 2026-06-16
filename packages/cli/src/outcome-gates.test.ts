import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

type GateResult = {
  overall: 'pass' | 'warn' | 'fail';
  passes: string[];
  warnings: string[];
  failures: string[];
};

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function fixtureRoot(name: string): string {
  const root = mkdtempSync(join(tmpdir(), name));
  tempRoots.push(root);
  return root;
}

function writeScript(path: string, body: string): void {
  writeFileSync(path, `#!/usr/bin/env node\n${body}\n`);
  chmodSync(path, 0o755);
}

function runFixtureGateChecks(
  cwd: string,
  checks: Array<{ name: string; kind: 'required' | 'warning'; script: string }>,
): GateResult {
  const result: GateResult = { overall: 'pass', passes: [], warnings: [], failures: [] };
  for (const check of checks) {
    const run = spawnSync(process.execPath, [check.script], { cwd, encoding: 'utf8' });
    if (run.status === 0) {
      result.passes.push(check.name);
    } else if (check.kind === 'required') {
      result.failures.push(check.name);
    } else {
      result.warnings.push(check.name);
    }
  }
  result.overall =
    result.failures.length > 0 ? 'fail' : result.warnings.length > 0 ? 'warn' : 'pass';
  return result;
}

function field(markdown: string, label: string): string {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${escaped}:\\s*(.*)$`, 'm').exec(markdown)?.[1]?.trim() ?? '';
}

function validateRunRecord(
  outcomeFolder: string,
  runId: string,
): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!existsSync(join(outcomeFolder, 'gate.md'))) errors.push('missing gate.md');

  const workPath = join(outcomeFolder, 'runs', runId, 'work.md');
  if (!existsSync(workPath)) {
    errors.push('missing work.md');
    return { errors, warnings };
  }

  const work = readFileSync(workPath, 'utf8');
  if (!work.includes('## Gate Status')) errors.push('missing ## Gate Status');

  const checksRun = field(work, 'Checks run');
  if (checksRun === 'none') return { errors, warnings };

  const unresolved = field(work, 'Unresolved failures');
  if (unresolved && unresolved !== '-') {
    errors.push(`unresolved required gate failure: ${unresolved}`);
  }

  const warning = field(work, 'Warnings');
  if (warning && warning !== '-') warnings.push(warning);

  return { errors, warnings };
}

function writeOutcomeRun(
  outcomeFolder: string,
  runId: string,
  work: string,
  includeGate = true,
): void {
  if (includeGate) {
    writeFileSync(
      join(outcomeFolder, 'gate.md'),
      '# Gate\n\n## Completion Rules\n\n## Required Checks\n\n## Warning Checks\n\n## Deterministic Checks\n\n## Failure Policy\n',
    );
  }
  const runDir = join(outcomeFolder, 'runs', runId);
  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(runDir, 'work.md'), work);
}

describe('outcome gate fixtures', () => {
  it('classifies pass, warning, and failure outcomes from test-local scripts', () => {
    const root = fixtureRoot('superdense-gate-fixtures-');
    const scripts = join(root, 'scripts');
    mkdirSync(scripts);
    const pass = join(scripts, 'pass.mjs');
    const warn = join(scripts, 'warn.mjs');
    const fail = join(scripts, 'fail.mjs');
    writeScript(pass, 'process.exit(0);');
    writeScript(warn, 'console.error("warning check failed"); process.exit(1);');
    writeScript(fail, 'console.error("required check failed"); process.exit(1);');

    expect(
      runFixtureGateChecks(root, [{ name: 'required pass', kind: 'required', script: pass }]),
    ).toMatchObject({ overall: 'pass', failures: [], warnings: [] });
    expect(
      runFixtureGateChecks(root, [{ name: 'warning miss', kind: 'warning', script: warn }]),
    ).toMatchObject({ overall: 'warn', failures: [], warnings: ['warning miss'] });
    expect(
      runFixtureGateChecks(root, [{ name: 'required fail', kind: 'required', script: fail }]),
    ).toMatchObject({ overall: 'fail', failures: ['required fail'] });
  });

  it('flags malformed run records while allowing warning-only completion', () => {
    const runId = '2026-06-16-test';

    const missingGate = fixtureRoot('superdense-missing-gate-');
    writeOutcomeRun(
      missingGate,
      runId,
      '# Work\n\nStatus: complete\n\n## Gate Status\n\nWarnings: -\nUnresolved failures: -\n',
      false,
    );
    expect(validateRunRecord(missingGate, runId).errors).toContain('missing gate.md');

    const missingStatus = fixtureRoot('superdense-missing-gate-status-');
    writeOutcomeRun(missingStatus, runId, '# Work\n\nStatus: complete\n');
    expect(validateRunRecord(missingStatus, runId).errors).toContain('missing ## Gate Status');

    const unresolvedFailure = fixtureRoot('superdense-unresolved-gate-');
    writeOutcomeRun(
      unresolvedFailure,
      runId,
      '# Work\n\nStatus: failed\n\n## Gate Status\n\nWarnings: -\nUnresolved failures: required tests still failing\n',
    );
    expect(validateRunRecord(unresolvedFailure, runId).errors).toContain(
      'unresolved required gate failure: required tests still failing',
    );

    const warningOnly = fixtureRoot('superdense-warning-gate-');
    writeOutcomeRun(
      warningOnly,
      runId,
      '# Work\n\nStatus: complete\n\n## Gate Status\n\nWarnings: diagnostics pending\nUnresolved failures: -\n',
    );
    expect(validateRunRecord(warningOnly, runId)).toEqual({
      errors: [],
      warnings: ['diagnostics pending'],
    });

    const emptyGate = fixtureRoot('superdense-empty-gate-');
    writeOutcomeRun(
      emptyGate,
      runId,
      '# Work\n\nStatus: complete\n\n## Gate Status\n\nOverall: pass\nChecks run: none\nWarnings: -\nUnresolved failures: -\n',
    );
    expect(validateRunRecord(emptyGate, runId)).toEqual({ errors: [], warnings: [] });
  });
});

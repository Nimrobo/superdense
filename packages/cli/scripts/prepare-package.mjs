#!/usr/bin/env node
import { copyFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const cliRoot = resolve(here, '..');
const repoRoot = resolve(cliRoot, '..', '..');

copyFileSync(resolve(repoRoot, 'README.md'), resolve(cliRoot, 'README.md'));
copyFileSync(resolve(repoRoot, 'LICENSE'), resolve(cliRoot, 'LICENSE'));

console.log('[superdense] prepared package README.md and LICENSE from repo root');

#!/usr/bin/env node
import { build } from 'esbuild';
import { cpSync, existsSync, mkdirSync, rmSync, chmodSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const cliRoot = resolve(here, '..');
const repoRoot = resolve(cliRoot, '..', '..');
const distDir = resolve(cliRoot, 'dist');

rmSync(distDir, { recursive: true, force: true });
mkdirSync(distDir, { recursive: true });

const pkg = JSON.parse(readFileSync(resolve(cliRoot, 'package.json'), 'utf8'));
const external = [
  ...Object.keys(pkg.dependencies ?? {}).filter((d) => !d.startsWith('@nimrobo/superdense-')),
  ...Object.keys(pkg.peerDependencies ?? {}),
  ...Object.keys(pkg.optionalDependencies ?? {}),
];

await build({
  entryPoints: [resolve(cliRoot, 'src/index.ts')],
  outfile: resolve(distDir, 'index.js'),
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  external,
  logLevel: 'info',
});

chmodSync(resolve(distDir, 'index.js'), 0o755);

const webDist = resolve(repoRoot, 'packages/web/dist');
if (!existsSync(webDist)) {
  throw new Error(`web dist not found at ${webDist} — run \`pnpm --filter=@nimrobo/superdense-web run build\` first`);
}
cpSync(webDist, resolve(distDir, 'web'), { recursive: true });

const skillsSrc = resolve(repoRoot, 'skills');
if (!existsSync(skillsSrc)) throw new Error(`skills directory not found at ${skillsSrc}`);
cpSync(skillsSrc, resolve(distDir, 'skills'), { recursive: true });

const insightsSrc = resolve(repoRoot, 'packages/core/insights');
if (!existsSync(insightsSrc)) throw new Error(`insights directory not found at ${insightsSrc}`);
cpSync(insightsSrc, resolve(distDir, 'insights'), { recursive: true });

console.log('[superdense] bundled CLI to', distDir);

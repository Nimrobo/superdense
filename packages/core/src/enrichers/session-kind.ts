import { collectFootprint, type FootprintEntry } from './file-footprint.js';
import type { Enricher } from './types.js';

export type SessionKind = 'deliverable' | 'investigation' | 'scaffold' | 'release';

/** Basenames that, when they're the only thing written, mark a release/version bump. */
const RELEASE_BASENAMES = new Set([
  'package.json',
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'changelog.md',
  'cargo.toml',
  'cargo.lock',
  'version',
  'version.txt',
]);

function basename(p: string): string {
  return (p.split('/').pop() ?? p).toLowerCase();
}

/** Investigation scratch dirs — writes here are lineage, not deliverables. */
function isInvestigationDoc(pathRel: string): boolean {
  return /(^|\/)(analysis|notes|scratch)\//.test(pathRel);
}

/**
 * Classify a session from what it WROTE (reads don't make a deliverable):
 * real in-pwd files → deliverable · only ~/.claude plumbing → scaffold ·
 * only manifest/version files → release · nothing real (or only analysis
 * scratch / generated) → investigation.
 */
export function classifySessionKind(files: FootprintEntry[]): SessionKind {
  const written = files.filter((f) => f.writes > 0);
  if (written.length === 0) return 'investigation';

  const deliverables = written.filter(
    (f) => f.role === 'deliverable' && !isInvestigationDoc(f.pathRel),
  );
  if (deliverables.length > 0) {
    if (deliverables.every((f) => RELEASE_BASENAMES.has(basename(f.pathRel)))) return 'release';
    return 'deliverable';
  }
  if (written.some((f) => f.role === 'scaffold')) return 'scaffold';
  return 'investigation';
}

export const sessionKindEnricher: Enricher = {
  name: 'session_kind',
  version: 2,
  returns: 'json',
  alwaysRun: true,
  description:
    'Coarse session classification from its write footprint: deliverable | investigation | scaffold | release. Drives the reward-candidate surfacing filter.',
  async run(ctx) {
    const fp = await collectFootprint(ctx);
    return { v: 1, kind: classifySessionKind(fp.files) };
  },
};

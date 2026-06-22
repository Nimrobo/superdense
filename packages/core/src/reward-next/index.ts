import { getDb, withImmediateTransaction } from '../db.js';
import { getProjectProfileResolution } from '../projects/index.js';
import { retireCollectTargets, retireUnlocatableTargets } from '../rewards/index.js';
import {
  getRewardStatus,
  stageCommand,
  type RewardStatusStageKey,
} from '../reward-status/index.js';

// `reward next` plans the maintenance pipeline in a single call so the run
// preflight does not round-trip `reward status` between every stage. It covers
// only the maintenance stages (profile -> curate -> finalize -> reconcile ->
// collect); `compare` is deliberately excluded because comparison is the main
// run agent's job, not the preflight's. `items` budgets the number of actionable
// items the plan should cover, walked stage by stage in order: each stage takes
// as many of its actionable items as the remaining budget allows. Before
// planning, matured targets are retired (linked collect targets and non-located
// reconcile targets) so the counts reflect the live set. The project's
// reward_next_run_at is stamped each call so a later preflight can tell how
// fresh maintenance is.

const MAINTENANCE_STAGES: RewardStatusStageKey[] = [
  'profile',
  'curate',
  'finalize',
  'reconcile',
  'collect',
];

export const DEFAULT_REWARD_NEXT_ITEMS = 10;

export interface RewardNextStep {
  stage: RewardStatusStageKey;
  actionable: number;
  take: number;
  command: string;
}

export interface RewardNext {
  projectId: string | null;
  projectName: string | null;
  projectRoots: string[];
  lastRunAt: number | null;
  steps: RewardNextStep[];
}

export function getRewardNext(opts: { projectId: string; items?: number }): RewardNext {
  const projectId = opts.projectId;
  if (!projectId) throw new Error('reward next requires a project id');
  let budget = Math.max(0, opts.items ?? DEFAULT_REWARD_NEXT_ITEMS);

  // Retire matured targets first so collect and reconcile counts reflect the
  // live set rather than work that has already aged out.
  retireCollectTargets({ projectId });
  retireUnlocatableTargets({ projectId });
  const status = getRewardStatus({ projectId });
  const byKey = new Map(status.stages.map((stage) => [stage.key, stage]));
  const plan: RewardNextStep[] = [];
  for (const key of MAINTENANCE_STAGES) {
    if (budget <= 0) break;
    const stage = byKey.get(key);
    if (!stage || stage.actionable <= 0) continue;
    const take = Math.min(stage.actionable, budget);
    plan.push({
      stage: key,
      actionable: stage.actionable,
      take,
      command: stageCommand(key, projectId, take),
    });
    budget -= take;
  }

  const resolution = getProjectProfileResolution(projectId);
  const lastRunAt = stampRewardNextRun(projectId);
  return {
    projectId: status.projectId,
    projectName: resolution?.project.name ?? null,
    projectRoots: resolution?.project.roots ?? [],
    lastRunAt,
    steps: plan,
  };
}

// Reads the prior reward_next_run_at (returned to the caller) and stamps the
// current time. Folds onto project_profile; no separate run-log table. Returns
// null when the project cannot be resolved to memoize against.
function stampRewardNextRun(projectId: string): number | null {
  const resolution = getProjectProfileResolution(projectId);
  if (!resolution) return null;
  const canonicalId = resolution.project.id;
  const db = getDb();
  const now = Date.now();
  return withImmediateTransaction(db, () => {
    const row = db
      .prepare('SELECT reward_next_run_at AS at FROM project_profile WHERE id = ?')
      .get(canonicalId) as { at: number | null } | undefined;
    const previous = row?.at ?? null;
    db.prepare('UPDATE project_profile SET reward_next_run_at = ? WHERE id = ?').run(
      now,
      canonicalId,
    );
    return previous;
  });
}

import {
  listCohorts,
  listVersionChains,
  getVersionChain,
  type CohortMember,
} from '../cohorts/index.js';
import { listArtifacts, listArtifactInbox, listCurationInbox } from '../curation/index.js';
import { listExternalizationInbox } from '../externalization/index.js';
import { getProjectProfileResolution, listProjectProfiles } from '../projects/index.js';
import { getArtifactRewards } from '../rewards/index.js';

export type RewardStatusStageKey =
  | 'profile'
  | 'curate'
  | 'finalize'
  | 'reconcile'
  | 'collect'
  | 'compare';

export interface RewardStatusStage {
  key: RewardStatusStageKey;
  label: string;
  unit: string;
  actionable: number;
  skill: string;
}

export interface RewardStatusNextAction {
  stage: RewardStatusStageKey;
  skill: string;
  command: string;
  why: string;
}

export interface RewardStatus {
  projectId: string | null;
  stages: RewardStatusStage[];
  nextAction: RewardStatusNextAction | null;
}

const STAGE_META: Record<
  RewardStatusStageKey,
  Pick<RewardStatusStage, 'label' | 'unit' | 'skill'>
> = {
  profile: { label: 'Profile', unit: 'projects', skill: 'superdense/reward/profile.md' },
  curate: { label: 'Curate', unit: 'sessions', skill: 'superdense/reward/curate.md' },
  finalize: { label: 'Finalize', unit: 'threads', skill: 'superdense/reward/finalize.md' },
  reconcile: {
    label: 'Reconcile',
    unit: 'artifacts',
    skill: 'superdense/reward/reconcile.md',
  },
  collect: { label: 'Collect', unit: 'linked targets', skill: 'superdense/reward/collect.md' },
  compare: { label: 'Compare', unit: 'cohorts', skill: 'superdense/reward/compare.md' },
};

function stage(key: RewardStatusStageKey, actionable: number): RewardStatusStage {
  return { key, ...STAGE_META[key], actionable };
}

function stageCommand(key: RewardStatusStageKey, detail?: string): string {
  const suffix = detail ? ` ${detail}` : '';
  return `Read ${STAGE_META[key].skill}${suffix}`;
}

function profileCount(projectId: string | undefined): { count: number; command: string } {
  if (projectId) {
    const resolution = getProjectProfileResolution(projectId);
    if (!resolution) throw new Error(`project not found: ${projectId}`);
    const project = resolution.project;
    const needsAction = project.status === 'unprofiled' || project.needsHumanAttention;
    return {
      count: needsAction ? 1 : 0,
      command: stageCommand('profile', `for project ${project.id}`),
    };
  }
  const projects = listProjectProfiles({ needsAction: true });
  return {
    count: projects.length,
    command: projects[0]
      ? stageCommand('profile', `for project ${projects[0].id}`)
      : stageCommand('profile'),
  };
}

function countCollectableTargets(projectId: string | undefined): number {
  let count = 0;
  for (const artifact of listArtifacts({ projectId })) {
    const rewards = getArtifactRewards(artifact.id);
    if (!rewards) continue;
    count += rewards.targets.filter((target) => target.snapshots.length === 0).length;
  }
  return count;
}

function memberHasRewards(member: CohortMember): boolean {
  return member.rewards.targets.some((target) => target.snapshots.length > 0);
}

function countComparableOpportunities(projectId: string | undefined): number {
  const canonicalProjectId = projectId ? getProjectProfileResolution(projectId)?.project.id : null;
  const typeCohorts = listCohorts({ projectId, by: 'type' }).filter(
    (cohort) => cohort.withRewardsCount >= 2,
  ).length;
  const connectorCohorts = listCohorts({ projectId, by: 'connector' }).filter(
    (cohort) => cohort.withRewardsCount >= 2,
  ).length;
  const chains = listVersionChains({ projectId }).filter((summary) => {
    const chain = getVersionChain(summary.rootId);
    if (!chain) return false;
    const members = canonicalProjectId
      ? chain.members.filter((member) => member.artifact.projectProfileId === canonicalProjectId)
      : chain.members;
    return members.filter(memberHasRewards).length >= 2;
  }).length;
  return typeCohorts + connectorCohorts + chains;
}

function nextActionFor(
  stages: RewardStatusStage[],
  commands: Partial<Record<RewardStatusStageKey, string>>,
): RewardStatusNextAction | null {
  const upstream = stages.filter((stage) => stage.key !== 'compare');
  const pending = upstream.find((stage) => stage.actionable > 0);
  const compare = stages.find((stage) => stage.key === 'compare');
  const selected = pending ?? (compare && compare.actionable > 0 ? compare : null);
  if (!selected) return null;
  return {
    stage: selected.key,
    skill: selected.skill,
    command: commands[selected.key] ?? selected.skill,
    why: `${selected.actionable} ${selected.unit} at ${selected.label}`,
  };
}

export function getRewardStatus(opts: { projectId?: string } = {}): RewardStatus {
  const projectId = opts.projectId;
  const profile = profileCount(projectId);
  const stages = [
    stage('profile', profile.count),
    stage('curate', listCurationInbox({ projectId, limit: 0 }).remaining),
    stage('finalize', listArtifactInbox({ projectId, limit: 0 }).remaining),
    stage('reconcile', listExternalizationInbox({ projectId, limit: 0 }).remaining),
    stage('collect', countCollectableTargets(projectId)),
    stage('compare', countComparableOpportunities(projectId)),
  ];
  const commands: Partial<Record<RewardStatusStageKey, string>> = {
    profile: profile.command,
    curate: projectId ? stageCommand('curate', `for project ${projectId}`) : stageCommand('curate'),
    finalize: stageCommand('finalize'),
    reconcile: stageCommand('reconcile'),
    collect: stageCommand('collect'),
    compare: stageCommand('compare'),
  };
  return {
    projectId: projectId ?? null,
    stages,
    nextAction: nextActionFor(stages, commands),
  };
}

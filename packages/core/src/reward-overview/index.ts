import { getDb } from '../db.js';
import { listCohorts, type CohortSummary } from '../cohorts/index.js';
import { listCurationInbox, listWorkThreads, type CurationStatus } from '../curation/index.js';
import { listProjectProfiles, type ProjectProfileSummary } from '../projects/index.js';
import {
  getRewardStatus,
  type RewardStatus,
  type RewardStatusNextAction,
  type RewardStatusStage,
  type RewardStatusStageKey,
} from '../reward-status/index.js';

export interface RewardProjectCurationCounts extends Record<CurationStatus, number> {
  remaining: number;
  attachedConsumed: number;
}

export interface RewardProjectThreadCounts {
  open: number;
  ready: number;
  artifact: number;
  total: number;
}

export interface RewardProjectOverview {
  project: ProjectProfileSummary;
  curation: RewardProjectCurationCounts;
  threads: RewardProjectThreadCounts;
  status: RewardStatus;
  nextAction: RewardStatusNextAction | null;
}

export interface RewardOverviewAction {
  stage: RewardStatusStageKey;
  label: string;
  unit: string;
  actionable: number;
  skill: string;
  command: string;
  why: string;
  projectId: string | null;
}

export interface RewardOverview {
  status: RewardStatus;
  actionQueue: RewardOverviewAction[];
  projects: RewardProjectOverview[];
  typeSummaries: CohortSummary[];
}

function canonicalProjectId(projectId: string): string {
  const row = getDb()
    .prepare('SELECT id, covered_by FROM project_profile WHERE id = ?')
    .get(projectId) as { id: string; covered_by: string | null } | undefined;
  if (!row) throw new Error(`project not found: ${projectId}`);
  return row.covered_by ?? row.id;
}

function projectKeys(projectId: string): string[] {
  const canonicalId = canonicalProjectId(projectId);
  const rows = getDb()
    .prepare(
      'SELECT project_key FROM project_profile WHERE id = ? OR covered_by = ? ORDER BY project_key',
    )
    .all(canonicalId, canonicalId) as Array<{ project_key: string }>;
  return rows.map((row) => row.project_key);
}

function countAttachedConsumed(projectId: string): number {
  const keys = projectKeys(projectId);
  if (keys.length === 0) return 0;
  return (
    getDb()
      .prepare(
        `SELECT COUNT(DISTINCT s.id) AS count
           FROM sessions s
           JOIN work_thread_session wts ON wts.session_id = s.id
          WHERE s.is_subagent = 0
            AND s.curation_status = 'consumed'
            AND s.project_key IN (${keys.map(() => '?').join(',')})`,
      )
      .get(...keys) as { count: number }
  ).count;
}

function threadCounts(projectId: string): RewardProjectThreadCounts {
  const counts: RewardProjectThreadCounts = { open: 0, ready: 0, artifact: 0, total: 0 };
  for (const thread of listWorkThreads({ projectId })) {
    counts[thread.lifecycle] += 1;
    counts.total += 1;
  }
  return counts;
}

function projectOverview(project: ProjectProfileSummary): RewardProjectOverview {
  const inbox = listCurationInbox({ projectId: project.id, limit: 0 });
  const status = getRewardStatus({ projectId: project.id });
  return {
    project,
    curation: {
      ...inbox.counts,
      remaining: inbox.remaining,
      attachedConsumed: countAttachedConsumed(project.id),
    },
    threads: threadCounts(project.id),
    status,
    nextAction: status.nextAction,
  };
}

function defaultCommand(stage: RewardStatusStage): string {
  return `Read ${stage.skill}`;
}

function actionForStage(
  stage: RewardStatusStage,
  globalStatus: RewardStatus,
  projects: RewardProjectOverview[],
): RewardOverviewAction | null {
  if (stage.actionable <= 0) return null;
  const projectMatch = projects.find((project) => project.nextAction?.stage === stage.key);
  const next =
    globalStatus.nextAction?.stage === stage.key
      ? globalStatus.nextAction
      : (projectMatch?.nextAction ?? null);
  return {
    stage: stage.key,
    label: stage.label,
    unit: stage.unit,
    actionable: stage.actionable,
    skill: stage.skill,
    command: next?.command ?? defaultCommand(stage),
    why: next?.why ?? `${stage.actionable} ${stage.unit} at ${stage.label}`,
    projectId: projectMatch?.project.id ?? null,
  };
}

export function getRewardOverview(): RewardOverview {
  const status = getRewardStatus();
  const projects = listProjectProfiles().map(projectOverview);
  return {
    status,
    actionQueue: status.stages
      .map((stage) => actionForStage(stage, status, projects))
      .filter((action): action is RewardOverviewAction => action !== null),
    projects,
    typeSummaries: listCohorts({ by: 'type' }),
  };
}

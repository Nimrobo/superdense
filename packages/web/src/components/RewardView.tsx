import { useEffect, useMemo, useState } from 'react';
import {
  api,
  type ArtifactExternalization,
  type ArtifactRewards,
  type CohortMember,
  type RewardOverview,
  type RewardProjectOverview,
  type WorkThread,
} from '../api.js';
import { formatArtifactCostBadge } from '../costDisplay.js';
import { RewardTargetList } from '../rewardDisplay.js';
import { formatRelativeTime, projectLabel } from '../sessionDisplay.js';
import { WorkThreadView } from './WorkThreadView.js';

interface Props {
  onOpenSession: (id: string) => void;
}

type Detail =
  | { kind: 'projects' }
  | { kind: 'project'; id: string }
  | { kind: 'type'; type: string }
  | { kind: 'thread'; id: string }
  | null;

type ArtifactDetail = {
  externalization: ArtifactExternalization | null;
  rewards: ArtifactRewards | null;
};

const LAYER_HELP = [
  ['Project profile', 'Teaches Superdense what this project is and what outputs matter.'],
  ['Workthread', 'Grouped agent sessions that appear to have produced one output.'],
  ['Artifact', 'The finalized output, folded into the workthread that produced it.'],
  ['Externalization', 'Where that artifact exists outside Superdense.'],
  ['Reward', 'Metric snapshots collected from the linked external target.'],
];

function payloadPreview(payload: Record<string, unknown> | null): string {
  if (!payload) return '';
  if (typeof payload.text === 'string') return payload.text;
  if (Array.isArray(payload.files)) return (payload.files as unknown[]).join(', ');
  return JSON.stringify(payload);
}

function projectName(project: RewardProjectOverview['project']): string {
  return project.name ?? projectLabel(project.projectKey);
}

function lifecycleLabel(thread: WorkThread): string {
  if (thread.lifecycle === 'artifact') return thread.artifactType ?? 'artifact';
  return thread.lifecycle === 'ready' ? 'ready to finalize' : 'open';
}

function pendingPipelineUnit(stage: RewardOverview['status']['stages'][number]): string {
  switch (stage.key) {
    case 'profile':
      return 'project profile';
    case 'curate':
      return 'session curation';
    case 'finalize':
      return 'artifact finalization';
    case 'reconcile':
      return 'externalization';
    case 'collect':
      return 'reward collection';
    case 'compare':
      return 'cohort comparison';
  }
}

function PendingPipeline({
  overview,
  onCopy,
}: {
  overview: RewardOverview;
  onCopy: (text: string) => void;
}) {
  const actionByStage = new Map(
    overview.actionQueue
      .filter((action) => action.stage !== 'compare')
      .map((action) => [action.stage, action]),
  );
  const pendingStages = overview.status.stages
    .filter((stage) => stage.key !== 'compare')
    .map((stage) => ({ stage, action: actionByStage.get(stage.key) }))
    .filter(({ stage, action }) => action || stage.actionable > 0);

  return (
    <section className="card reward-section">
      <div className="section-heading">
        <div>
          <div className="card-title">Pending Pipeline</div>
          <div className="muted small">
            Pending reward-layer work by stage. Copy a prompt to run the next agent pass for that
            part of the pipeline.
          </div>
        </div>
      </div>
      {pendingStages.length === 0 ? (
        <div className="empty compact">No pending reward-layer actions.</div>
      ) : (
        <div className="pending-pipeline-list">
          {pendingStages.map(({ stage, action }) => {
            const command = action?.command ?? `Read ${stage.skill}`;
            const pendingCount = action?.actionable ?? stage.actionable;
            const unit = pendingPipelineUnit(stage);
            const why = `${pendingCount} ${unit} pending`;
            return (
              <div key={stage.key} className="pending-pipeline-tile">
                <div className="pending-pipeline-detail">
                  <div className="project-card-top">
                    <strong>{stage.label}</strong>
                    <span className="project-status">{stage.key}</span>
                  </div>
                  <div className="muted small">{why}</div>
                </div>
                <button
                  className="copy-btn pending-pipeline-copy"
                  type="button"
                  onClick={() => onCopy(command)}
                >
                  Copy Prompt
                </button>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function ProjectLanding({
  projects,
  onOpenProjects,
}: {
  projects: RewardProjectOverview[];
  onOpenProjects: () => void;
}) {
  const needsProfile = projects.filter(
    (item) => item.project.status === 'unprofiled' || item.project.needsHumanAttention,
  ).length;
  const profiled = projects.length - needsProfile;
  const pending = projects.reduce((sum, item) => sum + item.curation.remaining, 0);
  const artifacts = projects.reduce((sum, item) => sum + item.threads.artifact, 0);
  return (
    <section className="card reward-section">
      <div className="card-title">Projects</div>
      <div className="muted small">
        Open the project page to see what is profiled, what still needs attention, and how much
        reviewed session work is attached to workthreads.
      </div>
      <button type="button" className="project-card" onClick={onOpenProjects}>
        <div className="project-card-top">
          <strong>Project progress</strong>
          <span className="project-status">{projects.length} projects</span>
        </div>
        <div className="stat-row">
          <span>profiled {profiled}</span>
          <span>needs profile {needsProfile}</span>
          <span>pending sessions {pending}</span>
          <span>artifacts {artifacts}</span>
        </div>
      </button>
    </section>
  );
}

function ProjectPage({
  projects,
  onBack,
  onOpenProject,
}: {
  projects: RewardProjectOverview[];
  onBack: () => void;
  onOpenProject: (id: string) => void;
}) {
  return (
    <>
      <div className="work-header">
        <button className="back-btn" onClick={onBack}>
          Back
        </button>
        <div className="work-heading">
          <div className="work-title">Projects</div>
          <div className="work-sub">Profile status, session review progress, and workthreads</div>
        </div>
      </div>
      <div className="work-body">
        <ProjectProgress projects={projects} onOpenProject={onOpenProject} />
      </div>
    </>
  );
}

function ProjectsSectionList({
  items,
  empty,
  onOpenProject,
}: {
  items: RewardProjectOverview[];
  empty: string;
  onOpenProject: (id: string) => void;
}) {
  return items.length === 0 ? (
    <div className="empty compact">{empty}</div>
  ) : (
    items.map((item) => (
      <ProjectSummaryCard key={item.project.id} item={item} onOpenProject={onOpenProject} />
    ))
  );
}

function ConceptHelp() {
  return (
    <section className="card reward-section">
      <div className="card-title">Concepts</div>
      <div className="concept-grid">
        {LAYER_HELP.map(([term, detail]) => (
          <div key={term} className="concept-item">
            <strong>{term}</strong>
            <span>{detail}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function ProjectProgress({
  projects,
  onOpenProject,
}: {
  projects: RewardProjectOverview[];
  onOpenProject: (id: string) => void;
}) {
  const unprofiled = projects.filter(
    (item) => item.project.status === 'unprofiled' || item.project.needsHumanAttention,
  );
  const profiled = projects.filter(
    (item) => item.project.status !== 'unprofiled' && !item.project.needsHumanAttention,
  );

  return (
    <section className="card reward-section">
      <div className="section-heading">
        <div>
          <div className="card-title">Projects</div>
          <div className="muted small">
            See what is profiled, what is not, and how much reviewed session work is attached to
            workthreads.
          </div>
        </div>
      </div>
      <div className="project-columns">
        <div>
          <div className="card-subtitle">Needs profile or attention</div>
          <ProjectsSectionList
            items={unprofiled}
            empty="All visible projects are profiled."
            onOpenProject={onOpenProject}
          />
        </div>
        <div>
          <div className="card-subtitle">Profiled projects</div>
          <ProjectsSectionList
            items={profiled}
            empty="No profiled projects yet."
            onOpenProject={onOpenProject}
          />
        </div>
      </div>
    </section>
  );
}

function ProjectSummaryCard({
  item,
  onOpenProject,
}: {
  item: RewardProjectOverview;
  onOpenProject: (id: string) => void;
}) {
  const totalReviewed = item.curation.consumed + item.curation.skipped;
  return (
    <button type="button" className="project-card" onClick={() => onOpenProject(item.project.id)}>
      <div className="project-card-top">
        <strong>{projectName(item.project)}</strong>
        <span
          className={`project-status ${
            item.project.status === 'unprofiled' || item.project.needsHumanAttention
              ? 'attention'
              : ''
          }`}
        >
          {item.project.status === 'unprofiled'
            ? 'needs profile'
            : item.project.needsHumanAttention
              ? 'needs attention'
              : 'profiled'}
        </span>
      </div>
      <div className="project-card-description ellipsis">{item.project.projectKey}</div>
      <div className="stat-row">
        <span>pending {item.curation.pending}</span>
        <span>deferred {item.curation.deferred}</span>
        <span>reviewed {totalReviewed}</span>
        <span>attached {item.curation.attachedConsumed}</span>
      </div>
      <div className="muted small">
        {item.threads.open} open threads · {item.threads.ready} ready · {item.threads.artifact}{' '}
        artifacts
      </div>
    </button>
  );
}

function RewardsByType({
  overview,
  onOpenType,
}: {
  overview: RewardOverview;
  onOpenType: (type: string) => void;
}) {
  return (
    <section className="card reward-section">
      <div className="card-title">Rewards by Type</div>
      <div className="muted small">
        Finalized artifacts grouped by output type. Open a type to inspect linked targets, metrics,
        and comparison readiness.
      </div>
      {overview.typeSummaries.length === 0 ? (
        <div className="empty compact">No finalized artifacts yet.</div>
      ) : (
        <div className="type-list">
          {overview.typeSummaries.map((type) => (
            <button
              key={type.type}
              type="button"
              className="project-card"
              onClick={() => onOpenType(type.type)}
            >
              <div className="project-card-top">
                <strong>{type.type}</strong>
                <span className="project-status">{type.artifactCount} artifacts</span>
              </div>
              <div className="stat-row">
                <span>linked {type.externalizedCount}</span>
                <span>rewarded {type.withRewardsCount}</span>
                <span>{type.withRewardsCount >= 2 ? 'compare ready' : 'needs more reward'}</span>
              </div>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

function FoldedThreadCard({
  thread,
  artifactDetail,
  onOpenThread,
}: {
  thread: WorkThread;
  artifactDetail?: ArtifactDetail;
  onOpenThread: (id: string) => void;
}) {
  const rewardTargets = artifactDetail?.rewards?.targets ?? [];
  return (
    <div className="project-card" style={{ cursor: 'default' }}>
      <div className="project-card-top">
        <strong>{thread.provisionalTitle}</strong>
        <div className="project-card-badges">
          <span className="project-status">{lifecycleLabel(thread)}</span>
          {thread.humanOnly && <span className="project-status">Human only</span>}
        </div>
      </div>
      {thread.summary && <div className="project-card-description">{thread.summary}</div>}
      <div className="muted small">
        updated {formatRelativeTime(thread.updatedAt)}
        {thread.readyAt ? ` · ready ${formatRelativeTime(thread.readyAt)}` : ''}
      </div>
      {thread.lifecycle === 'artifact' && (
        <div className="folded-artifact">
          <div className="card-subtitle">Folded artifact</div>
          <div className="project-card-description ellipsis">
            {payloadPreview(thread.payload) || 'No payload preview.'}
          </div>
          <div className="muted small">
            externalization {artifactDetail?.externalization?.status ?? 'unprocessed'}
          </div>
          <RewardTargetList targets={rewardTargets} />
        </div>
      )}
      <button
        type="button"
        className="back-btn thread-open"
        onClick={() => onOpenThread(thread.id)}
      >
        Open workthread
      </button>
    </div>
  );
}

function ProjectDetail({
  item,
  onBack,
  onOpenThread,
}: {
  item: RewardProjectOverview;
  onBack: () => void;
  onOpenThread: (id: string) => void;
}) {
  const [threads, setThreads] = useState<WorkThread[] | null>(null);
  const [artifactDetails, setArtifactDetails] = useState<Record<string, ArtifactDetail>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setThreads(null);
    setArtifactDetails({});
    api
      .listThreads({ projectId: item.project.id })
      .then(async (result) => {
        setThreads(result.items);
        const artifacts = result.items.filter((thread) => thread.lifecycle === 'artifact');
        const pairs = await Promise.all(
          artifacts.map(async (thread) => {
            const detail = await api.getArtifact(thread.id);
            return [
              thread.id,
              { externalization: detail.externalization, rewards: detail.rewards },
            ] as const;
          }),
        );
        setArtifactDetails(Object.fromEntries(pairs));
        setError(null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [item.project.id]);

  const byLifecycle = useMemo(
    () => ({
      open: (threads ?? []).filter((thread) => thread.lifecycle === 'open'),
      ready: (threads ?? []).filter((thread) => thread.lifecycle === 'ready'),
      artifact: (threads ?? []).filter((thread) => thread.lifecycle === 'artifact'),
    }),
    [threads],
  );

  return (
    <>
      <div className="work-header">
        <button className="back-btn" onClick={onBack}>
          Back
        </button>
        <div className="work-heading">
          <div className="work-title">{projectName(item.project)}</div>
          <div className="work-sub">Project reward progress and workthreads</div>
        </div>
      </div>
      <div className="work-body">
        {error && <div className="error">Failed to load: {error}</div>}
        <section className="card reward-section">
          <div className="card-title">Profile and Review Progress</div>
          <div className="muted small">
            Profile status is the project map. Session review progress shows how much raw agent work
            has been consumed into reward curation.
          </div>
          <div className="stat-row large">
            <span>pending {item.curation.pending}</span>
            <span>deferred {item.curation.deferred}</span>
            <span>consumed {item.curation.consumed}</span>
            <span>skipped {item.curation.skipped}</span>
            <span>attached {item.curation.attachedConsumed}</span>
          </div>
          {item.project.evidenceSummary.length > 0 && (
            <ul className="plain-list">
              {item.project.evidenceSummary.map((evidence, index) => (
                <li key={index}>{evidence}</li>
              ))}
            </ul>
          )}
          {item.nextAction && <pre className="command-box">{item.nextAction.command}</pre>}
        </section>

        {!threads && !error && <div className="empty">Loading workthreads...</div>}
        {threads && threads.length === 0 && <div className="empty">No workthreads yet.</div>}
        {(['open', 'ready', 'artifact'] as const).map((lifecycle) => (
          <section key={lifecycle} className="card reward-section">
            <div className="card-title">
              {lifecycle === 'artifact'
                ? 'Artifacts'
                : lifecycle === 'ready'
                  ? 'Ready to Finalize'
                  : 'Open Workthreads'}
            </div>
            {byLifecycle[lifecycle].length === 0 ? (
              <div className="empty compact">None.</div>
            ) : (
              byLifecycle[lifecycle].map((thread) => (
                <FoldedThreadCard
                  key={thread.id}
                  thread={thread}
                  artifactDetail={artifactDetails[thread.id]}
                  onOpenThread={onOpenThread}
                />
              ))
            )}
          </section>
        ))}
      </div>
    </>
  );
}

function TypeDetail({
  type,
  onBack,
  onOpenThread,
}: {
  type: string;
  onBack: () => void;
  onOpenThread: (id: string) => void;
}) {
  const [members, setMembers] = useState<CohortMember[] | null>(null);
  const [projects, setProjects] = useState<Map<string, string>>(new Map());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api.getCohort(type), api.listProjects()])
      .then(([cohort, projectResult]) => {
        setMembers(cohort.cohort.members);
        setProjects(
          new Map(
            projectResult.items.map((project) => [
              project.id,
              project.name ?? projectLabel(project.projectKey),
            ]),
          ),
        );
        setError(null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [type]);

  const rewardedCount =
    members?.filter((member) =>
      member.rewards.targets.some((target) => target.snapshots.length > 0),
    ).length ?? 0;

  return (
    <>
      <div className="work-header">
        <button className="back-btn" onClick={onBack}>
          Back
        </button>
        <div className="work-heading">
          <div className="work-title">{type}</div>
          <div className="work-sub">Reward results for this artifact type</div>
        </div>
      </div>
      <div className="work-body">
        {error && <div className="error">Failed to load: {error}</div>}
        <section className="card reward-section">
          <div className="card-title">Comparison Readiness</div>
          <div className="muted small">
            A type becomes useful for comparison when at least two artifacts have reward snapshots.
          </div>
          <div className="stat-row large">
            <span>artifacts {members?.length ?? 0}</span>
            <span>rewarded {rewardedCount}</span>
            <span>{rewardedCount >= 2 ? 'compare ready' : 'not compare ready'}</span>
          </div>
        </section>
        {!members && !error && <div className="empty">Loading rewards...</div>}
        {members?.map((member) => {
          const cost = formatArtifactCostBadge(member.cost);
          return (
            <div key={member.artifact.id} className="project-card" style={{ cursor: 'default' }}>
              <div className="project-card-top">
                <strong>{member.artifact.provisionalTitle}</strong>
                <div className="project-card-badges">
                  <span className="project-status">
                    {projects.get(member.artifact.projectProfileId) ??
                      member.artifact.projectProfileId}
                  </span>
                  {member.artifact.humanOnly && <span className="project-status">Human only</span>}
                  {cost && <span className="artifact-cost-badge">{cost}</span>}
                </div>
              </div>
              <div className="project-card-description ellipsis">
                {payloadPreview(member.artifact.payload)}
              </div>
              <div className="muted small">
                finalized{' '}
                {formatRelativeTime(
                  member.artifact.artifactFinalizedAt ?? member.artifact.updatedAt,
                )}{' '}
                · externalization {member.externalization?.status ?? 'unprocessed'}
              </div>
              <RewardTargetList targets={member.rewards.targets} />
              <button
                type="button"
                className="back-btn thread-open"
                onClick={() => onOpenThread(member.artifact.id)}
              >
                Open workthread
              </button>
            </div>
          );
        })}
      </div>
    </>
  );
}

export function RewardView({ onOpenSession }: Props) {
  const [overview, setOverview] = useState<RewardOverview | null>(null);
  const [detail, setDetail] = useState<Detail>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    api
      .rewardOverview()
      .then((result) => {
        setOverview(result);
        setError(null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  const copy = async (text: string) => {
    await navigator.clipboard.writeText(text);
    setToast('Instruction copied. Paste it into Claude Code or Codex.');
    setTimeout(() => setToast(null), 4000);
  };

  if (detail?.kind === 'thread') {
    return (
      <>
        <WorkThreadView
          id={detail.id}
          onBack={() => setDetail(null)}
          onOpenSession={onOpenSession}
        />
        {toast && <div className="toast">{toast}</div>}
      </>
    );
  }

  if (detail?.kind === 'projects' && overview) {
    return (
      <ProjectPage
        projects={overview.projects}
        onBack={() => setDetail(null)}
        onOpenProject={(id) => setDetail({ kind: 'project', id })}
      />
    );
  }

  if (detail?.kind === 'project' && overview) {
    const item = overview.projects.find((project) => project.project.id === detail.id);
    if (item) {
      return (
        <ProjectDetail
          item={item}
          onBack={() => setDetail(null)}
          onOpenThread={(id) => setDetail({ kind: 'thread', id })}
        />
      );
    }
  }

  if (detail?.kind === 'type') {
    return (
      <TypeDetail
        type={detail.type}
        onBack={() => setDetail(null)}
        onOpenThread={(id) => setDetail({ kind: 'thread', id })}
      />
    );
  }

  return (
    <>
      <div className="work-header">
        <div>
          <div className="work-title">Reward</div>
          <div className="work-sub">
            Concepts, pending pipeline, project progress, and final reward outcomes.
          </div>
        </div>
      </div>
      <div className="work-body reward-page">
        {error && <div className="error">Failed to load: {error}</div>}
        {!overview && !error && <div className="empty">Loading reward overview...</div>}
        {overview && (
          <>
            <ConceptHelp />
            <PendingPipeline overview={overview} onCopy={copy} />
            <ProjectLanding
              projects={overview.projects}
              onOpenProjects={() => setDetail({ kind: 'projects' })}
            />
            <RewardsByType
              overview={overview}
              onOpenType={(type) => setDetail({ kind: 'type', type })}
            />
          </>
        )}
        {toast && <div className="toast">{toast}</div>}
      </div>
    </>
  );
}

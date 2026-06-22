import { useEffect, useState } from 'react';
import {
  api,
  type CohortMember,
  type Experiment,
  type ExperimentRewardWindow,
  type Hypothesis,
  type PredictionTarget,
  type RewardOverview,
  type RewardProjectOverview,
} from '../api.js';
import { formatArtifactCostBadge } from '../costDisplay.js';
import { RewardTargetList } from '../rewardDisplay.js';
import { formatFullTime, formatRelativeTime, projectLabel } from '../sessionDisplay.js';
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

function directionSymbol(direction: PredictionTarget['direction']): string {
  if (direction === 'increase') return 'up';
  if (direction === 'decrease') return 'down';
  return 'hold';
}

function predictionText(target: PredictionTarget): string {
  return `${target.metric} ${directionSymbol(target.direction)} by ${target.magnitude}`;
}

function formatDuration(ms: number): string {
  const day = 24 * 60 * 60 * 1000;
  const hour = 60 * 60 * 1000;
  if (ms % day === 0) return `${ms / day}d`;
  if (ms % hour === 0) return `${ms / hour}h`;
  return `${ms}ms`;
}

function hypothesisWindow(hypothesis: Hypothesis): string {
  const { window } = hypothesis.statement;
  return window.label ?? formatDuration(window.durationMs);
}

function rewardWindow(window: ExperimentRewardWindow): string {
  if (window.label) return window.label;
  if (window.startAt != null && window.endAt != null) {
    return `${formatFullTime(window.startAt)} to ${formatFullTime(window.endAt)}`;
  }
  if (window.durationMs != null) return formatDuration(window.durationMs);
  return 'open window';
}

function compactValue(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function observedReason(experiment: Experiment): string | null {
  const reason = experiment.observedSummary?.reason;
  return typeof reason === 'string' ? reason : null;
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

function RewardProjectPipeline({ item }: { item: RewardProjectOverview }) {
  const stages = item.status.stages.filter(
    (stage) => stage.key !== 'profile' && stage.key !== 'compare',
  );
  return (
    <section className="card reward-section">
      <div className="card-title">Reward Pipeline</div>
      <div className="pipeline-grid pipeline-grid-four">
        {stages.map((stage) => (
          <div key={stage.key} className="pipeline-stage">
            <div className="project-card-top">
              <strong>{stage.label}</strong>
              <span className={`project-status ${stage.actionable > 0 ? 'attention' : ''}`}>
                {stage.key}
              </span>
            </div>
            <div className="pipeline-count">{stage.actionable}</div>
            <div className="muted small">{stage.unit} actionable</div>
          </div>
        ))}
      </div>
    </section>
  );
}

function HypothesisRow({
  hypothesis,
  experimentCount,
  selected,
  onSelect,
}: {
  hypothesis: Hypothesis;
  experimentCount: number;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <button
      type="button"
      className={`hypothesis-row ${selected ? 'selected' : ''}`}
      onClick={() => onSelect(hypothesis.id)}
    >
      <div className="hypothesis-row-main">
        <div className="hypothesis-row-title">
          <strong>{hypothesis.statement.action}</strong>
          <span className="muted small">{hypothesis.statement.mechanism}</span>
        </div>
        <div className="project-card-badges">
          <span className="project-status">{hypothesis.leverKey}</span>
          <span className={`project-status hypothesis-${hypothesis.status}`}>
            {hypothesis.status}
          </span>
        </div>
      </div>
      <div className="hypothesis-row-meta">
        <span>diagnostic {predictionText(hypothesis.statement.diagnostic)}</span>
        <span>north star {predictionText(hypothesis.statement.northStar)}</span>
        <span>window {hypothesisWindow(hypothesis)}</span>
        <span>experiments {experimentCount}</span>
      </div>
      {hypothesis.verdictEvidence && (
        <div className="muted small">Evidence: {compactValue(hypothesis.verdictEvidence)}</div>
      )}
    </button>
  );
}

function RewardHypothesesSection({
  hypotheses,
  experiments,
  selectedHypothesisId,
  loading,
  onSelect,
}: {
  hypotheses: Hypothesis[];
  experiments: Experiment[];
  selectedHypothesisId: string | null;
  loading: boolean;
  onSelect: (id: string) => void;
}) {
  const experimentCounts = new Map<string, number>();
  for (const experiment of experiments) {
    experimentCounts.set(
      experiment.hypothesisId,
      (experimentCounts.get(experiment.hypothesisId) ?? 0) + 1,
    );
  }
  return (
    <section className="card reward-section">
      <div className="card-title">Hypotheses</div>
      {loading && hypotheses.length === 0 ? (
        <div className="empty compact">Loading hypotheses...</div>
      ) : hypotheses.length === 0 ? (
        <div className="empty compact">No hypotheses recorded for this project.</div>
      ) : (
        <div className="hypothesis-list">
          {hypotheses.map((hypothesis) => (
            <HypothesisRow
              key={hypothesis.id}
              hypothesis={hypothesis}
              experimentCount={experimentCounts.get(hypothesis.id) ?? 0}
              selected={hypothesis.id === selectedHypothesisId}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function RewardExperimentCard({ experiment }: { experiment: Experiment }) {
  const reason = observedReason(experiment);
  const checks = experiment.observedSummary?.checks;
  return (
    <div className="project-card" style={{ cursor: 'default' }}>
      <div className="project-card-top">
        <strong>{experiment.id}</strong>
        <div className="project-card-badges">
          <span className="project-status">{experiment.status}</span>
          {experiment.verdict && (
            <span className={`project-status hypothesis-${experiment.verdict}`}>
              {experiment.verdict}
            </span>
          )}
        </div>
      </div>
      <div className="project-card-description">{experiment.predictedSummary}</div>
      <div className="stat-row">
        <span>
          reps {experiment.members.length}/{experiment.targetReps}
        </span>
        <span>window {rewardWindow(experiment.rewardWindow)}</span>
      </div>
      {reason && <div className="muted small">Observed: {reason}</div>}
      {checks != null && <div className="muted small">Checks: {compactValue(checks)}</div>}
      {experiment.members.length > 0 && (
        <ul className="plain-list experiment-member-list">
          {experiment.members.map((member) => (
            <li key={`${member.runId}-${member.role}`} className="small">
              <span className="mono">{member.runId}</span>
              {member.artifactId ? (
                <>
                  {' -> '}
                  <span className="mono">{member.artifactId}</span>
                </>
              ) : null}{' '}
              <span className="muted">({member.role})</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function RewardExperimentsSection({
  selectedHypothesis,
  experiments,
  loading,
}: {
  selectedHypothesis: Hypothesis | null;
  experiments: Experiment[];
  loading: boolean;
}) {
  return (
    <section className="card reward-section">
      <div className="card-title">Experiments</div>
      {loading ? (
        <div className="empty compact">Loading experiments...</div>
      ) : !selectedHypothesis ? (
        <div className="empty compact">Select a hypothesis to view its experiments.</div>
      ) : experiments.length === 0 ? (
        <div className="empty compact">No experiments recorded for this hypothesis.</div>
      ) : (
        <>
          <div className="selected-hypothesis-context">
            <strong>{selectedHypothesis.statement.action}</strong>
            <span className="muted small">{selectedHypothesis.id}</span>
          </div>
          {experiments.map((experiment) => (
            <RewardExperimentCard key={experiment.id} experiment={experiment} />
          ))}
        </>
      )}
    </section>
  );
}

function ProjectDetail({ item, onBack }: { item: RewardProjectOverview; onBack: () => void }) {
  const [hypotheses, setHypotheses] = useState<Hypothesis[]>([]);
  const [experiments, setExperiments] = useState<Experiment[]>([]);
  const [selectedHypothesisId, setSelectedHypothesisId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setHypotheses([]);
    setExperiments([]);
    setSelectedHypothesisId(null);
    setLoading(true);
    const emptyHypotheses = { items: [] as Hypothesis[] };
    const emptyExperiments = { items: [] as Experiment[] };
    Promise.all([
      api.listHypotheses({ projectId: item.project.id }).catch(() => emptyHypotheses),
      api.listExperiments({ projectId: item.project.id }).catch(() => emptyExperiments),
    ])
      .then(([hypothesisResult, experimentResult]) => {
        setHypotheses(hypothesisResult.items);
        setExperiments(experimentResult.items);
        setError(null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, [item.project.id]);

  const selectedHypothesis =
    hypotheses.find((hypothesis) => hypothesis.id === selectedHypothesisId) ?? null;
  const selectedExperiments = selectedHypothesis
    ? experiments.filter((experiment) => experiment.hypothesisId === selectedHypothesis.id)
    : [];

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
        <RewardProjectPipeline item={item} />
        <RewardHypothesesSection
          hypotheses={hypotheses}
          experiments={experiments}
          selectedHypothesisId={selectedHypothesisId}
          loading={loading}
          onSelect={setSelectedHypothesisId}
        />
        <RewardExperimentsSection
          selectedHypothesis={selectedHypothesis}
          experiments={selectedExperiments}
          loading={loading}
        />
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
      return <ProjectDetail item={item} onBack={() => setDetail(null)} />;
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

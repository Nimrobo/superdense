import { useEffect, useState } from 'react';
import {
  api,
  type ArtifactShape,
  type Experiment,
  type ExperimentRewardWindow,
  type Hypothesis,
  type PredictionTarget,
  type Project,
  type RewardProjectOverview,
} from '../api.js';
import { formatFullTime, projectLabel } from '../sessionDisplay.js';

interface Props {
  id: string;
  onBack: () => void;
}

function shapeDetail(shape: ArtifactShape): string {
  if (shape.detector.kind === 'folder-leaf' || shape.detector.kind === 'file-glob') {
    return shape.detector.include.join(', ');
  }
  return shape.detector.kind === 'branch' ? 'branch / plan thread' : 'entire project surface';
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

function PipelineSection({
  overview,
  loading,
  onCopy,
}: {
  overview: RewardProjectOverview | null;
  loading: boolean;
  onCopy: (text: string) => void;
}) {
  return (
    <section className="card project-reward-section">
      <div className="project-detail-actions">
        <div>
          <div className="card-title">Reward Pipeline</div>
          <div className="muted small">
            Project-specific reward-layer progress from profile through comparison.
          </div>
        </div>
        {overview?.nextAction && (
          <button className="copy-btn" onClick={() => onCopy(overview.nextAction?.command ?? '')}>
            Copy next action
          </button>
        )}
      </div>
      {loading && !overview ? (
        <div className="empty compact">Loading reward pipeline...</div>
      ) : !overview ? (
        <div className="empty compact">No reward pipeline available.</div>
      ) : (
        <>
          <div className="pipeline-grid">
            {overview.status.stages.map((stage) => (
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
          <div className="stat-row large">
            <span>pending {overview.curation.pending}</span>
            <span>reviewed {overview.curation.consumed + overview.curation.skipped}</span>
            <span>attached {overview.curation.attachedConsumed}</span>
            <span>open threads {overview.threads.open}</span>
            <span>ready {overview.threads.ready}</span>
            <span>artifacts {overview.threads.artifact}</span>
          </div>
          {overview.nextAction && <pre className="command-box">{overview.nextAction.command}</pre>}
        </>
      )}
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

function HypothesesSection({
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
    <section className="card project-reward-section">
      <div className="card-title">Hypotheses</div>
      <div className="muted small">Select a hypothesis row to inspect its experiments.</div>
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

function ExperimentCard({ experiment }: { experiment: Experiment }) {
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

function ExperimentsSection({
  selectedHypothesis,
  experiments,
  loading,
}: {
  selectedHypothesis: Hypothesis | null;
  experiments: Experiment[];
  loading: boolean;
}) {
  return (
    <section className="card project-reward-section">
      <div className="card-title">Experiments</div>
      <div className="muted small">Experiments for the selected hypothesis.</div>
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
            <ExperimentCard key={experiment.id} experiment={experiment} />
          ))}
        </>
      )}
    </section>
  );
}

export function ProjectView({ id, onBack }: Props) {
  const [project, setProject] = useState<Project | null>(null);
  const [redirectedFrom, setRedirectedFrom] = useState<string | null>(null);
  const [rewardOverview, setRewardOverview] = useState<RewardProjectOverview | null>(null);
  const [hypotheses, setHypotheses] = useState<Hypothesis[]>([]);
  const [experiments, setExperiments] = useState<Experiment[]>([]);
  const [selectedHypothesisId, setSelectedHypothesisId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const refresh = () => {
    setProject(null);
    setRewardOverview(null);
    setHypotheses([]);
    setExperiments([]);
    setSelectedHypothesisId(null);
    setDetailError(null);
    api
      .getProject(id)
      .then(async (result) => {
        setProject(result.project);
        setRedirectedFrom(result.redirectedFrom);
        setError(null);
        setLoadingDetails(true);
        try {
          const [overviewResult, hypothesisResult, experimentResult] = await Promise.all([
            api.getProjectRewardOverview(result.project.id),
            api.listHypotheses({ projectId: result.project.id }),
            api.listExperiments({ projectId: result.project.id }),
          ]);
          setRewardOverview(overviewResult.item);
          setHypotheses(hypothesisResult.items);
          setExperiments(experimentResult.items);
          setDetailError(null);
        } catch (err) {
          setDetailError(err instanceof Error ? err.message : String(err));
        } finally {
          setLoadingDetails(false);
        }
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  };

  useEffect(refresh, [id]);

  const command = `Read superdense/reward/profile.md for project ${project?.id ?? id}`;
  const copyCommand = async () => {
    await navigator.clipboard.writeText(command);
    setToast('Profiling instruction copied. Paste it into Claude Code or Codex.');
    setTimeout(() => setToast(null), 4000);
  };

  const copyRewardCommand = async (text: string) => {
    await navigator.clipboard.writeText(text);
    setToast('Reward instruction copied. Paste it into Claude Code or Codex.');
    setTimeout(() => setToast(null), 4000);
  };

  const toggleAttention = async () => {
    if (!project) return;
    try {
      const result = await api.setProjectAttention(
        project.id,
        !project.needsHumanAttention,
        project.needsHumanAttention ? undefined : ['Marked for human attention in Studio'],
      );
      setProject(result.project);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  if (error)
    return (
      <div className="work-body">
        <div className="error">Failed to load: {error}</div>
      </div>
    );
  if (!project) return <div className="empty">Loading...</div>;

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
          <div className="work-title">{project.name ?? projectLabel(project.projectKey)}</div>
          <div className="work-sub">{project.projectKey}</div>
        </div>
      </div>
      <div className="work-body project-detail">
        {redirectedFrom && (
          <div className="notice">
            This covered project record redirects to its canonical profile.
          </div>
        )}
        {detailError && (
          <div className="error">Failed to load project reward data: {detailError}</div>
        )}

        <PipelineSection
          overview={rewardOverview}
          loading={loadingDetails}
          onCopy={copyRewardCommand}
        />

        <HypothesesSection
          hypotheses={hypotheses}
          experiments={experiments}
          selectedHypothesisId={selectedHypothesisId}
          loading={loadingDetails}
          onSelect={setSelectedHypothesisId}
        />

        <ExperimentsSection
          selectedHypothesis={selectedHypothesis}
          experiments={selectedExperiments}
          loading={loadingDetails}
        />

        <section className="card">
          <div className="project-detail-actions">
            <div>
              <div className="card-title">Profile status</div>
              <div
                className={`project-status ${project.status === 'unprofiled' || project.needsHumanAttention ? 'attention' : ''}`}
              >
                {project.status === 'unprofiled'
                  ? 'needs profiling'
                  : project.needsHumanAttention
                    ? 'needs attention'
                    : 'profiled'}
              </div>
            </div>
            <div className="button-row">
              <button className="copy-btn" onClick={copyCommand}>
                Copy profiling instruction
              </button>
              <button className="copy-btn" onClick={toggleAttention}>
                {project.needsHumanAttention ? 'Resolve attention' : 'Mark for attention'}
              </button>
            </div>
          </div>
          <pre className="command-box">{command}</pre>
          {project.description && <p>{project.description}</p>}
          <div className="muted small">
            First seen {formatFullTime(project.firstSeenAt)} · Last seen{' '}
            {formatFullTime(project.lastSeenAt)}
          </div>
        </section>

        <section className="card">
          <div className="card-title">Roots and covered records</div>
          {project.roots.length === 0 ? (
            <div className="muted">No canonical roots stored yet.</div>
          ) : (
            <ul className="plain-list">
              {project.roots.map((root) => (
                <li key={root} className="mono">
                  {root}
                </li>
              ))}
            </ul>
          )}
          {project.coveredProjects.length > 0 && (
            <>
              <div className="card-subtitle spaced">Covered detected records</div>
              <ul className="plain-list">
                {project.coveredProjects.map((covered) => (
                  <li key={covered.id} className="mono">
                    {covered.projectKey}
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>

        <section className="card">
          <div className="card-title">Artifact shapes</div>
          {project.artifactShapes.length === 0 ? (
            <div className="muted">No local artifact shapes stored.</div>
          ) : (
            <ul className="plain-list">
              {project.artifactShapes.map((shape, index) => (
                <li key={`${shape.type}-${index}`}>
                  <strong>{shape.type}</strong> ·{' '}
                  <span className="mono">{shape.detector.kind}</span> · {shapeDetail(shape)}
                  {shape.outputHint && (
                    <div className="muted small">
                      Output hint: {shape.outputHint.globs.join(', ')}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card">
          <div className="card-title">Evidence and notes</div>
          {project.evidenceSummary.length === 0 ? (
            <div className="muted">No profiling evidence summary stored.</div>
          ) : (
            <ul className="plain-list">
              {project.evidenceSummary.map((item, index) => (
                <li key={index}>{item}</li>
              ))}
            </ul>
          )}
          {project.notes && <p>{project.notes}</p>}
          {project.attentionReasons.length > 0 && (
            <>
              <div className="card-subtitle spaced">Human attention reasons</div>
              <ul className="plain-list">
                {project.attentionReasons.map((reason, index) => (
                  <li key={index}>{reason}</li>
                ))}
              </ul>
            </>
          )}
        </section>
        {toast && <div className="toast">{toast}</div>}
      </div>
    </>
  );
}

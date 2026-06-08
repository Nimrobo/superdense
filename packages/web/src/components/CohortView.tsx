import { useEffect, useState } from 'react';
import { api, type CohortMember } from '../api.js';
import { formatArtifactCostBadge } from '../costDisplay.js';
import { formatRelativeTime } from '../sessionDisplay.js';
import { RewardTargetList } from '../rewardDisplay.js';

function payloadPreview(payload: Record<string, unknown> | null): string {
  if (!payload) return '';
  if (typeof payload.text === 'string') return payload.text;
  if (Array.isArray(payload.files)) return (payload.files as unknown[]).join(', ');
  return JSON.stringify(payload);
}

// One comparable bundle, surfaced for the agent/human to judge — never ranked.
function MemberCard({
  member,
  badge,
  onOpenArtifact,
}: {
  member: CohortMember;
  badge?: string;
  onOpenArtifact: (id: string) => void;
}) {
  const { artifact, rewards } = member;
  const linked = rewards.targets;
  const cost = formatArtifactCostBadge(member.cost);
  return (
    <div className="project-card" style={{ cursor: 'default' }}>
      <div className="project-card-top">
        <strong>{artifact.provisionalTitle}</strong>
        <div className="project-card-badges">
          <span className="project-status">{badge ?? artifact.artifactType}</span>
          {cost && <span className="artifact-cost-badge">{cost}</span>}
        </div>
      </div>
      <div className="project-card-description ellipsis">{payloadPreview(artifact.payload)}</div>
      <div className="muted small">
        finalized {formatRelativeTime(artifact.artifactFinalizedAt ?? artifact.updatedAt)}
      </div>

      <RewardTargetList targets={linked} />

      <button
        type="button"
        className="back-btn"
        style={{ marginTop: 8 }}
        onClick={() => onOpenArtifact(artifact.id)}
      >
        Open artifact
      </button>
    </div>
  );
}

export function CohortView({
  cohortType,
  connector,
  onBack,
  onOpenArtifact,
}: {
  cohortType: string;
  connector?: string;
  onBack: () => void;
  onOpenArtifact: (id: string) => void;
}) {
  const [members, setMembers] = useState<CohortMember[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getCohort(cohortType, { connector })
      .then((result) => {
        setMembers(result.cohort.members);
        setError(null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [cohortType, connector]);

  return (
    <>
      <div className="work-header">
        <button className="back-btn" onClick={onBack}>
          Back
        </button>
        <div className="work-heading">
          <div className="work-title">
            {cohortType}
            {connector ? ` · ${connector}` : ''}
          </div>
          <div className="work-sub">
            Comparable prior work — outcomes surfaced, not ranked. You compare.
          </div>
        </div>
      </div>
      <div className="work-body">
        {error && <div className="error">Failed to load: {error}</div>}
        {!members && !error && <div className="empty">Loading...</div>}
        {members?.length === 0 && <div className="empty">No artifacts in this cohort.</div>}
        {members?.map((member) => (
          <MemberCard key={member.artifact.id} member={member} onOpenArtifact={onOpenArtifact} />
        ))}
      </div>
    </>
  );
}

export function ChainView({
  artifactId,
  onBack,
  onOpenArtifact,
}: {
  artifactId: string;
  onBack: () => void;
  onOpenArtifact: (id: string) => void;
}) {
  const [members, setMembers] = useState<CohortMember[] | null>(null);
  const [chainType, setChainType] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getVersionChain(artifactId)
      .then((result) => {
        setMembers(result.chain.members);
        setChainType(result.chain.type);
        setError(null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [artifactId]);

  return (
    <>
      <div className="work-header">
        <button className="back-btn" onClick={onBack}>
          Back
        </button>
        <div className="work-heading">
          <div className="work-title">Version chain{chainType ? ` · ${chainType}` : ''}</div>
          <div className="work-sub">
            One deliverable across versions, oldest first. Did it improve?
          </div>
        </div>
      </div>
      <div className="work-body">
        {error && <div className="error">Failed to load: {error}</div>}
        {!members && !error && <div className="empty">Loading...</div>}
        {members?.map((member, index) => (
          <MemberCard
            key={member.artifact.id}
            member={member}
            badge={`v${index + 1}`}
            onOpenArtifact={onOpenArtifact}
          />
        ))}
      </div>
    </>
  );
}

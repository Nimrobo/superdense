import { useEffect, useState } from 'react';
import { api, type WorkThread } from '../api.js';
import { projectLabel } from '../sessionDisplay.js';
import { ThreadDetails } from './ThreadDetails.js';

interface Props {
  id: string;
  onBack: () => void;
  onOpenSession: (id: string) => void;
}

export function WorkThreadView({ id, onBack, onOpenSession }: Props) {
  const [thread, setThread] = useState<WorkThread | null>(null);
  const [projectName, setProjectName] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api.getThread(id), api.listProjects()])
      .then(([result, projects]) => {
        const project = projects.items.find((item) => item.id === result.thread.projectProfileId);
        setThread(result.thread);
        setProjectName(project?.name ?? (project ? projectLabel(project.projectKey) : undefined));
        setError(null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [id]);

  if (error)
    return (
      <div className="work-body">
        <div className="error">Failed to load: {error}</div>
      </div>
    );
  if (!thread) return <div className="empty">Loading...</div>;

  return (
    <>
      <div className="work-header">
        <button className="back-btn" onClick={onBack}>
          Back
        </button>
        <div className="work-heading">
          <div className="work-title">{thread.provisionalTitle}</div>
          <div className="work-sub">{thread.lifecycle}</div>
        </div>
      </div>
      <ThreadDetails thread={thread} projectName={projectName} onOpenSession={onOpenSession} />
    </>
  );
}

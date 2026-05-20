import { useEffect, useState } from 'react';
import { api, type Group, type Session } from '../api.js';
import { SessionCard } from './SessionCard.js';

interface Props {
  id: string;
  onBack: () => void;
  onOpenSession: (id: string) => void;
  onDeleted: () => void;
}

export function GroupView({ id, onBack, onOpenSession, onDeleted }: Props) {
  const [group, setGroup] = useState<(Group & { members: Session[] }) | null>(null);

  useEffect(() => {
    api.getGroup(id).then(setGroup).catch(console.error);
  }, [id]);

  if (!group) return <div className="work-body"><div className="empty">Loading…</div></div>;

  const del = async () => {
    if (!confirm(`Delete group "${group.name}"?`)) return;
    await api.deleteGroup(id);
    onDeleted();
  };

  return (
    <>
      <div className="work-header">
        <button className="back-btn" onClick={onBack}>← Back</button>
        <div style={{ flex: 1 }}>
          <div className="work-title">{group.name}</div>
          <div className="work-sub">
            {group.pluginName} · {group.members.length} sessions
          </div>
        </div>
        <button className="btn secondary" onClick={del}>Delete</button>
      </div>
      <div className="work-body">
        <h3 style={{ fontSize: 12, color: 'var(--text-muted)', margin: '0 0 10px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Configuration</h3>
        <pre className="mono" style={{ fontSize: 12, background: 'var(--bg-soft)', padding: 10, borderRadius: 6, border: '1px solid var(--border)' }}>
{JSON.stringify(group.pluginConfig, null, 2)}
        </pre>
        <h3 style={{ fontSize: 12, color: 'var(--text-muted)', margin: '18px 0 10px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Members</h3>
        {group.members.length === 0 && <div className="empty">No sessions in this group yet.</div>}
        {group.members.map((s) => <SessionCard key={s.id} session={s} onClick={() => onOpenSession(s.id)} />)}
      </div>
    </>
  );
}

import { useEffect, useState } from 'react';
import { api, type Session } from '../api.js';
import { SessionCard } from './SessionCard.js';

interface Props {
  search: string;
  onOpen: (id: string) => void;
}

export function SessionsView({ search, onOpen }: Props) {
  const [items, setItems] = useState<Session[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const t = setTimeout(
      () => {
        api
          .listSessions({ q: search || undefined, limit: 200 })
          .then((r) => {
            setItems(r.items);
            setTotal(r.total);
          })
          .finally(() => setLoading(false));
      },
      search ? 220 : 0,
    );
    return () => clearTimeout(t);
  }, [search]);

  return (
    <>
      <div className="work-header">
        <div>
          <div className="work-title">Sessions</div>
          <div className="work-sub">
            {total.toLocaleString()} indexed{search ? ` · filtered by "${search}"` : ''}
          </div>
        </div>
      </div>
      <div className="work-body">
        {loading && <div className="empty">Loading…</div>}
        {!loading && items.length === 0 && (
          <div className="empty">
            No sessions yet. Click <b>Reindex</b> in the sidebar to scan local agent sessions.
          </div>
        )}
        {!loading &&
          items.map((s) => <SessionCard key={s.id} session={s} onClick={() => onOpen(s.id)} />)}
      </div>
    </>
  );
}

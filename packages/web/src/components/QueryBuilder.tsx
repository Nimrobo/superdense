import { useEffect, useMemo, useState } from 'react';
import { api, type EnricherInfo, type Predicate, type Query } from '../api.js';

type FieldType = 'string' | 'int' | 'bool' | 'json';

interface FieldInfo {
  field: string;
  label: string;
  type: FieldType;
}

interface RowState {
  field: string;
  op: string;
  value: string;
  path: string;
  intOp: string;
}

interface Props {
  onSaved: (q: Query) => void;
  onOpenSession: (id: string) => void;
}

const SESSION_FIELDS: FieldInfo[] = [
  { field: 'session.pwd', label: 'session.pwd', type: 'string' },
  { field: 'session.agent', label: 'session.agent', type: 'string' },
  { field: 'session.gitBranch', label: 'session.gitBranch', type: 'string' },
  { field: 'session.firstPrompt', label: 'session.firstPrompt', type: 'string' },
  { field: 'session.summary', label: 'session.summary', type: 'string' },
  { field: 'session.createdAt', label: 'session.createdAt', type: 'int' },
  { field: 'session.modifiedAt', label: 'session.modifiedAt', type: 'int' },
  { field: 'session.messageCount', label: 'session.messageCount', type: 'int' },
  { field: 'session.isSidechain', label: 'session.isSidechain', type: 'bool' },
];

const OPS: Record<FieldType, string[]> = {
  string: ['=', '!=', 'startsWith', 'endsWith', 'contains', 'matches', 'in', 'isNull'],
  int: ['=', '!=', '<', '<=', '>', '>=', 'in', 'between', 'isNull'],
  bool: ['=', 'isNull'],
  json: ['jsonEq', 'jsonContains', 'jsonAny', 'jsonLength', 'isNull'],
};

function defaultRow(field = 'session.pwd'): RowState {
  return { field, op: 'contains', value: '', path: '$', intOp: '>' };
}

function parseValue(raw: string, type: FieldType, op: string): unknown {
  if (op === 'isNull') return undefined;
  if (op === 'in') return raw.split(',').map((x) => x.trim()).filter(Boolean).map((x) => type === 'int' ? Number(x) : x);
  if (op === 'between') return raw.split(',').slice(0, 2).map((x) => Number(x.trim()));
  if (type === 'int') return Number(raw);
  if (type === 'bool') return raw === 'true';
  if (type === 'json' || op.startsWith('json')) {
    try { return JSON.parse(raw); } catch { return raw; }
  }
  return raw;
}

function buildLeaf(row: RowState, fields: FieldInfo[]): Predicate {
  const info = fields.find((f) => f.field === row.field) ?? fields[0]!;
  const leaf: Record<string, unknown> = { field: row.field, op: row.op };
  if (row.op !== 'isNull') leaf.value = parseValue(row.value, info.type, row.op);
  if (info.type === 'json' && row.path.trim()) leaf.path = row.path.trim();
  if (row.op === 'jsonAny' || row.op === 'jsonLength') leaf.intOp = row.intOp;
  return leaf as Predicate;
}

function buildPredicate(rows: RowState[], mode: 'and' | 'or', fields: FieldInfo[]): Predicate {
  const leaves = rows.map((r) => buildLeaf(r, fields));
  if (leaves.length === 1) return leaves[0]!;
  return mode === 'and' ? { and: leaves } : { or: leaves };
}

export function QueryBuilder({ onSaved, onOpenSession }: Props) {
  const [enrichers, setEnrichers] = useState<EnricherInfo[]>([]);
  const [mode, setMode] = useState<'and' | 'or'>('and');
  const [rows, setRows] = useState<RowState[]>([defaultRow()]);
  const [name, setName] = useState('');
  const [showJson, setShowJson] = useState(false);
  const [preview, setPreview] = useState<{ sessionId: string; evidence?: string | null }[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.listEnrichers().then((r) => setEnrichers(r.items)).catch(console.error);
  }, []);

  const fields = useMemo<FieldInfo[]>(() => [
    ...SESSION_FIELDS,
    ...enrichers.map((e) => ({ field: `enr.${e.name}`, label: `enr.${e.name}`, type: e.returns })),
  ], [enrichers]);

  const predicate = useMemo(() => buildPredicate(rows, mode, fields), [rows, mode, fields]);

  const patchRow = (idx: number, patch: Partial<RowState>) => {
    setRows((prev) => prev.map((r, i) => {
      if (i !== idx) return r;
      const next = { ...r, ...patch };
      const info = fields.find((f) => f.field === next.field) ?? fields[0]!;
      if (!OPS[info.type].includes(next.op)) next.op = OPS[info.type][0]!;
      return next;
    }));
  };

  const runPreview = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.previewQuery(predicate, 100);
      setPreview(r.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const q = await api.createQuery({ name: name.trim(), predicate });
      onSaved(q);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="work-header">
        <div>
          <div className="work-title">New query</div>
          <div className="work-sub">{rows.length} predicate {rows.length === 1 ? 'row' : 'rows'}</div>
        </div>
      </div>
      <div className="work-body">
        <div style={{ display: 'flex', gap: 8, marginBottom: 14, alignItems: 'center' }}>
          <select value={mode} onChange={(e) => setMode(e.target.value as 'and' | 'or')}>
            <option value="and">and</option>
            <option value="or">or</option>
          </select>
          <button className="btn secondary" onClick={() => setRows([...rows, defaultRow(fields[0]?.field)])}>Add row</button>
          <button className="btn secondary" onClick={() => setShowJson((v) => !v)}>{showJson ? 'Hide JSON' : 'Show JSON'}</button>
        </div>

        {rows.map((row, idx) => {
          const info = fields.find((f) => f.field === row.field) ?? fields[0]!;
          const ops = OPS[info.type];
          return (
            <div className="form-row" key={idx} style={{ display: 'grid', gridTemplateColumns: 'minmax(170px, 1.5fr) 120px minmax(140px, 1fr) auto', gap: 8, alignItems: 'end' }}>
              <label>
                Field
                <select value={row.field} onChange={(e) => patchRow(idx, { field: e.target.value })}>
                  {fields.map((f) => <option key={f.field} value={f.field}>{f.label}</option>)}
                </select>
              </label>
              <label>
                Operator
                <select value={row.op} onChange={(e) => patchRow(idx, { op: e.target.value })}>
                  {ops.map((op) => <option key={op} value={op}>{op}</option>)}
                </select>
              </label>
              {row.op === 'isNull' ? <span /> : (
                <label>
                  Value
                  {info.type === 'bool' ? (
                    <select value={row.value || 'true'} onChange={(e) => patchRow(idx, { value: e.target.value })}>
                      <option value="true">true</option>
                      <option value="false">false</option>
                    </select>
                  ) : (
                    <input value={row.value} onChange={(e) => patchRow(idx, { value: e.target.value })} />
                  )}
                </label>
              )}
              <button className="btn secondary" onClick={() => setRows(rows.filter((_, i) => i !== idx))} disabled={rows.length === 1}>Remove</button>
              {info.type === 'json' && (
                <>
                  <label>
                    Path
                    <input value={row.path} onChange={(e) => patchRow(idx, { path: e.target.value })} />
                  </label>
                  {(row.op === 'jsonAny' || row.op === 'jsonLength') && (
                    <label>
                      Int op
                      <select value={row.intOp} onChange={(e) => patchRow(idx, { intOp: e.target.value })}>
                        {['=', '!=', '<', '<=', '>', '>='].map((op) => <option key={op} value={op}>{op}</option>)}
                      </select>
                    </label>
                  )}
                </>
              )}
            </div>
          );
        })}

        {showJson && (
          <pre className="mono" style={{ fontSize: 12, background: 'var(--bg-soft)', padding: 10, borderRadius: 6, border: '1px solid var(--border)', overflowX: 'auto' }}>
{JSON.stringify(predicate, null, 2)}
          </pre>
        )}

        <div style={{ display: 'flex', gap: 10, alignItems: 'center', maxWidth: 640, marginTop: 18 }}>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Query name"
            style={{ flex: 1, padding: '7px 9px', border: '1px solid var(--border-strong)', borderRadius: 6 }}
          />
          <button className="btn" onClick={runPreview} disabled={busy}>{busy ? 'Running...' : 'Preview'}</button>
          <button className="btn" onClick={save} disabled={!name.trim() || busy}>Save</button>
        </div>
        {error && <div className="error" style={{ marginTop: 12 }}>{error}</div>}

        {preview && (
          <div style={{ marginTop: 20 }}>
            <h3 style={{ fontSize: 12, color: 'var(--text-muted)', margin: '0 0 10px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Preview matches ({preview.length})</h3>
            {preview.length === 0 && <div className="muted">No sessions matched.</div>}
            {preview.map((r) => (
              <div key={r.sessionId} className="session-card" onClick={() => onOpenSession(r.sessionId)} style={{ padding: '8px 12px' }}>
                <div className="mono" style={{ fontSize: 12 }}>{r.sessionId}</div>
                {r.evidence && <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>{r.evidence}</div>}
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

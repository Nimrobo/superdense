import { useEffect, useMemo, useState } from 'react';
import { api, type Predicate, type Query } from '../api.js';

interface Props {
  onSaved: (q: Query) => void;
  onOpenSession: (id: string) => void;
}

interface FilterState {
  pwd: string;
  agent: string;
  userPromptKeyword: string;
  hasErrors: 'any' | 'yes' | 'no';
  toolName: string;
  toolMin: string;
  cliName: string;
  cliMin: string;
}

const EMPTY: FilterState = {
  pwd: '',
  agent: '',
  userPromptKeyword: '',
  hasErrors: 'any',
  toolName: '',
  toolMin: '1',
  cliName: '',
  cliMin: '1',
};

function clampMin(raw: string): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.floor(n);
}

function buildPredicate(state: FilterState): Predicate | null {
  const leaves: Predicate[] = [];

  if (state.pwd.trim()) {
    leaves.push({ field: 'session.pwd', op: 'contains', value: state.pwd.trim() });
  }
  if (state.agent.trim()) {
    leaves.push({ field: 'session.agent', op: '=', value: state.agent.trim() });
  }
  if (state.userPromptKeyword.trim()) {
    leaves.push({ plugin: { name: 'by-user-prompt-keyword', config: { keyword: state.userPromptKeyword.trim() } } });
  }
  if (state.hasErrors !== 'any') {
    leaves.push({ field: 'enr.has_errors', op: '=', value: state.hasErrors === 'yes' });
  }
  if (state.toolName.trim()) {
    leaves.push({
      field: 'enr.tool_counts',
      op: 'jsonAny',
      path: `$.${state.toolName.trim()}`,
      intOp: '>=',
      value: clampMin(state.toolMin),
    });
  }
  if (state.cliName.trim()) {
    leaves.push({
      field: 'enr.bash_cli_counts',
      op: 'jsonAny',
      path: `$.${state.cliName.trim()}`,
      intOp: '>=',
      value: clampMin(state.cliMin),
    });
  }

  if (leaves.length === 0) return null;
  if (leaves.length === 1) return leaves[0]!;
  return { and: leaves };
}

export function QueryBuilder({ onSaved, onOpenSession }: Props) {
  const [state, setState] = useState<FilterState>(EMPTY);
  const [name, setName] = useState('');
  const [pwdOptions, setPwdOptions] = useState<string[]>([]);
  const [agentOptions, setAgentOptions] = useState<string[]>([]);
  const [showJson, setShowJson] = useState(false);
  const [preview, setPreview] = useState<{ sessionId: string; evidence?: string | null }[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.listFacets()
      .then((r) => { setPwdOptions(r.pwd); setAgentOptions(r.agent); })
      .catch(console.error);
  }, []);

  const predicate = useMemo(() => buildPredicate(state), [state]);
  const set = (patch: Partial<FilterState>) => setState((s) => ({ ...s, ...patch }));

  const runPreview = async () => {
    if (!predicate) {
      setError('Add at least one filter before previewing.');
      return;
    }
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
    if (!name.trim() || !predicate) return;
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

  const activeCount = predicate
    ? ('and' in predicate ? (predicate as { and: Predicate[] }).and.length : 1)
    : 0;

  return (
    <>
      <div className="work-header">
        <div>
          <div className="work-title">New query</div>
          <div className="work-sub">{activeCount} filter{activeCount === 1 ? '' : 's'} active</div>
        </div>
      </div>
      <div className="work-body">
        <div style={{ display: 'grid', gap: 14, maxWidth: 720 }}>
          <Card label="Working directory" hint="Sessions whose pwd contains this string.">
            <input
              list="facet-pwd"
              value={state.pwd}
              onChange={(e) => set({ pwd: e.target.value })}
              placeholder="/Users/me/projects/…"
            />
            <datalist id="facet-pwd">
              {pwdOptions.map((p) => <option key={p} value={p} />)}
            </datalist>
          </Card>

          <Card label="Agent" hint="Restrict to one agent.">
            <select value={state.agent} onChange={(e) => set({ agent: e.target.value })}>
              <option value="">Any</option>
              {agentOptions.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </Card>

          <Card label="User prompt contains" hint="Matches if any user message in the session contains this text.">
            <input
              value={state.userPromptKeyword}
              onChange={(e) => set({ userPromptKeyword: e.target.value })}
              placeholder="keyword"
            />
          </Card>

          <Card label="Has errors" hint="Based on the has_errors enricher.">
            <select value={state.hasErrors} onChange={(e) => set({ hasErrors: e.target.value as FilterState['hasErrors'] })}>
              <option value="any">Any</option>
              <option value="yes">Yes</option>
              <option value="no">No</option>
            </select>
          </Card>

          <Card label="Tool used" hint="Tool name (e.g. Bash, Read) with a minimum invocation count.">
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                value={state.toolName}
                onChange={(e) => set({ toolName: e.target.value })}
                placeholder="Bash"
                style={{ flex: 1 }}
              />
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-muted)' }}>
                ≥
                <input
                  type="number"
                  min={1}
                  value={state.toolMin}
                  onChange={(e) => set({ toolMin: e.target.value })}
                  style={{ width: 70 }}
                />
              </label>
            </div>
          </Card>

          <Card label="CLI used" hint="Parsed program name from Bash calls (e.g. git, npm, gh).">
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                value={state.cliName}
                onChange={(e) => set({ cliName: e.target.value })}
                placeholder="git"
                style={{ flex: 1 }}
              />
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-muted)' }}>
                ≥
                <input
                  type="number"
                  min={1}
                  value={state.cliMin}
                  onChange={(e) => set({ cliMin: e.target.value })}
                  style={{ width: 70 }}
                />
              </label>
            </div>
          </Card>
        </div>

        <div style={{ display: 'flex', gap: 10, alignItems: 'center', maxWidth: 720, marginTop: 22 }}>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Query name"
            style={{ flex: 1, padding: '7px 9px', border: '1px solid var(--border-strong)', borderRadius: 6 }}
          />
          <button className="btn" onClick={runPreview} disabled={busy || !predicate}>{busy ? 'Running...' : 'Preview'}</button>
          <button className="btn" onClick={save} disabled={!name.trim() || !predicate || busy}>Save</button>
          <button className="btn secondary" onClick={() => setShowJson((v) => !v)}>{showJson ? 'Hide JSON' : 'Show JSON'}</button>
        </div>

        {showJson && (
          <pre className="mono" style={{ fontSize: 12, background: 'var(--bg-soft)', padding: 10, borderRadius: 6, border: '1px solid var(--border)', overflowX: 'auto', marginTop: 12, maxWidth: 720 }}>
{predicate ? JSON.stringify(predicate, null, 2) : '// no filters'}
          </pre>
        )}

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

function Card({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'grid', gap: 6, padding: '12px 14px', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--bg-soft)' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
        <label style={{ fontSize: 13, fontWeight: 500 }}>{label}</label>
        {hint && <span className="muted" style={{ fontSize: 11 }}>{hint}</span>}
      </div>
      {children}
    </div>
  );
}

import { useEffect, useMemo, useState } from 'react';
import { api, type QueryDefinition, type QueryFilter, type Query } from '../api.js';
import { sessionHref } from '../urls.js';

interface Props {
  onSaved: (q: Query) => void;
}

interface FilterState {
  pwd: string;
  project: string;
  agent: string;
  userPromptKeyword: string;
  toolName: string;
  toolMin: string;
  cliName: string;
  cliMin: string;
}

const EMPTY: FilterState = {
  pwd: '',
  project: '',
  agent: '',
  userPromptKeyword: '',
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

function buildFilters(state: FilterState): QueryFilter | null {
  const leaves: QueryFilter[] = [];
  const sessionParams: Record<string, unknown> = {};

  if (state.pwd.trim()) {
    sessionParams.pwdContains = state.pwd.trim();
  }
  if (state.project.trim()) {
    sessionParams.projectContains = state.project.trim();
  }
  if (state.agent.trim()) {
    sessionParams.agent = state.agent.trim();
  }
  if (state.toolName.trim()) {
    sessionParams.toolUsed = { name: state.toolName.trim(), min: clampMin(state.toolMin) };
  }
  if (state.cliName.trim()) {
    sessionParams.cliUsed = { name: state.cliName.trim(), min: clampMin(state.cliMin) };
  }
  if (Object.keys(sessionParams).length > 0) {
    leaves.push({ filter: { name: 'session', params: sessionParams } });
  }
  if (state.userPromptKeyword.trim()) {
    leaves.push({
      filter: { name: 'user_prompt_contains', params: { keyword: state.userPromptKeyword.trim() } },
    });
  }

  if (leaves.length === 0) return null;
  if (leaves.length === 1) return leaves[0]!;
  return { and: leaves };
}

export function QueryBuilder({ onSaved }: Props) {
  const [state, setState] = useState<FilterState>(EMPTY);
  const [name, setName] = useState('');
  const [pwdOptions, setPwdOptions] = useState<string[]>([]);
  const [projectOptions, setProjectOptions] = useState<string[]>([]);
  const [agentOptions, setAgentOptions] = useState<string[]>([]);
  const [showJson, setShowJson] = useState(false);
  const [results, setResults] = useState<{ sessionId: string; evidence?: string | null }[] | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .listFacets()
      .then((r) => {
        setPwdOptions(r.pwd);
        setAgentOptions(r.agent);
        setProjectOptions(r.project);
      })
      .catch(console.error);
  }, []);

  const filtersExpression = useMemo(() => buildFilters(state), [state]);
  const definition = useMemo<QueryDefinition | null>(
    () => (filtersExpression ? { filters: filtersExpression, enrichers: [] } : null),
    [filtersExpression],
  );
  const set = (patch: Partial<FilterState>) => setState((s) => ({ ...s, ...patch }));

  const runQuery = async () => {
    if (!definition) {
      setError('Add at least one filter before running.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await api.executeQuery(definition, 100);
      setResults(r.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!name.trim() || !definition) return;
    setBusy(true);
    setError(null);
    try {
      const q = await api.createQuery({ name: name.trim(), ...definition });
      onSaved(q);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const activeCount = filtersExpression
    ? 'and' in filtersExpression
      ? (filtersExpression as { and: QueryFilter[] }).and.length
      : 1
    : 0;

  const pwdActive = state.pwd.trim() !== '';
  const projectActive = state.project.trim() !== '';

  return (
    <>
      <div className="work-header">
        <div>
          <div className="work-title">New query</div>
          <div className="work-sub">
            {activeCount} filter{activeCount === 1 ? '' : 's'} active
          </div>
        </div>
      </div>
      <div className="work-body">
        <div style={{ display: 'grid', gap: 14, maxWidth: 720 }}>
          <Row2>
            <Card
              label="Working directory"
              hint={
                projectActive
                  ? 'Clear Project to use Working Directory'
                  : 'Sessions whose pwd contains this string.'
              }
            >
              <input
                list="facet-pwd"
                value={state.pwd}
                disabled={projectActive}
                onChange={(e) => set({ pwd: e.target.value })}
                placeholder="/Users/me/projects/…"
              />
              <datalist id="facet-pwd">
                {pwdOptions.map((p) => (
                  <option key={p} value={p} />
                ))}
              </datalist>
            </Card>

            <Card
              label="Project"
              hint={
                pwdActive
                  ? 'Clear Working Directory to use Project'
                  : 'Sessions whose project key contains this string.'
              }
            >
              <input
                list="facet-project"
                value={state.project}
                disabled={pwdActive}
                onChange={(e) => set({ project: e.target.value })}
                placeholder="project-key"
              />
              <datalist id="facet-project">
                {projectOptions.map((p) => (
                  <option key={p} value={p} />
                ))}
              </datalist>
            </Card>
          </Row2>

          <Row2>
            <Card label="Agent" hint="Restrict to one agent.">
              <select value={state.agent} onChange={(e) => set({ agent: e.target.value })}>
                <option value="">Any</option>
                {agentOptions.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
            </Card>

            <Card
              label="User prompt contains"
              hint="Matches if any user message in the session contains this text."
            >
              <input
                value={state.userPromptKeyword}
                onChange={(e) => set({ userPromptKeyword: e.target.value })}
                placeholder="keyword"
              />
            </Card>
          </Row2>

          <Row2>
            <Card
              label="Tool used"
              hint="Tool name (e.g. Bash, Read) with a minimum invocation count."
            >
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  value={state.toolName}
                  onChange={(e) => set({ toolName: e.target.value })}
                  placeholder="Bash"
                  style={{ flex: 1 }}
                />
                <label
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    fontSize: 12,
                    color: 'var(--text-muted)',
                  }}
                >
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
                <label
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    fontSize: 12,
                    color: 'var(--text-muted)',
                  }}
                >
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
          </Row2>
        </div>

        <div
          style={{ display: 'flex', gap: 10, alignItems: 'center', maxWidth: 720, marginTop: 22 }}
        >
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Query name"
            style={{
              flex: 1,
              padding: '7px 9px',
              border: '1px solid var(--border-strong)',
              borderRadius: 6,
            }}
          />
          <button className="btn" onClick={runQuery} disabled={busy || !definition}>
            {busy ? 'Running...' : 'Run'}
          </button>
          <button className="btn" onClick={save} disabled={!name.trim() || !definition || busy}>
            Save
          </button>
          <button className="btn secondary" onClick={() => setShowJson((v) => !v)}>
            {showJson ? 'Hide JSON' : 'Show JSON'}
          </button>
        </div>

        {showJson && (
          <pre
            className="mono"
            style={{
              fontSize: 12,
              background: 'var(--bg-soft)',
              padding: 10,
              borderRadius: 6,
              border: '1px solid var(--border)',
              overflowX: 'auto',
              marginTop: 12,
              maxWidth: 720,
            }}
          >
            {definition ? JSON.stringify(definition, null, 2) : '// no filters'}
          </pre>
        )}

        {error && (
          <div className="error" style={{ marginTop: 12 }}>
            {error}
          </div>
        )}

        {results && (
          <div style={{ marginTop: 20 }}>
            <h3
              style={{
                fontSize: 12,
                color: 'var(--text-muted)',
                margin: '0 0 10px',
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
              }}
            >
              Results ({results.length})
            </h3>
            {results.length === 0 && <div className="muted">No sessions matched.</div>}
            {results.map((r) => (
              <a
                key={r.sessionId}
                className="session-card"
                href={sessionHref(r.sessionId)}
                target="_blank"
                rel="noopener noreferrer"
                style={{ padding: '8px 12px' }}
              >
                <div className="mono" style={{ fontSize: 12 }}>
                  {r.sessionId}
                </div>
                {r.evidence && (
                  <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
                    {r.evidence}
                  </div>
                )}
              </a>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

function Row2({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>{children}</div>;
}

function Card({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        display: 'grid',
        gap: 6,
        padding: '12px 14px',
        border: '1px solid var(--border)',
        borderRadius: 8,
        background: 'var(--bg-soft)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: 12,
        }}
      >
        <label style={{ fontSize: 13, fontWeight: 500 }}>{label}</label>
        {hint && (
          <span className="muted" style={{ fontSize: 11 }}>
            {hint}
          </span>
        )}
      </div>
      {children}
    </div>
  );
}

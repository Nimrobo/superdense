import { useEffect, useMemo, useState } from 'react';
import { api, type Query, type PluginInfo } from '../api.js';

interface Props {
  plugin: PluginInfo;
  onSaved: (q: Query) => void;
  onOpenSession: (id: string) => void;
}

export function PluginRunner({ plugin, onSaved, onOpenSession }: Props) {
  const initial = useMemo(() => {
    const out: Record<string, string> = {};
    for (const f of plugin.configSchema) out[f.name] = (f.default ?? '').toString();
    return out;
  }, [plugin.name]);
  const [config, setConfig] = useState<Record<string, string>>(initial);
  const [results, setResults] = useState<{ sessionId: string; evidence?: string | null }[] | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('');

  useEffect(() => { setConfig(initial); setResults(null); setName(''); }, [plugin.name]);

  const runPreview = async () => {
    setPreviewing(true);
    try {
      const cfg = coerce(config, plugin);
      const r = await api.previewPlugin(plugin.name, cfg, 500);
      setResults(r.items);
    } finally {
      setPreviewing(false);
    }
  };

  const save = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      const cfg = coerce(config, plugin);
      const q = await api.createQuery({ name: name.trim(), predicate: { plugin: { name: plugin.name, config: cfg } } });
      onSaved(q);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="work-header">
        <div>
          <div className="work-title">{plugin.title}</div>
          {plugin.description && <div className="work-sub">{plugin.description}</div>}
        </div>
      </div>
      <div className="work-body">
        <h3 style={{ fontSize: 12, color: 'var(--text-muted)', margin: '0 0 10px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Configuration</h3>
        {plugin.configSchema.length === 0 && <div className="muted" style={{ marginBottom: 14 }}>This plugin takes no configuration.</div>}
        {plugin.configSchema.map((f) => (
          <div className="form-row" key={f.name}>
            <label>{f.name}{f.required ? ' *' : ''}{f.description && <span className="muted"> — {f.description}</span>}</label>
            <input
              value={config[f.name] ?? ''}
              onChange={(e) => setConfig({ ...config, [f.name]: e.target.value })}
              placeholder={f.type === 'string' ? '' : f.type}
            />
          </div>
        ))}
        <div style={{ display: 'flex', gap: 10, marginBottom: 22 }}>
          <button className="btn" onClick={runPreview} disabled={previewing}>{previewing ? 'Running…' : 'Preview'}</button>
        </div>

        {results !== null && (
          <>
            <h3 style={{ fontSize: 12, color: 'var(--text-muted)', margin: '0 0 10px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Matches ({results.length})
            </h3>
            {results.length === 0 && <div className="muted" style={{ marginBottom: 14 }}>No sessions matched.</div>}
            {results.length > 0 && (
              <>
                <div style={{ marginBottom: 16 }}>
                  {results.slice(0, 200).map((r) => (
                    <div
                      key={r.sessionId}
                      className="session-card"
                      onClick={() => onOpenSession(r.sessionId)}
                      style={{ padding: '8px 12px' }}
                    >
                      <div className="mono" style={{ fontSize: 12 }}>{r.sessionId}</div>
                      {r.evidence && <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>{r.evidence}</div>}
                    </div>
                  ))}
                  {results.length > 200 && <div className="muted" style={{ marginTop: 6 }}>… and {results.length - 200} more</div>}
                </div>
                <h3 style={{ fontSize: 12, color: 'var(--text-muted)', margin: '0 0 10px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Save as query</h3>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', maxWidth: 520 }}>
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Query name"
                    style={{ flex: 1, padding: '7px 9px', border: '1px solid var(--border-strong)', borderRadius: 6 }}
                  />
                  <button className="btn" onClick={save} disabled={!name.trim() || saving}>{saving ? 'Saving...' : 'Save query'}</button>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </>
  );
}

function coerce(config: Record<string, string>, plugin: PluginInfo): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of plugin.configSchema) {
    const v = config[f.name];
    if (v == null || v === '') continue;
    if (f.type === 'number') out[f.name] = Number(v);
    else if (f.type === 'boolean') out[f.name] = v === 'true';
    else out[f.name] = v;
  }
  return out;
}

import { useEffect, useState } from 'react';
import { api, type InsightRecipe, type InsightRun } from '../api.js';

interface Props {
  onOpenSession: (id: string) => void;
}

function relTime(ms: number | null): string {
  if (!ms) return '-';
  const d = Date.now() - ms;
  const s = Math.floor(d / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(ms).toLocaleDateString();
}

function basename(p: string): string {
  const parts = (p ?? '').split('/').filter(Boolean);
  return parts.length ? parts[parts.length - 1]! : p;
}

export function InsightsView({ onOpenSession }: Props) {
  const [recipes, setRecipes] = useState<InsightRecipe[] | null>(null);
  const [runs, setRuns] = useState<InsightRun[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [copying, setCopying] = useState<string | null>(null);

  const refresh = () => {
    Promise.all([api.insightsRecipes(), api.insightsRuns()])
      .then(([r, runsRes]) => { setRecipes(r.items); setRuns(runsRes.items); })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  };

  useEffect(refresh, []);

  const onCopy = async (recipe: InsightRecipe) => {
    setCopying(recipe.name);
    try {
      const { prompt } = await api.insightsPrompt(recipe.name);
      await navigator.clipboard.writeText(prompt);
      setToast(
        `"${recipe.title}" prompt copied. Paste it into your coding agent (Claude Code, Codex, OpenCode) — Road42 will pick up the run automatically.`,
      );
      setTimeout(() => setToast(null), 5500);
    } catch (e) {
      setToast(`Copy failed: ${e instanceof Error ? e.message : String(e)}`);
      setTimeout(() => setToast(null), 4000);
    } finally {
      setCopying(null);
    }
  };

  if (error) return <div className="insights"><div className="error">Failed to load: {error}</div></div>;
  if (!recipes) return <div className="insights"><div className="muted">Loading…</div></div>;

  return (
    <div className="insights">
      <header className="insights-header">
        <h1>Insights</h1>
        <p className="muted">
          Each insight is a prompt that runs <strong>in your own coding agent</strong>. Click Copy, paste into
          Claude Code, Codex, or OpenCode, and the run will show up below automatically once it's indexed.
        </p>
      </header>

      <section className="insights-table">
        <table>
          <thead>
            <tr>
              <th>Insight</th>
              <th>Description</th>
              <th style={{ width: 120 }} />
            </tr>
          </thead>
          <tbody>
            {recipes.map((r) => (
              <tr key={r.name}>
                <td><strong>{r.title}</strong></td>
                <td className="muted">{r.description}</td>
                <td>
                  <button
                    className="copy-btn"
                    onClick={() => onCopy(r)}
                    disabled={copying === r.name}
                  >
                    {copying === r.name ? 'Copying…' : 'Copy prompt'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="insights-runs">
        <h2>Past runs</h2>
        {runs && runs.length === 0 && (
          <div className="muted">
            No insight runs yet. Copy a prompt above, paste it into your coding agent, and refresh to see
            it here once it's indexed.
          </div>
        )}
        {runs && runs.length > 0 && (
          <ul className="run-list">
            {runs.map((run) => (
              <li
                key={`${run.sessionId}-${run.runId}`}
                className="run-row"
                onClick={() => onOpenSession(run.sessionId)}
              >
                <div className="run-row-top">
                  <strong>{run.insightTitle}</strong>
                  <span className="muted">{relTime(run.timestamp)}</span>
                </div>
                <div className="run-row-meta muted">
                  {basename(run.project)} · {run.agent}
                  {!run.hasAnswer && <span className="pill"> in progress</span>}
                </div>
                {run.answerExcerpt && (
                  <div className="run-row-excerpt">{run.answerExcerpt}{run.answerExcerpt.length >= 280 ? '…' : ''}</div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

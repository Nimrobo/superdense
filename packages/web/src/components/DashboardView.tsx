import { useEffect, useMemo, useState } from 'react';
import {
  api,
  type HeaderStats,
  type Insights,
  type ProjectSummary,
  type WindowBundle,
} from '../api.js';
import { projectLabel, sessionTitle } from '../sessionDisplay.js';

type WindowDays = 7 | 14 | 30;
type HeatmapRange = '30D' | '6M';

interface Props {
  progress: { phase: string; total: number; done: number } | null;
  onReindex: () => void;
  onOpenSession: (id: string) => void;
  onOpenSessions: () => void;
  onOpenProject: (id: string) => void;
}

const DOWS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function relTime(ms?: number | null): string {
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
  const parts = p.split('/').filter(Boolean);
  return parts.length ? parts[parts.length - 1]! : p;
}

function formatDuration(ms: number): string {
  const m = Math.floor(ms / 60000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem ? `${h}h ${rem}m` : `${h}h`;
}

function formatLatency(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`;
  const minutes = Math.floor(seconds / 60);
  const remSeconds = Math.round(seconds % 60);
  return remSeconds ? `${minutes}m ${remSeconds}s` : `${minutes}m`;
}

function ymdToLabel(ymd: string): string {
  const [y, m, d] = ymd.split('-').map((n) => Number(n));
  if (!y || !m || !d) return ymd;
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function DashboardView({
  progress,
  onReindex,
  onOpenSession,
  onOpenSessions,
  onOpenProject,
}: Props) {
  const [header, setHeader] = useState<HeaderStats | null>(null);
  const [windowDays, setWindowDays] = useState<WindowDays>(7);
  const [windowData, setWindowData] = useState<WindowBundle | null>(null);
  const [insights, setInsights] = useState<Insights | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [projectActions, setProjectActions] = useState<ProjectSummary[]>([]);

  const refreshAll = () => {
    Promise.all([
      api.statsHeader(),
      api.statsWindow(windowDays),
      api.statsInsights(),
      api.listProjects({ needsAction: true }),
    ])
      .then(([h, w, i, projects]) => {
        setHeader(h);
        setWindowData(w);
        setInsights(i);
        setProjectActions(projects.items);
        setError(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  };

  useEffect(() => {
    refreshAll(); /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, []);
  useEffect(() => {
    api
      .statsWindow(windowDays)
      .then(setWindowData)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [windowDays]);

  if (error)
    return (
      <div className="dashboard">
        <div className="error">Failed to load: {error}</div>
      </div>
    );
  if (!header)
    return (
      <div className="dashboard">
        <div className="muted">Loading...</div>
      </div>
    );

  const busy = progress && progress.phase !== 'idle';

  if (header.totals.sessions === 0) {
    return (
      <div className="dashboard">
        <div className="dashboard-header">
          <h1>Dashboard</h1>
        </div>
        <div className="card">
          <div className="card-title">No sessions yet</div>
          <p className="muted">Run a reindex to discover your agent transcripts.</p>
          <button className="reindex-btn" onClick={onReindex} disabled={!!busy}>
            {busy ? `${progress!.phase} ${progress!.done}/${progress!.total}` : 'Reindex'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="dashboard">
      <div className="dashboard-header">
        <h1>Dashboard</h1>
        <div className="dashboard-header-actions">
          <span className="muted small">indexed {relTime(header.lastIndexedAt)}</span>
          {busy && (
            <span className="muted small">
              {progress!.phase} {progress!.done}/{progress!.total}
            </span>
          )}
        </div>
      </div>

      <TotalsRow totals={header.totals} />

      <ProjectAttentionCard items={projectActions} onOpenProject={onOpenProject} />

      <MomentumHero streaks={header.streaks} records={insights?.personalRecords ?? null} />

      <div className="activity-rhythm-row">
        <ContributionHeatmap contributions={header.contributions} />
        {insights && (
          <WorkRhythmCard cells={insights.hourDowHeatmap} rhythm={insights.workRhythm} />
        )}
      </div>

      <WindowMetricsCard windowDays={windowDays} setWindowDays={setWindowDays} data={windowData} />

      {windowData && insights && (
        <ProjectMomentumCard
          activeProjects={windowData.window.activeProjects}
          repeatedReturnProjects={windowData.window.repeatedReturnProjects}
          comebackProjects={insights.comebackProjects}
        />
      )}

      {insights && (
        <div className="activity-rhythm-row">
          <FocusPatternCard items={insights.dayKinds} />
          <PersonalRecordsCard
            records={insights.personalRecords}
            workRhythm={insights.workRhythm}
            onOpenSession={onOpenSession}
          />
        </div>
      )}

      <RecentWorkCard
        recentSessions={header.recentSessions}
        onOpenSession={onOpenSession}
        onOpenSessions={onOpenSessions}
      />
    </div>
  );
}

function ProjectAttentionCard({
  items,
  onOpenProject,
}: {
  items: ProjectSummary[];
  onOpenProject: (id: string) => void;
}) {
  if (items.length === 0) return null;
  return (
    <div className="card project-attention-card">
      <div>
        <div className="card-title">Projects need action</div>
        <div className="muted small">
          Profile newly detected projects or review unresolved attention reasons.
        </div>
      </div>
      <ul className="list project-attention-list">
        {items.slice(0, 5).map((project) => (
          <li
            key={project.id}
            className="list-row clickable"
            onClick={() => onOpenProject(project.id)}
          >
            <span className="ellipsis">{project.name ?? basename(project.projectKey)}</span>
            <span className="muted small">
              {project.status === 'unprofiled' ? 'profile project' : 'review attention'}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function TotalsRow({ totals }: { totals: HeaderStats['totals'] }) {
  return (
    <div className="totals-row">
      <Total label="Overall sessions" value={totals.sessions} />
      <Total label="Projects worked on" value={totals.distinctPwds} />
      <Total label="Active days" value={totals.activeDays} />
      <Total label="Agents used" value={totals.distinctAgents} />
    </div>
  );
}

function Total({ label, value }: { label: string; value: number }) {
  return (
    <div className="total">
      <div className="total-value">{value.toLocaleString()}</div>
      <div className="total-label">{label}</div>
    </div>
  );
}

function MomentumHero({
  streaks,
  records,
}: {
  streaks: HeaderStats['streaks'];
  records: Insights['personalRecords'] | null;
}) {
  return (
    <div className="card momentum-card">
      <div className="momentum-main">
        <div className="momentum-number">{streaks.current}</div>
        <div>
          <div className="momentum-label">current day streak</div>
          {streaks.current > 0 && streaks.current >= streaks.longest && (
            <div className="momentum-badge">New record pace</div>
          )}
        </div>
      </div>
      <div className="momentum-stats">
        <RecordTile
          label="Longest streak"
          value={`${streaks.longest}d`}
          detail={
            streaks.longestRange
              ? `${ymdToLabel(streaks.longestRange.start)} - ${ymdToLabel(streaks.longestRange.end)}`
              : undefined
          }
        />
        <RecordTile
          label="Best day"
          value={records?.bestDay ? `${records.bestDay.sessions}` : '-'}
          detail={records?.bestDay ? ymdToLabel(records.bestDay.date) : undefined}
        />
        <RecordTile
          label="Longest agent runtime"
          value={records?.longestSession ? formatDuration(records.longestSession.durationMs) : '-'}
          title="Active conversation time, excluding idle gaps longer than 5 minutes."
        />
      </div>
    </div>
  );
}

function RecordTile({
  label,
  value,
  detail,
  title,
}: {
  label: string;
  value: string;
  detail?: string;
  title?: string;
}) {
  return (
    <div className="record-tile" title={title}>
      <div className="record-value">{value}</div>
      <div className="record-label">{label}</div>
      {detail && <div className="record-detail">{detail}</div>}
    </div>
  );
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function ContributionHeatmap({ contributions }: { contributions: HeaderStats['contributions'] }) {
  const [range, setRange] = useState<HeatmapRange>('6M');
  const visible = useMemo(
    () => (range === '30D' ? contributions.slice(-30) : contributions.slice(-180)),
    [contributions, range],
  );

  const { weeks, max } = useMemo(() => {
    const max = visible.reduce((m, c) => Math.max(m, c.count), 0);
    if (visible.length === 0)
      return { weeks: [] as Array<Array<{ date: string; count: number } | null>>, max };
    const first = visible[0]!;
    // Use local-time day-of-week for the leading pad so columns align by weekday.
    const firstDow = new Date(`${first.date}T12:00:00`).getDay();
    const cells: Array<{ date: string; count: number } | null> = [];
    for (let i = 0; i < firstDow; i++) cells.push(null);
    for (const c of visible) cells.push(c);
    const weeks: Array<Array<{ date: string; count: number } | null>> = [];
    for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
    return { weeks, max };
  }, [visible]);

  // Month labels above the grid, one per week column (empty if not the first
  // week of a month, GitHub-style).
  const monthLabels = useMemo(() => {
    return weeks.map((week) => {
      const firstReal = week.find((c) => c != null);
      if (!firstReal) return '';
      const d = new Date(`${firstReal.date}T12:00:00`);
      // Label the column only if it contains the 1st–7th of a month.
      const day = d.getDate();
      return day <= 7 ? MONTHS[d.getMonth()]! : '';
    });
  }, [weeks]);

  const bucket = (count: number): number => {
    if (count === 0 || max === 0) return 0;
    const r = count / max;
    if (r > 0.66) return 4;
    if (r > 0.33) return 3;
    if (r > 0.1) return 2;
    return 1;
  };

  const totalDays = visible.filter((c) => c.count > 0).length;

  return (
    <div className="card">
      <div className="window-header">
        <div className="card-title" style={{ margin: 0 }}>
          Contribution heatmap · {totalDays} active days
        </div>
        <div className="segmented">
          {(['30D', '6M'] as HeatmapRange[]).map((r) => (
            <button
              key={r}
              className={`seg ${range === r ? 'active' : ''}`}
              onClick={() => setRange(r)}
            >
              {r}
            </button>
          ))}
        </div>
      </div>
      <div className="heatmap">
        <div
          className="heatmap-months"
          style={{
            gridTemplateColumns: `var(--hm-dow-width) repeat(${Math.max(1, weeks.length)}, var(--hm-cell))`,
          }}
        >
          <span />
          {monthLabels.map((m, i) => (
            <span key={i} className="heatmap-month-label">
              {m}
            </span>
          ))}
        </div>
        <div className="heatmap-body">
          <div className="heatmap-dows">
            <span />
            <span>Mon</span>
            <span />
            <span>Wed</span>
            <span />
            <span>Fri</span>
            <span />
          </div>
          <div className="heatmap-grid">
            {weeks.map((week, wi) => (
              <div key={wi} className="heatmap-col">
                {Array.from({ length: 7 }).map((_, di) => {
                  const cell = week[di];
                  if (!cell) return <div key={di} className="heatmap-cell empty" />;
                  return (
                    <div
                      key={di}
                      className={`heatmap-cell b${bucket(cell.count)}`}
                      title={`${ymdToLabel(cell.date)} - ${cell.count} session${cell.count === 1 ? '' : 's'}`}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        </div>
        <div className="heatmap-legend">
          <span className="muted small">Less</span>
          <div className="heatmap-cell b0" />
          <div className="heatmap-cell b1" />
          <div className="heatmap-cell b2" />
          <div className="heatmap-cell b3" />
          <div className="heatmap-cell b4" />
          <span className="muted small">More</span>
        </div>
      </div>
    </div>
  );
}

function WorkRhythmCard({
  cells,
  rhythm,
}: {
  cells: Insights['hourDowHeatmap'];
  rhythm: Insights['workRhythm'];
}) {
  const max = cells.reduce((m, c) => Math.max(m, c.count), 0);
  const intensity = (n: number) => (max === 0 ? 0 : n / max);
  return (
    <div className="card">
      <div className="card-title">Work rhythm</div>
      <div className="hourdow">
        {Array.from({ length: 7 }).map((_, dow) => (
          <div key={dow} className="hourdow-row">
            <span className="hourdow-label muted small">{DOWS[dow]}</span>
            {Array.from({ length: 24 }).map((_, h) => {
              const cell = cells.find((c) => c.dow === dow && c.hour === h) ?? { count: 0 };
              const op = intensity(cell.count);
              return (
                <div
                  key={h}
                  className="hourdow-cell"
                  style={{ opacity: op === 0 ? 0.08 : 0.2 + op * 0.8 }}
                  title={`${DOWS[dow]} ${h}:00 - ${cell.count}`}
                />
              );
            })}
          </div>
        ))}
      </div>
      <div className="rhythm-summary">
        <span>
          {rhythm.peakHour
            ? `Peak: ${DOWS[rhythm.peakHour.dow]} ${String(rhythm.peakHour.hour).padStart(2, '0')}:00`
            : 'Peak: -'}
        </span>
        <span>
          {rhythm.mostConsistentWeekday
            ? `Most consistent: ${DOWS[rhythm.mostConsistentWeekday.dow]}`
            : 'Most consistent: -'}
        </span>
      </div>
    </div>
  );
}

function WindowMetricsCard({
  windowDays,
  setWindowDays,
  data,
}: {
  windowDays: WindowDays;
  setWindowDays: (d: WindowDays) => void;
  data: WindowBundle | null;
}) {
  return (
    <div className="card">
      <div className="window-header">
        <div className="card-title" style={{ margin: 0 }}>
          Selected window
        </div>
        <div className="segmented">
          {([7, 14, 30] as WindowDays[]).map((d) => (
            <button
              key={d}
              className={`seg ${windowDays === d ? 'active' : ''}`}
              onClick={() => setWindowDays(d)}
            >
              {d}D
            </button>
          ))}
        </div>
      </div>

      {!data ? (
        <div className="muted">Loading...</div>
      ) : (
        <>
          <div className="window-grid">
            <Tile label="Sessions" value={data.window.sessions} />
            <Tile label="Projects touched" value={data.window.projects} />
            <Tile label="Active days" value={data.window.activeDays} />
            <Tile label="Sessions / active day" value={data.window.avgPerActiveDay.toFixed(1)} />
          </div>
          {data.window.turnLatency && (
            <div className="inline-list-block">
              <div className="card-subtitle">Agent response time</div>
              <div className="window-grid">
                <Tile label="Median" value={formatLatency(data.window.turnLatency.medianMs)} />
                <Tile label="Average" value={formatLatency(data.window.turnLatency.avgMs)} />
                <Tile label="P90" value={formatLatency(data.window.turnLatency.p90Ms)} />
                <Tile label="Turns measured" value={data.window.turnLatency.count} />
              </div>
              <div className="muted small">
                Min {formatLatency(data.window.turnLatency.minMs)} · Max{' '}
                {formatLatency(data.window.turnLatency.maxMs)}
              </div>
            </div>
          )}
          {data.window.topClis.length > 0 && (
            <div className="inline-list-block">
              <div className="card-subtitle">Top CLI commands</div>
              <ul className="chip-list">
                {data.window.topClis.map((c) => (
                  <li key={c.cli} className="chip">
                    <span className="mono">{c.cli}</span>
                    <span className="count">{c.count}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <AdapterMixBar mix={data.window.adapterMix} />
        </>
      )}
    </div>
  );
}

function Tile({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="tile">
      <div className="tile-value">{typeof value === 'number' ? value.toLocaleString() : value}</div>
      <div className="tile-label">{label}</div>
    </div>
  );
}

function AdapterMixBar({ mix }: { mix: Array<{ agent: string; count: number }> }) {
  if (mix.length <= 1) return null;
  const total = mix.reduce((s, m) => s + m.count, 0);
  if (total === 0) return null;
  const palette = ['var(--accent)', '#10b981', '#f59e0b', '#8b5cf6'];
  return (
    <div className="adapter-mix">
      <div className="card-subtitle">Adapter mix</div>
      <div className="bar">
        {mix.map((m, i) => (
          <div
            key={m.agent}
            className="bar-seg"
            style={{
              width: `${(m.count / total) * 100}%`,
              background: palette[i % palette.length],
            }}
            title={`${m.agent}: ${m.count}`}
          />
        ))}
      </div>
      <div className="bar-legend">
        {mix.map((m, i) => (
          <span key={m.agent} className="bar-legend-item">
            <span className="bar-legend-dot" style={{ background: palette[i % palette.length] }} />
            {m.agent} <span className="muted">{((m.count / total) * 100).toFixed(0)}%</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function ProjectMomentumCard({
  activeProjects,
  repeatedReturnProjects,
  comebackProjects,
}: {
  activeProjects: WindowBundle['window']['activeProjects'];
  repeatedReturnProjects: WindowBundle['window']['repeatedReturnProjects'];
  comebackProjects: Insights['comebackProjects'];
}) {
  if (
    activeProjects.length === 0 &&
    repeatedReturnProjects.length === 0 &&
    comebackProjects.length === 0
  )
    return null;

  return (
    <div className="card">
      <div className="card-title">Project momentum</div>
      <div className="three-col">
        <ProjectList
          title="Most active"
          empty="No project activity"
          items={activeProjects}
          renderMeta={(p) => `${p.count} sessions · ${p.activeDays}d`}
        />
        <ProjectList
          title="Comebacks"
          empty="No dormant projects resumed"
          items={comebackProjects}
          renderMeta={(p) => `${p.dormantDays}d dormant · ${p.sessions7d} sessions`}
        />
        <ProjectList
          title="Repeated returns"
          empty="No 3-day returns yet"
          items={repeatedReturnProjects}
          renderMeta={(p) => `${p.activeDays} active days · ${p.sessions} sessions`}
        />
      </div>
    </div>
  );
}

function ProjectList<T extends { pwd: string }>({
  title,
  empty,
  items,
  renderMeta,
}: {
  title: string;
  empty: string;
  items: T[];
  renderMeta: (item: T) => string;
}) {
  return (
    <div className="project-list">
      <div className="card-subtitle">{title}</div>
      {items.length === 0 ? (
        <div className="muted small">{empty}</div>
      ) : (
        <ul className="list">
          {items.slice(0, 5).map((p) => (
            <li key={p.pwd} className="list-row" title={p.pwd}>
              <span className="ellipsis">{basename(p.pwd)}</span>
              <span className="muted small">{renderMeta(p)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function FocusPatternCard({ items }: { items: Insights['dayKinds'] }) {
  const focus = items.filter((d) => d.kind === 'focus').length;
  const scatter = items.filter((d) => d.kind === 'scatter').length;
  if (items.length === 0) return null;

  return (
    <div className="card">
      <div className="card-title">Focus pattern</div>
      <div className="window-grid focus-grid">
        <Tile label="Focus days" value={focus} />
        <Tile label="Scatter days" value={scatter} />
      </div>
      <div className="spread-calendar" aria-label="project spread calendar">
        {items.slice(-30).map((d) => (
          <div
            key={d.date}
            className={`spread-cell kind-${d.kind}`}
            style={{ height: `${Math.max(10, Math.min(36, d.sessions * 6))}px` }}
            title={`${d.date}: ${d.sessions} sessions / ${d.pwds} projects`}
          />
        ))}
      </div>
      <div className="muted small">
        Focus = 3+ sessions on 1 project. Scatter = 3+ sessions across 3+ projects.
      </div>
    </div>
  );
}

function PersonalRecordsCard({
  records,
  workRhythm,
  onOpenSession,
}: {
  records: Insights['personalRecords'];
  workRhythm: Insights['workRhythm'];
  onOpenSession: (id: string) => void;
}) {
  const peakHour = workRhythm.peakHour;
  return (
    <div className="card">
      <div className="card-title">Personal records</div>
      <div className="records-grid">
        <RecordTile
          label="Most active hour"
          value={
            peakHour ? `${DOWS[peakHour.dow]} ${String(peakHour.hour).padStart(2, '0')}:00` : '-'
          }
          detail={peakHour ? `${peakHour.count} sessions` : undefined}
        />
        <button
          className="record-tile record-button"
          disabled={!records.mostCliInSession}
          onClick={() =>
            records.mostCliInSession && onOpenSession(records.mostCliInSession.sessionId)
          }
        >
          <span className="record-value">
            {records.mostCliInSession ? records.mostCliInSession.total : '-'}
          </span>
          <span className="record-label">Most CLI-heavy session</span>
        </button>
      </div>
    </div>
  );
}

function RecentWorkCard({
  recentSessions,
  onOpenSession,
  onOpenSessions,
}: {
  recentSessions: HeaderStats['recentSessions'];
  onOpenSession: (id: string) => void;
  onOpenSessions: () => void;
}) {
  return (
    <div className="card">
      <div className="window-header">
        <div className="card-title" style={{ margin: 0 }}>
          Recent work
        </div>
        <button className="reindex-btn" onClick={onOpenSessions}>
          All sessions
        </button>
      </div>
      <ul className="list">
        {recentSessions.map((s) => (
          <li key={s.id} className="list-row clickable" onClick={() => onOpenSession(s.id)}>
            <span className="ellipsis">{sessionTitle(s)}</span>
            <span className="muted small" title={s.pwd}>
              {projectLabel(s.pwd)} · {relTime(s.modifiedAt)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

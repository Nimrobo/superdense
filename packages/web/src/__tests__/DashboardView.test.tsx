import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';
import { DashboardView } from '../components/DashboardView.js';
import * as apiModule from '../api.js';

vi.mock('../api.js', () => ({
  api: {
    statsHeader: vi.fn(),
    statsWindow: vi.fn(),
    statsInsights: vi.fn(),
  },
}));

const mockHeader: apiModule.HeaderStats = {
  totals: { sessions: 42, distinctPwds: 5, activeDays: 18, distinctAgents: 3 },
  streaks: { current: 4, longest: 9, longestRange: { start: '2026-01-01', end: '2026-01-09' } },
  contributions: Array.from({ length: 180 }).map((_, i) => ({
    date: `2026-01-${String((i % 28) + 1).padStart(2, '0')}`,
    count: i % 5,
  })),
  lastIndexedAt: Date.now() - 60_000,
  recentSessions: [
    {
      id: 's1',
      agent: 'claude-code',
      sessionId: 'abc',
      logPath: '/tmp/abc',
      pwd: '/home/u/project',
      projectKey: '/home/u/project',
      firstPrompt: 'Fix the bug',
      modifiedAt: Date.now() - 30_000,
    },
  ],
  topPwds: [{ pwd: '/home/u/project', count: 15 }],
};

const mockWindow: apiModule.WindowBundle = {
  days: 7,
  window: {
    sessions: 12,
    projects: 3,
    activeDays: 5,
    avgPerActiveDay: 2.4,
    adapterMix: [
      { agent: 'claude-code', count: 8 },
      { agent: 'codex', count: 4 },
    ],
    topClis: [
      { cli: 'git', count: 30 },
      { cli: 'gh', count: 12 },
    ],
    activeProjects: [{ pwd: '/home/u/project', count: 6, activeDays: 3, lastActiveAt: Date.now() }],
    repeatedReturnProjects: [
      { pwd: '/home/u/project', activeDays: 3, sessions: 6, lastActiveAt: Date.now() },
    ],
  },
};

const mockInsights: apiModule.Insights = {
  hourDowHeatmap: Array.from({ length: 7 * 24 }).map((_, i) => ({
    dow: Math.floor(i / 24),
    hour: i % 24,
    count: 0,
  })),
  workRhythm: { peakHour: null, mostConsistentWeekday: null },
  comebackProjects: [],
  dayKinds: [{ date: '2026-05-21', sessions: 3, pwds: 1, kind: 'focus' }],
  personalRecords: {
    bestDay: { date: '2026-05-21', sessions: 8 },
    mostCliInSession: null,
    longestSession: null,
  },
};

const defaultProps = {
  progress: null as null,
  onReindex: vi.fn(),
  onOpenSession: vi.fn(),
  onOpenSessions: vi.fn(),
};

describe('DashboardView', () => {
  beforeEach(() => {
    vi.mocked(apiModule.api.statsHeader).mockResolvedValue(mockHeader);
    vi.mocked(apiModule.api.statsWindow).mockResolvedValue(mockWindow);
    vi.mocked(apiModule.api.statsInsights).mockResolvedValue(mockInsights);
  });

  afterEach(() => cleanup());

  it('shows loading state before stats arrive', () => {
    vi.mocked(apiModule.api.statsHeader).mockImplementation(() => new Promise(() => {}));
    render(<DashboardView {...defaultProps} />);
    expect(screen.getByText('Loading...')).toBeDefined();
  });

  it('shows error state when api.statsHeader fails', async () => {
    vi.mocked(apiModule.api.statsHeader).mockRejectedValue(new Error('Network error'));
    render(<DashboardView {...defaultProps} />);
    await waitFor(() => {
      expect(screen.getByText(/Failed to load/)).toBeDefined();
    });
  });

  it('displays totals row values', async () => {
    render(<DashboardView {...defaultProps} />);
    await waitFor(() => {
      expect(screen.getByText('42')).toBeDefined();
    });
  });

  it('renders the streak number', async () => {
    render(<DashboardView {...defaultProps} />);
    await waitFor(() => {
      expect(screen.getByText('4')).toBeDefined();
      expect(screen.getByText(/day streak/)).toBeDefined();
    });
  });

  it('renders the 7/14/30 segmented toggle and switches', async () => {
    render(<DashboardView {...defaultProps} />);
    await waitFor(() => screen.getByText('7D'));
    fireEvent.click(screen.getByText('14D'));
    await waitFor(() => {
      expect(vi.mocked(apiModule.api.statsWindow)).toHaveBeenCalledWith(14);
    });
  });

  it('renders the empty state when there are zero sessions', async () => {
    vi.mocked(apiModule.api.statsHeader).mockResolvedValue({
      ...mockHeader,
      totals: { sessions: 0, distinctPwds: 0, activeDays: 0, distinctAgents: 0 },
    });
    render(<DashboardView {...defaultProps} />);
    await waitFor(() => {
      expect(screen.getByText('No sessions yet')).toBeDefined();
    });
  });

  it('clicking a recent session calls onOpenSession', async () => {
    const onOpenSession = vi.fn();
    render(<DashboardView {...defaultProps} onOpenSession={onOpenSession} />);
    await waitFor(() => screen.getByText('Fix the bug'));
    fireEvent.click(screen.getByText('Fix the bug'));
    expect(onOpenSession).toHaveBeenCalledWith('s1');
  });

  it('renders revised dashboard sections and no top queries', async () => {
    render(<DashboardView {...defaultProps} />);
    await waitFor(() => screen.getByText(/Contribution heatmap/));
    expect(screen.getByText('Work rhythm')).toBeDefined();
    expect(screen.getByText('Project momentum')).toBeDefined();
    expect(screen.getByText('Focus pattern')).toBeDefined();
    expect(screen.getByText('Personal records')).toBeDefined();
    expect(screen.queryByText('Top queries')).toBeNull();
  });
});

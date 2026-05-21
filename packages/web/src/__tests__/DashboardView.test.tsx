import React from 'react';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';
import { DashboardView } from '../components/DashboardView.js';
import * as apiModule from '../api.js';

vi.mock('../api.js', () => ({
  api: { stats: vi.fn() },
}));

vi.mock('recharts', async () => {
  const { createElement } = await import('react');
  return {
    BarChart: ({ children }: { children?: React.ReactNode }) => createElement('div', { 'data-testid': 'bar-chart' }, children),
    Bar: () => null,
    CartesianGrid: () => null,
    ResponsiveContainer: ({ children }: { children?: React.ReactNode }) => createElement('div', null, children),
    Tooltip: () => null,
    XAxis: () => null,
    YAxis: () => null,
  };
});

const mockStats = {
  totals: { sessions: 42, sessionsLast7d: 10, distinctPwds: 5, distinctAgents: 3, groups: 2 },
  lastIndexedAt: null,
  perDay: [{ date: '2025-01-15', count: 5 }],
  topPwds: [{ pwd: '/home/user/project', count: 15 }],
  topGroups: [{ id: 'g1', name: 'My Group', memberCount: 8 }],
  topTools: [{ tool: 'bash', count: 100 }],
  recentSessions: [
    {
      id: 's1',
      agent: 'claude-code',
      sessionId: 'abc',
      logPath: '/tmp/abc',
      pwd: '/home',
      firstPrompt: 'Fix the bug',
      modifiedAt: Date.now() - 30_000,
    },
  ],
};

const defaultProps = {
  progress: null as null,
  onReindex: vi.fn(),
  onOpenSession: vi.fn(),
  onOpenGroup: vi.fn(),
  onOpenSessions: vi.fn(),
};

describe('DashboardView', () => {
  beforeEach(() => {
    vi.mocked(apiModule.api.stats).mockResolvedValue(mockStats);
  });

  afterEach(() => cleanup());

  it('shows loading state before stats arrive', () => {
    vi.mocked(apiModule.api.stats).mockImplementation(() => new Promise(() => {}));
    render(<DashboardView {...defaultProps} />);
    expect(screen.getByText('Loading…')).toBeDefined();
  });

  it('shows error state when api.stats fails', async () => {
    vi.mocked(apiModule.api.stats).mockRejectedValue(new Error('Network error'));
    render(<DashboardView {...defaultProps} />);
    await waitFor(() => {
      expect(screen.getByText('Failed to load: Network error')).toBeDefined();
    });
  });

  it('displays session count in stat cards', async () => {
    render(<DashboardView {...defaultProps} />);
    await waitFor(() => {
      expect(screen.getByText('Sessions')).toBeDefined();
      expect(screen.getByText('42')).toBeDefined();
    });
  });

  it('displays top working directory basename', async () => {
    render(<DashboardView {...defaultProps} />);
    await waitFor(() => {
      expect(screen.getByText('project')).toBeDefined();
    });
  });

  it('displays group name', async () => {
    render(<DashboardView {...defaultProps} />);
    await waitFor(() => {
      expect(screen.getByText('My Group')).toBeDefined();
    });
  });

  it('displays recent session first prompt', async () => {
    render(<DashboardView {...defaultProps} />);
    await waitFor(() => {
      expect(screen.getByText('Fix the bug')).toBeDefined();
    });
  });

  it('shows idle status when progress is null', async () => {
    render(<DashboardView {...defaultProps} progress={null} />);
    await waitFor(() => {
      expect(screen.getByText('idle')).toBeDefined();
    });
  });

  it('shows indexing progress when busy', async () => {
    render(<DashboardView {...defaultProps} progress={{ phase: 'discover', total: 100, done: 42 }} />);
    await waitFor(() => {
      expect(screen.getByText('discover 42/100')).toBeDefined();
    });
  });

  it('disables Reindex button when indexing is in progress', async () => {
    render(<DashboardView {...defaultProps} progress={{ phase: 'discover', total: 10, done: 5 }} />);
    await waitFor(() => {
      const btn = screen.getByRole('button', { name: 'Reindex' });
      expect((btn as HTMLButtonElement).disabled).toBe(true);
    });
  });

  it('calls onOpenGroup when a group row is clicked', async () => {
    const onOpenGroup = vi.fn();
    render(<DashboardView {...defaultProps} onOpenGroup={onOpenGroup} />);
    await waitFor(() => screen.getByText('My Group'));
    fireEvent.click(screen.getByText('My Group'));
    expect(onOpenGroup).toHaveBeenCalledWith('g1');
  });

  it('calls onOpenSession when a recent session row is clicked', async () => {
    const onOpenSession = vi.fn();
    render(<DashboardView {...defaultProps} onOpenSession={onOpenSession} />);
    await waitFor(() => screen.getByText('Fix the bug'));
    fireEvent.click(screen.getByText('Fix the bug'));
    expect(onOpenSession).toHaveBeenCalledWith('s1');
  });

  it('shows dash for lastIndexedAt when null', async () => {
    render(<DashboardView {...defaultProps} />);
    await waitFor(() => {
      expect(screen.getByText('—')).toBeDefined();
    });
  });

  it('shows no groups placeholder', async () => {
    vi.mocked(apiModule.api.stats).mockResolvedValue({ ...mockStats, topGroups: [] });
    render(<DashboardView {...defaultProps} />);
    await waitFor(() => {
      expect(screen.getByText('No groups yet')).toBeDefined();
    });
  });
});

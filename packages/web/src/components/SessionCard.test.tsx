/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Session } from '../api.js';
import { SessionCard } from './SessionCard.js';

const session: Session = {
  id: 'agent:session-1',
  agent: 'test-agent',
  sessionId: 'session-1',
  logPath: '/tmp/session-1.jsonl',
  pwd: '/tmp/project',
  projectKey: '/tmp/project',
  firstPrompt: 'Build the thing',
  summary: 'A useful session summary',
  messageCount: 3,
  gitBranch: 'feature/session-card',
  createdAt: Date.now() - 120_000,
  modifiedAt: Date.now() - 60_000,
};

describe('SessionCard', () => {
  it('renders the composite session id for troubleshooting', () => {
    render(<SessionCard session={session} onClick={vi.fn()} />);

    expect(screen.getByText('ID agent:session-1')).toBeInTheDocument();
  });

  it('renders as a new-tab anchor when href is supplied', () => {
    render(<SessionCard session={session} href="#session=agent%3Asession-1" />);

    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', '#session=agent%3Asession-1');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('renders a workflow badge only when the session ran a workflow', () => {
    const { rerender } = render(<SessionCard session={session} onClick={vi.fn()} />);
    expect(screen.queryByText('workflow')).not.toBeInTheDocument();

    rerender(
      <SessionCard
        session={{
          ...session,
          workflowSummary: {
            v: 1,
            hasWorkflow: true,
            workflowRunCount: 1,
            workflowToolCallCount: 1,
            workflowEnabled: true,
            effort: 'ultracode',
            ultraEffort: true,
            totalAgents: 3,
            totalTokens: 100,
            totalToolCalls: 5,
            runs: [],
          },
        }}
        onClick={vi.fn()}
      />,
    );
    expect(screen.getByText('workflow')).toBeInTheDocument();
  });

  it('falls back instead of rendering stale internal prompts as titles', () => {
    render(
      <SessionCard
        session={{
          ...session,
          firstPrompt: '<system_instruction>internal setup</system_instruction>',
          summary: null,
        }}
        onClick={vi.fn()}
      />,
    );

    expect(screen.queryByText(/internal setup/)).not.toBeInTheDocument();
    expect(screen.getAllByText(/project/).length).toBeGreaterThan(0);
  });
});

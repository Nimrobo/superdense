/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SessionReader } from './SessionReader.js';
import { api, type Session, type TranscriptEvent } from '../api.js';

vi.mock('../api.js', () => ({
  api: {
    getSession: vi.fn(),
    getTranscript: vi.fn(),
  },
}));

const baseSession: Session = {
  id: 'agent:session-1',
  agent: 'test-agent',
  sessionId: 'session-1',
  logPath: '/tmp/session-1.jsonl',
  pwd: '/tmp/project',
  projectKey: '/tmp/project',
  firstPrompt: 'Build the thing',
  summary: 'A useful session summary',
  messageCount: 3,
  gitBranch: 'feature/session-reader',
  createdAt: Date.now() - 120_000,
  modifiedAt: Date.now() - 60_000,
};

function mockSession(overrides: Partial<Session> = {}) {
  vi.mocked(api.getSession).mockResolvedValue({ ...baseSession, ...overrides });
}

function mockTranscript(events: TranscriptEvent[]) {
  vi.mocked(api.getTranscript).mockResolvedValue({ items: events, offset: 0, limit: 2000 });
}

async function renderReader() {
  render(<SessionReader id="agent:session-1" onBack={vi.fn()} />);
  await screen.findByText(baseSession.agent);
}

describe('SessionReader', () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockSession();
    mockTranscript([]);
  });

  it('renders scannable summary metadata and hides log path behind details', async () => {
    await renderReader();

    expect(screen.getAllByText('Build the thing')).toHaveLength(2);
    expect(screen.getByText('A useful session summary')).toBeInTheDocument();
    expect(screen.getByText('test-agent')).toBeInTheDocument();
    expect(screen.getByText('feature/session-reader')).toBeInTheDocument();
    expect(screen.getByText('3 messages')).toBeInTheDocument();
    expect(screen.getByText(/last activity/)).toBeInTheDocument();

    const logPath = screen.getByText('/tmp/session-1.jsonl');
    expect(logPath).not.toBeVisible();

    await userEvent.click(screen.getByText('Details'));
    expect(logPath).toBeVisible();
  });

  it('falls back when copying without the Clipboard API', async () => {
    const originalExecCommand = document.execCommand;
    const execCommand = vi.fn();
    document.execCommand = execCommand;
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });

    await renderReader();
    await userEvent.click(screen.getByText('Details'));
    await userEvent.click(screen.getByRole('button', { name: 'Copy' }));

    expect(execCommand).toHaveBeenCalledWith('copy');
    document.execCommand = originalExecCommand;
  });

  it('omits empty summary sections', async () => {
    mockSession({ firstPrompt: '   ', summary: null });

    await renderReader();

    expect(screen.queryByRole('heading', { name: 'First prompt' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Summary' })).not.toBeInTheDocument();
    expect(screen.getByText('No summary yet.')).toBeInTheDocument();
  });

  it('filters system events and tool calls without adapter-specific assumptions', async () => {
    mockTranscript([
      { role: 'system', text: 'system setup details' },
      { role: 'assistant', text: 'assistant response' },
      { role: 'assistant', toolName: 'shell', inputText: '{"cmd":"pnpm test"}' },
    ]);

    await renderReader();
    await userEvent.click(screen.getByRole('button', { name: 'Transcript' }));

    expect(screen.queryByText('system setup details')).not.toBeInTheDocument();
    expect(screen.getByText('assistant response')).toBeInTheDocument();
    expect(screen.getByTestId('tool-event-shell')).toBeInTheDocument();

    await userEvent.click(screen.getByLabelText('Show system events'));
    expect(screen.getByText('system setup details')).toBeInTheDocument();

    await userEvent.click(screen.getByLabelText('Show tool calls'));
    expect(screen.queryByTestId('tool-event-shell')).not.toBeInTheDocument();
  });

  it('pairs tool calls and results into one expandable row', async () => {
    const longInput = `{"command":"${'printf hidden-input '.repeat(20)}"}`;
    const resultOutput = 'noisy tool result output that should be hidden while collapsed';

    mockTranscript([
      {
        kind: 'tool_call',
        role: 'assistant',
        toolCallId: 'toolu_pair_1',
        toolName: 'Bash',
        inputText: longInput,
      },
      {
        kind: 'tool_result',
        role: 'user',
        toolCallId: 'toolu_pair_1',
        text: resultOutput,
      },
      { kind: 'text', role: 'assistant', text: 'assistant response after tool' },
    ]);

    await renderReader();
    await userEvent.click(screen.getByRole('button', { name: 'Transcript' }));

    expect(screen.getAllByTestId('tool-event-Bash')).toHaveLength(1);
    expect(screen.queryByText(longInput)).not.toBeInTheDocument();
    expect(screen.queryByText(resultOutput)).not.toBeInTheDocument();
    expect(screen.getByText('assistant response after tool')).toBeInTheDocument();

    const toolRow = screen.getByTestId('tool-event-Bash').closest('.event');
    expect(toolRow).not.toBeNull();
    await userEvent.click(within(toolRow as HTMLElement).getByRole('button', { name: 'Show more' }));

    expect(screen.getByText('Input')).toBeInTheDocument();
    expect(screen.getByText('Result')).toBeInTheDocument();
    expect(screen.getByText(longInput)).toBeInTheDocument();
    expect(screen.getByText(resultOutput)).toBeInTheDocument();

    await userEvent.click(screen.getByLabelText('Show tool calls'));
    expect(screen.queryByTestId('tool-event-Bash')).not.toBeInTheDocument();
    expect(screen.queryByText(resultOutput)).not.toBeInTheDocument();
    expect(screen.getByText('assistant response after tool')).toBeInTheDocument();
  });

  it('hides orphan tool results with the tool-call filter', async () => {
    const orphanOutput = 'orphan result output';

    mockTranscript([
      { kind: 'tool_result', role: 'user', toolCallId: 'missing_call', text: orphanOutput },
      { kind: 'text', role: 'assistant', text: 'visible assistant text' },
    ]);

    await renderReader();
    await userEvent.click(screen.getByRole('button', { name: 'Transcript' }));

    expect(screen.getByTestId('tool-result-event')).toHaveTextContent('result hidden');
    expect(screen.queryByText(orphanOutput)).not.toBeInTheDocument();

    await userEvent.click(screen.getByLabelText('Show tool calls'));
    expect(screen.queryByTestId('tool-result-event')).not.toBeInTheDocument();
    expect(screen.getByText('visible assistant text')).toBeInTheDocument();
  });

  it('expands long rows by original event index when filters change', async () => {
    const hiddenSystemText = 'hidden system event';
    const longToolInput = `{"cmd":"${'x'.repeat(180)}"}`;
    const longAssistantText = `assistant ${'y'.repeat(700)}`;

    mockTranscript([
      { role: 'system', text: hiddenSystemText },
      { role: 'assistant', toolName: 'shell', inputText: longToolInput },
      { role: 'assistant', text: longAssistantText },
    ]);

    await renderReader();
    await userEvent.click(screen.getByRole('button', { name: 'Transcript' }));

    const toolRow = screen.getByTestId('tool-event-shell').closest('.event');
    expect(toolRow).not.toBeNull();
    await userEvent.click(within(toolRow as HTMLElement).getByRole('button', { name: 'Show more' }));
    expect(screen.getByText(longToolInput, { exact: false })).toBeInTheDocument();

    await userEvent.click(screen.getByLabelText('Show system events'));
    expect(screen.getByText(hiddenSystemText)).toBeInTheDocument();
    expect(screen.getByText(longToolInput, { exact: false })).toBeInTheDocument();
    expect(screen.queryByText(longAssistantText)).not.toBeInTheDocument();
  });

  it('renders partial and unknown adapter-normalized events safely', async () => {
    mockTranscript([
      { ts: Date.now() },
      { kind: 'text', role: 'assistant', text: '   ' },
      { role: 'assistant', toolName: 'empty_tool' },
      { role: 'custom-role' as TranscriptEvent['role'], text: 'custom adapter text' },
      { role: 'assistant', text: 'no timestamp event' },
    ]);

    await renderReader();
    await userEvent.click(screen.getByRole('button', { name: 'Transcript' }));

    expect(screen.getByTestId('tool-event-empty_tool')).toHaveTextContent('empty_tool');
    expect(screen.getByText('event')).toBeInTheDocument();
    expect(screen.getByText('custom adapter text')).toBeInTheDocument();
    expect(screen.getByText('no timestamp event')).toBeInTheDocument();
    expect(screen.queryByText('(empty event)')).not.toBeInTheDocument();
  });
});

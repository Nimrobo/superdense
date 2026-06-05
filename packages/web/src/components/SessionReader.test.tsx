/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SessionReader } from './SessionReader.js';
import { api, type Session, type SessionCompactorResponse, type TranscriptEvent } from '../api.js';

vi.mock('../api.js', () => ({
  api: {
    getSession: vi.fn(),
    getSessionCost: vi.fn(),
    getTranscript: vi.fn(),
    runSessionCompactor: vi.fn(),
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

function mockCompactor(result: unknown = { v: 1 }) {
  vi.mocked(api.runSessionCompactor).mockResolvedValue({
    session: baseSession,
    compactor: {
      name: 'trace',
      kind: 'structural',
      targetBytes: 10000,
      description: 'Trace timeline',
    },
    result,
  });
}

function mockCost() {
  vi.mocked(api.getSessionCost).mockResolvedValue({
    sessionId: baseSession.id,
    self: {
      v: 1,
      kind: 'api_equivalent_estimate',
      pricingCatalogVersion: '2026-06-05',
      pricingSources: [],
      pricingStatus: 'estimated',
      estimatedCostUsd: 0.012345,
      tokenTotals: {
        inputTokens: 1000,
        cachedInputTokens: 100,
        cacheCreationInputTokens: 0,
        cacheCreation5mInputTokens: 0,
        cacheCreation1hInputTokens: 0,
        outputTokens: 200,
        reasoningOutputTokens: 50,
        totalTokens: 1200,
      },
      modelBreakdown: [
        {
          provider: 'openai',
          model: 'gpt-5.4',
          tokenTotals: {
            inputTokens: 1000,
            cachedInputTokens: 100,
            cacheCreationInputTokens: 0,
            cacheCreation5mInputTokens: 0,
            cacheCreation1hInputTokens: 0,
            outputTokens: 200,
            reasoningOutputTokens: 50,
            totalTokens: 1200,
          },
          estimatedCostUsd: 0.00425,
          pricingStatus: 'estimated',
          usageEventCount: 1,
        },
      ],
      unpricedModels: [],
      usageEventCount: 1,
    },
    directSubagents: [
      {
        sessionId: 'agent:child-1',
        relation: 'subagent',
        self: null,
        totalWithSubagents: {
          estimatedCostUsd: 0.01,
          pricingStatus: 'estimated',
          tokenTotals: {
            inputTokens: 2000,
            cachedInputTokens: 0,
            cacheCreationInputTokens: 0,
            cacheCreation5mInputTokens: 0,
            cacheCreation1hInputTokens: 0,
            outputTokens: 300,
            reasoningOutputTokens: 0,
            totalTokens: 2300,
          },
          unpricedModels: [],
          sessionCount: 1,
          pricedSessionCount: 1,
        },
      },
    ],
    totalWithSubagents: {
      estimatedCostUsd: 0.022345,
      pricingStatus: 'estimated',
      tokenTotals: {
        inputTokens: 3000,
        cachedInputTokens: 100,
        cacheCreationInputTokens: 0,
        cacheCreation5mInputTokens: 0,
        cacheCreation1hInputTokens: 0,
        outputTokens: 500,
        reasoningOutputTokens: 50,
        totalTokens: 3500,
      },
      unpricedModels: [],
      sessionCount: 2,
      pricedSessionCount: 2,
    },
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
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
    mockCompactor();
    mockCost();
  });

  it('renders a composed header and hides log path behind details', async () => {
    await renderReader();

    expect(screen.getByText('Build the thing')).toBeInTheDocument();
    expect(screen.getByText('project')).toBeInTheDocument();
    expect(screen.getByText('/tmp/project')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Conversation' })).toHaveClass('active');
    expect(api.getTranscript).toHaveBeenCalledWith('agent:session-1', { limit: 2000 });
    expect(screen.queryByText('A useful session summary')).not.toBeInTheDocument();
    expect(screen.getByText('test-agent')).toBeInTheDocument();
    expect(screen.getByText('ID agent:session-1')).toBeInTheDocument();
    expect(screen.getByText('feature/session-reader')).toBeInTheDocument();
    expect(screen.getByText('3 messages')).toBeInTheDocument();
    expect(screen.getByText(/last active/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Summary' }));
    expect(screen.getByText('A useful session summary')).toBeInTheDocument();

    const sessionId = screen.getAllByText('agent:session-1')[0];
    expect(sessionId).not.toBeVisible();
    const logPath = screen.getByText('/tmp/session-1.jsonl');
    expect(logPath).not.toBeVisible();

    await userEvent.click(screen.getByText('Details'));
    expect(sessionId).toBeVisible();
    expect(logPath).toBeVisible();
  });

  it('falls back when copying without the Clipboard API', async () => {
    const originalExecCommand = document.execCommand;
    const execCommand = vi.fn();
    document.execCommand = execCommand;
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });

    await renderReader();
    await userEvent.click(screen.getByRole('button', { name: 'Summary' }));
    await userEvent.click(screen.getByText('Details'));
    await userEvent.click(screen.getByRole('button', { name: 'Copy log path' }));

    expect(execCommand).toHaveBeenCalledWith('copy');
    document.execCommand = originalExecCommand;
  });

  it('omits empty summary sections', async () => {
    mockSession({ firstPrompt: '   ', summary: null });

    await renderReader();
    await userEvent.click(screen.getByRole('button', { name: 'Summary' }));

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

    expect(screen.queryByText('system setup details')).not.toBeInTheDocument();
    expect(await screen.findByText('assistant response')).toBeInTheDocument();
    expect(screen.getByTestId('tool-event-shell')).toBeInTheDocument();

    await userEvent.click(screen.getByLabelText('Show system events'));
    expect(screen.getByText('system setup details')).toBeInTheDocument();

    await userEvent.click(screen.getByLabelText('Show tool calls'));
    expect(screen.queryByTestId('tool-event-shell')).not.toBeInTheDocument();
  });

  it('loads trace compactor output into an inline pretty JSON drawer', async () => {
    const traceResponse: SessionCompactorResponse = {
      session: baseSession,
      compactor: {
        name: 'trace',
        kind: 'structural',
        targetBytes: 10000,
        description: 'Trace timeline',
      },
      result: { v: 1, turns: [{ role: 'user', t: 0, text: 'Build the thing' }] },
    };
    const pending = deferred<typeof traceResponse>();
    vi.mocked(api.runSessionCompactor).mockReturnValueOnce(pending.promise);

    await renderReader();

    expect(screen.getByRole('button', { name: 'Trace' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Salience' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Trace' }));
    expect(screen.getByText('Loading trace compactor...')).toBeInTheDocument();

    pending.resolve(traceResponse);
    const json = await screen.findByTestId('compactor-json');

    expect(api.runSessionCompactor).toHaveBeenCalledWith('agent:session-1', 'trace');
    expect(json.textContent).toBe(JSON.stringify(traceResponse, null, 2));
    expect(screen.getByRole('button', { name: 'Copy JSON' })).toBeInTheDocument();
  });

  it('loads session and sub-agent cost on the Cost tab', async () => {
    await renderReader();

    await userEvent.click(screen.getByRole('button', { name: 'Cost' }));

    expect(api.getSessionCost).toHaveBeenCalledWith('agent:session-1', { tree: true, depth: 20 });
    expect(await screen.findByText('Estimate')).toBeInTheDocument();
    expect(screen.getAllByText('Sub-agents').length).toBeGreaterThan(0);
    expect(screen.getByText('agent:child-1')).toBeInTheDocument();
    expect(screen.getByText('gpt-5.4')).toBeInTheDocument();
  });

  it('shows sub-agent cost even when the parent session has no self cost', async () => {
    vi.mocked(api.getSessionCost).mockResolvedValueOnce({
      sessionId: baseSession.id,
      self: null,
      directSubagents: [
        {
          sessionId: 'agent:child-only',
          relation: 'subagent',
          self: null,
          totalWithSubagents: {
            estimatedCostUsd: 0.02,
            pricingStatus: 'estimated',
            tokenTotals: {
              inputTokens: 4000,
              cachedInputTokens: 0,
              cacheCreationInputTokens: 0,
              cacheCreation5mInputTokens: 0,
              cacheCreation1hInputTokens: 0,
              outputTokens: 500,
              reasoningOutputTokens: 0,
              totalTokens: 4500,
            },
            unpricedModels: [],
            sessionCount: 1,
            pricedSessionCount: 1,
          },
        },
      ],
      totalWithSubagents: {
        estimatedCostUsd: 0.02,
        pricingStatus: 'estimated',
        tokenTotals: {
          inputTokens: 4000,
          cachedInputTokens: 0,
          cacheCreationInputTokens: 0,
          cacheCreation5mInputTokens: 0,
          cacheCreation1hInputTokens: 0,
          outputTokens: 500,
          reasoningOutputTokens: 0,
          totalTokens: 4500,
        },
        unpricedModels: [],
        sessionCount: 1,
        pricedSessionCount: 1,
      },
    });

    await renderReader();
    await userEvent.click(screen.getByRole('button', { name: 'Cost' }));

    expect(await screen.findByText('Estimate')).toBeInTheDocument();
    expect(screen.getByText('agent:child-only')).toBeInTheDocument();
    expect(screen.getAllByText('$0.020').length).toBeGreaterThan(0);
    expect(screen.queryByText('No cost data.')).not.toBeInTheDocument();
  });

  it('switches between cached trace output and salience output', async () => {
    const traceResponse: SessionCompactorResponse = {
      session: baseSession,
      compactor: {
        name: 'trace',
        kind: 'structural',
        targetBytes: 10000,
        description: 'Trace timeline',
      },
      result: { v: 1, turns: [] },
    };
    const salienceResponse: SessionCompactorResponse = {
      session: baseSession,
      compactor: {
        name: 'salience',
        kind: 'semantic',
        targetBytes: 4000,
        description: 'Session salience',
      },
      result: { v: 1, firstAsk: 'Build the thing', decisions: [] },
    };
    vi.mocked(api.runSessionCompactor)
      .mockResolvedValueOnce(traceResponse)
      .mockResolvedValueOnce(salienceResponse);

    await renderReader();
    await userEvent.click(screen.getByRole('button', { name: 'Trace' }));
    expect((await screen.findByTestId('compactor-json')).textContent).toBe(
      JSON.stringify(traceResponse, null, 2),
    );

    await userEvent.click(screen.getByRole('button', { name: 'Salience' }));
    expect((await screen.findByTestId('compactor-json')).textContent).toBe(
      JSON.stringify(salienceResponse, null, 2),
    );

    await userEvent.click(screen.getByRole('button', { name: 'Trace' }));
    expect(screen.getByTestId('compactor-json').textContent).toBe(
      JSON.stringify(traceResponse, null, 2),
    );
    expect(api.runSessionCompactor).toHaveBeenCalledTimes(2);
  });

  it('shows compactor errors without hiding the transcript', async () => {
    mockTranscript([{ kind: 'text', role: 'assistant', text: 'visible assistant text' }]);
    vi.mocked(api.runSessionCompactor).mockRejectedValueOnce(
      new Error('500 Internal Server Error'),
    );

    await renderReader();
    expect(await screen.findByText('visible assistant text')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Salience' }));

    expect(
      await screen.findByText('Failed to load salience: 500 Internal Server Error'),
    ).toBeInTheDocument();
    expect(screen.getByText('visible assistant text')).toBeInTheDocument();
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

    expect(await screen.findByTestId('tool-event-Bash')).toBeInTheDocument();
    expect(screen.getAllByTestId('tool-event-Bash')).toHaveLength(1);
    expect(screen.queryByText(longInput)).not.toBeInTheDocument();
    expect(screen.queryByText(resultOutput)).not.toBeInTheDocument();
    expect(screen.getByText('assistant response after tool')).toBeInTheDocument();

    const toolRow = screen.getByTestId('tool-event-Bash').closest('.event');
    expect(toolRow).not.toBeNull();
    await userEvent.click(
      within(toolRow as HTMLElement).getByRole('button', { name: 'Show more' }),
    );

    expect(screen.getByText('Input')).toBeInTheDocument();
    expect(screen.getByText('Result')).toBeInTheDocument();
    expect(screen.getByText(longInput)).toBeInTheDocument();
    expect(screen.getByText(resultOutput)).toBeInTheDocument();

    await userEvent.click(screen.getByLabelText('Show tool calls'));
    expect(screen.queryByTestId('tool-event-Bash')).not.toBeInTheDocument();
    expect(screen.queryByText(resultOutput)).not.toBeInTheDocument();
    expect(screen.getByText('assistant response after tool')).toBeInTheDocument();
  });

  it('collapses intermediate assistant text and tool calls into a single indicator row', async () => {
    mockTranscript([
      { kind: 'text', role: 'user', text: 'user prompt' },
      { kind: 'text', role: 'assistant', text: 'intermediate narration A' },
      {
        kind: 'tool_call',
        role: 'assistant',
        toolCallId: 'call_1',
        toolName: 'Bash',
        inputText: '{"cmd":"ls"}',
      },
      { kind: 'tool_result', role: 'user', toolCallId: 'call_1', text: 'result 1' },
      { kind: 'text', role: 'assistant', text: 'intermediate narration B' },
      {
        kind: 'tool_call',
        role: 'assistant',
        toolCallId: 'call_2',
        toolName: 'Bash',
        inputText: '{"cmd":"pwd"}',
      },
      { kind: 'tool_result', role: 'user', toolCallId: 'call_2', text: 'result 2' },
      { kind: 'text', role: 'assistant', text: 'final assistant answer' },
    ]);

    await renderReader();
    await screen.findByText('final assistant answer');

    await userEvent.click(screen.getByLabelText('Show tool calls'));

    expect(screen.queryByText('intermediate narration A')).not.toBeInTheDocument();
    expect(screen.queryByText('intermediate narration B')).not.toBeInTheDocument();
    expect(screen.getByText('final assistant answer')).toBeInTheDocument();
    expect(screen.getByText('user prompt')).toBeInTheDocument();
    const indicator = screen.getByTestId('collapsed-tools-row');
    expect(indicator).toHaveTextContent('2 tool calls collapsed');
  });

  it('hides orphan tool results with the tool-call filter', async () => {
    const orphanOutput = 'orphan result output';

    mockTranscript([
      { kind: 'tool_result', role: 'user', toolCallId: 'missing_call', text: orphanOutput },
      { kind: 'text', role: 'assistant', text: 'visible assistant text' },
    ]);

    await renderReader();

    expect(await screen.findByTestId('tool-result-event')).toHaveTextContent('result hidden');
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

    const toolRow = (await screen.findByTestId('tool-event-shell')).closest('.event');
    expect(toolRow).not.toBeNull();
    await userEvent.click(
      within(toolRow as HTMLElement).getByRole('button', { name: 'Show more' }),
    );
    expect(screen.getByText(longToolInput, { exact: false })).toBeInTheDocument();

    await userEvent.click(screen.getByLabelText('Show system events'));
    expect(screen.getByText(hiddenSystemText)).toBeInTheDocument();
    expect(screen.getByText(longToolInput, { exact: false })).toBeInTheDocument();
    expect(screen.queryByText(longAssistantText)).not.toBeInTheDocument();
  });

  it('renders plan-mode enter/exit rows inline with the transcript', async () => {
    mockTranscript([
      { kind: 'text', role: 'user', text: 'first prompt', ts: 1000 },
      { kind: 'mode_change', mode: 'plan', prevMode: undefined, ts: 1100 },
      { kind: 'text', role: 'assistant', text: 'planning response', ts: 1200 },
      { kind: 'mode_change', mode: 'default', prevMode: 'plan', ts: 1300 },
      { kind: 'text', role: 'assistant', text: 'executing response', ts: 1400 },
    ]);

    await renderReader();

    const rows = await screen.findAllByTestId('mode-change-row');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('entered plan mode');
    expect(rows[1]).toHaveTextContent('exited plan mode');
    expect(screen.getByText('planning response')).toBeInTheDocument();
    expect(screen.getByText('executing response')).toBeInTheDocument();

    await userEvent.click(screen.getByLabelText('Show tool calls'));
    expect(screen.getAllByTestId('mode-change-row')).toHaveLength(2);
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

    expect(await screen.findByTestId('tool-event-empty_tool')).toHaveTextContent('empty_tool');
    expect(screen.getByText('event')).toBeInTheDocument();
    expect(screen.getByText('custom adapter text')).toBeInTheDocument();
    expect(screen.getByText('no timestamp event')).toBeInTheDocument();
    expect(screen.queryByText('(empty event)')).not.toBeInTheDocument();
  });
});

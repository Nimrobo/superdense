import { vi, describe, it, expect, beforeEach } from 'vitest';
import { api } from '../api.js';

const mockFetch = vi.fn();
(globalThis as unknown as { fetch: typeof mockFetch }).fetch = mockFetch;

function mockOk(data: unknown) {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: () => Promise.resolve(data),
  });
}

function mockErr(status: number, statusText: string) {
  mockFetch.mockResolvedValueOnce({ ok: false, status, statusText });
}

beforeEach(() => mockFetch.mockClear());

describe('api.stats', () => {
  it('calls /api/stats', async () => {
    mockOk({ totals: {}, lastIndexedAt: null, perDay: [], topPwds: [], topQueries: [], topTools: [], recentSessions: [] });
    const result = await api.stats();
    expect(mockFetch).toHaveBeenCalledWith('/api/stats', expect.objectContaining({ headers: expect.anything() }));
    expect(result).toMatchObject({ totals: {}, perDay: [] });
  });
});

describe('api.listSessions', () => {
  it('calls /api/sessions with no params by default', async () => {
    mockOk({ items: [], total: 0 });
    await api.listSessions();
    expect(mockFetch).toHaveBeenCalledWith('/api/sessions?', expect.anything());
  });

  it('includes q and limit params', async () => {
    mockOk({ items: [], total: 0 });
    await api.listSessions({ q: 'test', limit: 10 });
    expect(mockFetch).toHaveBeenCalledWith('/api/sessions?q=test&limit=10', expect.anything());
  });

  it('URL-encodes the pwd param', async () => {
    mockOk({ items: [], total: 0 });
    await api.listSessions({ pwd: '/home/user' });
    expect(mockFetch).toHaveBeenCalledWith('/api/sessions?pwd=%2Fhome%2Fuser', expect.anything());
  });

  it('includes offset param', async () => {
    mockOk({ items: [], total: 0 });
    await api.listSessions({ offset: 20 });
    expect(mockFetch).toHaveBeenCalledWith('/api/sessions?offset=20', expect.anything());
  });
});

describe('api.getSession', () => {
  it('calls the correct URL', async () => {
    mockOk({ id: 'abc' });
    await api.getSession('abc');
    expect(mockFetch).toHaveBeenCalledWith('/api/sessions/abc', expect.anything());
  });

  it('encodes special characters in id', async () => {
    mockOk({});
    await api.getSession('some/id with spaces');
    expect(mockFetch).toHaveBeenCalledWith('/api/sessions/some%2Fid%20with%20spaces', expect.anything());
  });
});

describe('api.getTranscript', () => {
  it('calls the transcript endpoint', async () => {
    mockOk({ items: [], offset: 0, limit: 100 });
    await api.getTranscript('abc');
    expect(mockFetch).toHaveBeenCalledWith('/api/sessions/abc/transcript?', expect.anything());
  });

  it('includes offset and limit params', async () => {
    mockOk({ items: [], offset: 50, limit: 25 });
    await api.getTranscript('abc', { offset: 50, limit: 25 });
    expect(mockFetch).toHaveBeenCalledWith('/api/sessions/abc/transcript?offset=50&limit=25', expect.anything());
  });
});

describe('api.runSessionCompactor', () => {
  it('calls the session compactor endpoint', async () => {
    mockOk({ session: { id: 'agent:abc' }, compactor: { name: 'trace' }, result: { v: 1 } });
    await api.runSessionCompactor('agent:abc', 'trace');
    expect(mockFetch).toHaveBeenCalledWith('/api/sessions/agent%3Aabc/compactors/trace', expect.anything());
  });
});

describe('api.reindex', () => {
  it('sends POST to /api/reindex', async () => {
    mockOk({ ok: true });
    await api.reindex();
    expect(mockFetch).toHaveBeenCalledWith('/api/reindex', expect.objectContaining({ method: 'POST' }));
  });

  it('appends ?full=1 when full=true', async () => {
    mockOk({ ok: true });
    await api.reindex(true);
    expect(mockFetch).toHaveBeenCalledWith('/api/reindex?full=1', expect.objectContaining({ method: 'POST' }));
  });
});

describe('api.createQuery', () => {
  it('sends POST with JSON body', async () => {
    const query = { filters: { filter: { name: 'session', params: { agent: 'codex' } } }, enrichers: [] };
    mockOk({ id: 'q1' });
    await api.createQuery({ name: 'Q', ...query });
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/saved-queries',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ name: 'Q', ...query }),
      }),
    );
  });
});

describe('api.deleteQuery', () => {
  it('sends DELETE request', async () => {
    mockOk({ ok: true });
    await api.deleteQuery('q1');
    expect(mockFetch).toHaveBeenCalledWith('/api/saved-queries/q1', expect.objectContaining({ method: 'DELETE' }));
  });
});

describe('api.progress', () => {
  it('calls /api/progress', async () => {
    mockOk({ phase: 'idle', total: 0, done: 0 });
    const result = await api.progress();
    expect(mockFetch).toHaveBeenCalledWith('/api/progress', expect.anything());
    expect(result.phase).toBe('idle');
  });
});

describe('error handling', () => {
  it('throws on non-ok response with status and statusText', async () => {
    mockErr(500, 'Internal Server Error');
    await expect(api.stats()).rejects.toThrow('500 Internal Server Error');
  });

  it('throws on 404', async () => {
    mockErr(404, 'Not Found');
    await expect(api.getSession('missing')).rejects.toThrow('404 Not Found');
  });
});

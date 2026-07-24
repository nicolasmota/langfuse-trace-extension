import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LangfuseClient, type LangfuseTrace } from '../langfuse-client.js';

function makeClient(): LangfuseClient {
  return new LangfuseClient({
    host: 'http://127.0.0.1:3000',
    publicKey: 'pk-test',
    secretKey: 'sk-test',
  });
}

function stubGet(client: LangfuseClient, response: unknown): void {
  vi.spyOn(client as unknown as { _get: (path: string) => Promise<unknown> }, '_get')
    .mockResolvedValue(response as Record<string, unknown>);
}

function captureGet(client: LangfuseClient): { calls: string[] } {
  const calls: string[] = [];
  vi.spyOn(client as unknown as { _get: (path: string) => Promise<unknown> }, '_get')
    .mockImplementation(async (path: string) => {
      calls.push(path);
      return { data: [] };
    });
  return { calls };
}

describe('LangfuseClient.fetchSessionTraces', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('prefers the sessions endpoint for a session id', async () => {
    const client = makeClient();
    const calls: string[] = [];
    vi.spyOn(client as unknown as { _get: (path: string) => Promise<unknown> }, '_get')
      .mockImplementation(async (path: string) => {
        calls.push(path);
        return { id: 'my-session-123', traces: [{ id: 'trace-1' }] };
      });
    const result = await client.fetchSessionTraces('my-session-123');
    expect(result).toHaveLength(1);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toBe('/api/public/sessions/my-session-123');
  });

  it('URL-encodes the sessionId on the sessions endpoint', async () => {
    const client = makeClient();
    const calls: string[] = [];
    vi.spyOn(client as unknown as { _get: (path: string) => Promise<unknown> }, '_get')
      .mockImplementation(async (path: string) => {
        calls.push(path);
        return { id: 'encoded-session', traces: [{ id: 'trace-1' }] };
      });
    await client.fetchSessionTraces('session/with spaces&special=chars');
    expect(calls[0]).toBe(`/api/public/sessions/${encodeURIComponent('session/with spaces&special=chars')}`);
  });

  it('falls back to the traces list when the sessions endpoint has no traces', async () => {
    const client = makeClient();
    const calls: string[] = [];
    vi.spyOn(client as unknown as { _get: (path: string) => Promise<unknown> }, '_get')
      .mockImplementation(async (path: string) => {
        calls.push(path);
        if (path.startsWith('/api/public/sessions/')) {
          return { id: 'empty-session', traces: [] };
        }
        return { data: [] };
      });
    const result = await client.fetchSessionTraces('empty-session');
    expect(result).toEqual([]);
    expect(calls.some(path => path.includes('sessionId=empty-session'))).toBe(true);
  });

  it('returns traces embedded in the sessions endpoint response', async () => {
    const client = makeClient();
    const traces: Partial<LangfuseTrace>[] = [
      { id: 'trace-1', name: 'chat' },
      { id: 'trace-2', name: 'chat' },
    ];
    stubGet(client, { id: 'session-abc', traces });
    const result = await client.fetchSessionTraces('session-abc');
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('trace-1');
    expect(result[1].id).toBe('trace-2');
  });

  it('propagates errors thrown by the HTTP layer', async () => {
    const client = makeClient();
    vi.spyOn(client as unknown as { _get: (path: string) => Promise<unknown> }, '_get')
      .mockRejectedValue(new Error('Langfuse API error 401: Unauthorized'));
    await expect(client.fetchSessionTraces('any-session')).rejects.toThrow('401');
  });
});

describe('LangfuseClient.fetchFullTrace', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('calls the API with the correct trace ID in the path', async () => {
    const client = makeClient();
    const { calls } = captureGet(client);
    await client.fetchFullTrace('trace-abc-123');
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('trace-abc-123');
  });

  it('URL-encodes the trace ID', async () => {
    const client = makeClient();
    const { calls } = captureGet(client);
    await client.fetchFullTrace('trace/with-slash');
    expect(calls[0]).toContain(encodeURIComponent('trace/with-slash'));
  });

  it('returns the full trace object from the API response', async () => {
    const client = makeClient();
    const fullTrace = { id: 'trace-1', name: 'run', observations: [{ id: 'obs-1' }] };
    stubGet(client, fullTrace);
    const result = await client.fetchFullTrace('trace-1');
    expect(result.id).toBe('trace-1');
    expect(result.observations).toHaveLength(1);
  });

  it('propagates errors thrown by the HTTP layer', async () => {
    const client = makeClient();
    vi.spyOn(client as unknown as { _get: (path: string) => Promise<unknown> }, '_get')
      .mockRejectedValue(new Error('Langfuse API error 404: Not Found'));
    await expect(client.fetchFullTrace('missing-trace')).rejects.toThrow('404');
  });
});

describe('LangfuseClient.fetchRecentSessions', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('calls the sessions API with limit and page parameters', async () => {
    const client = makeClient();
    const { calls } = captureGet(client);
    await client.fetchRecentSessions(10);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toBe('/api/public/sessions?limit=10&page=1');
  });

  it('clamps the limit between 1 and 100', async () => {
    const client = makeClient();
    const { calls } = captureGet(client);
    await client.fetchRecentSessions(500);
    expect(calls[0]).toContain('limit=100');
  });

  it('returns sessions from the API response', async () => {
    const client = makeClient();
    stubGet(client, {
      data: [{ id: 'session-1', createdAt: '2026-01-01T00:00:00.000Z' }],
    });
    const result = await client.fetchRecentSessions(5);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('session-1');
  });
});

describe('LangfuseClient constructor', () => {
  it('strips a trailing slash from the host', () => {
    const client = new LangfuseClient({
      host: 'http://127.0.0.1:3000/',
      publicKey: 'pk',
      secretKey: 'sk',
    });
    const { calls } = captureGet(client);
    client.fetchSessionTraces('s').catch(() => {});
    expect(calls[0]).not.toMatch(/\/\//);
  });
});

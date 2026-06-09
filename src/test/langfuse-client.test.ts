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

  it('calls the API with the correct sessionId query parameter', async () => {
    const client = makeClient();
    const { calls } = captureGet(client);
    await client.fetchSessionTraces('my-session-123');
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('sessionId=my-session-123');
  });

  it('URL-encodes the sessionId', async () => {
    const client = makeClient();
    const { calls } = captureGet(client);
    await client.fetchSessionTraces('session/with spaces&special=chars');
    expect(calls[0]).toContain(encodeURIComponent('session/with spaces&special=chars'));
  });

  it('returns an empty array when the API response has no data', async () => {
    const client = makeClient();
    stubGet(client, {});
    const result = await client.fetchSessionTraces('empty-session');
    expect(result).toEqual([]);
  });

  it('returns the traces array from the API response', async () => {
    const client = makeClient();
    const traces: Partial<LangfuseTrace>[] = [
      { id: 'trace-1', name: 'chat' },
      { id: 'trace-2', name: 'chat' },
    ];
    stubGet(client, { data: traces });
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

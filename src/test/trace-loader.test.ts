import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LangfuseClient } from '../langfuse-client.js';
import { loadByTraceIdWithConfig } from '../trace-loader.js';

describe('loadByTraceIdWithConfig', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('expands to the parent session when the trace has a sessionId', async () => {
    vi.spyOn(LangfuseClient.prototype, 'fetchFullTrace').mockImplementation(async (traceId: string) => ({
      id: traceId,
      sessionId: 'session-1',
      observations: [{ id: `obs-${traceId}`, traceId }],
    }));
    vi.spyOn(LangfuseClient.prototype, 'fetchSessionTraces').mockResolvedValue([
      { id: 'trace-a' },
      { id: 'trace-b' },
    ]);

    const result = await loadByTraceIdWithConfig(
      { host: 'http://127.0.0.1:3000', publicKey: 'pk-test', secretKey: 'sk-test' },
      'trace-b',
    );

    expect(result).not.toBeNull();
    expect(result?.panelKey).toBe('session-1');
    expect(result?.sessionId).toBe('session-1');
    expect(result?.fullTraces.map(t => t.id)).toEqual(['trace-a', 'trace-b']);
    expect(result?.focusTraceId).toBe('trace-b');
  });

  it('returns a single trace when no sessionId is present', async () => {
    vi.spyOn(LangfuseClient.prototype, 'fetchFullTrace').mockResolvedValue({
      id: 'trace-solo',
      observations: [{ id: 'obs-1', traceId: 'trace-solo' }],
    });

    const result = await loadByTraceIdWithConfig(
      { host: 'http://127.0.0.1:3000', publicKey: 'pk-test', secretKey: 'sk-test' },
      'trace-solo',
    );

    expect(result).toEqual({
      panelKey: 'trace-solo',
      sessionId: undefined,
      fullTraces: [{ id: 'trace-solo', observations: [{ id: 'obs-1', traceId: 'trace-solo' }] }],
      observations: [{ id: 'obs-1', traceId: 'trace-solo' }],
      focusTraceId: 'trace-solo',
    });
  });

  it('returns null when the trace cannot be fetched', async () => {
    vi.spyOn(LangfuseClient.prototype, 'fetchFullTrace').mockRejectedValue(new Error('404'));

    const result = await loadByTraceIdWithConfig(
      { host: 'http://127.0.0.1:3000', publicKey: 'pk-test', secretKey: 'sk-test' },
      'missing-trace',
    );

    expect(result).toBeNull();
  });
});

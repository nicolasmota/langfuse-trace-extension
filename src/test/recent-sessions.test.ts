import { describe, it, expect, vi, beforeEach } from 'vitest';
import { loadRecentLangfuseSessions } from '../session/recent.js';
import { LangfuseClient } from '../langfuse-client.js';

function makeMemento(hidden: string[] = []) {
  return {
    get: vi.fn((key: string, defaultValue: unknown) => {
      if (key === 'langfuse.hiddenSessions') { return hidden; }
      return defaultValue;
    }),
    update: vi.fn(async () => undefined),
    keys: vi.fn(() => []),
  };
}

describe('loadRecentLangfuseSessions', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('filters sessions hidden in global state', async () => {
    vi.spyOn(LangfuseClient.prototype, 'fetchRecentSessions').mockResolvedValue([
      { id: 'visible', createdAt: '2026-01-02T00:00:00.000Z' },
      { id: 'hidden', createdAt: '2026-01-01T00:00:00.000Z' },
    ]);

    const sessions = await loadRecentLangfuseSessions(
      makeMemento(['hidden']),
      { host: 'http://127.0.0.1:3000', publicKey: 'pk', secretKey: 'sk' },
      10,
    );
    expect(sessions.map(s => s.id)).toEqual(['visible']);
  });
});

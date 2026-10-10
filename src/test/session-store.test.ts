import { describe, it, expect, beforeEach } from 'vitest';
import type * as vscode from 'vscode';
import {
  forgetSession,
  pinSession,
  readPinnedSessions,
  readRecentSessions,
  rememberSession,
  unpinSession,
} from '../session/store.js';

function createMemento(): vscode.Memento {
  const store = new Map<string, unknown>();
  return {
    keys: () => [...store.keys()],
    get: <T>(key: string, defaultValue: T) => (store.has(key) ? store.get(key) as T : defaultValue),
    update: async (key: string, value: unknown) => { store.set(key, value); },
  };
}

describe('session-store', () => {
  let memento: vscode.Memento;

  beforeEach(() => {
    memento = createMemento();
  });

  it('returns empty list initially', () => {
    expect(readRecentSessions(memento)).toEqual([]);
  });

  it('remembers sessions with most recent first', async () => {
    await rememberSession(memento, 'session-a');
    await rememberSession(memento, 'session-b');
    await rememberSession(memento, 'session-a');

    const sessions = readRecentSessions(memento);
    expect(sessions.map(s => s.sessionId)).toEqual(['session-a', 'session-b']);
  });

  it('removes a session from recents', async () => {
    await rememberSession(memento, 'session-a');
    await rememberSession(memento, 'session-b');
    await forgetSession(memento, 'session-a');

    expect(readRecentSessions(memento).map(s => s.sessionId)).toEqual(['session-b']);
  });

  it('pins sessions with the latest pin first and ignores duplicates', async () => {
    await pinSession(memento, 'session-a');
    await pinSession(memento, 'session-b');
    await pinSession(memento, 'session-a');
    expect(readPinnedSessions(memento)).toEqual(['session-a', 'session-b']);
  });

  it('unpins a session', async () => {
    await pinSession(memento, 'session-a');
    await pinSession(memento, 'session-b');
    await unpinSession(memento, 'session-a');
    expect(readPinnedSessions(memento)).toEqual(['session-b']);
  });
});

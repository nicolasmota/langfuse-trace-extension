import type * as vscode from 'vscode';

const STORAGE_KEY = 'langfuse.recentSessions';
const HIDDEN_KEY = 'langfuse.hiddenSessions';
const MAX_RECENT = 20;

/** A Langfuse session remembered in the sidebar recent list. */
export interface RecentSession {
  sessionId: string;
  lastOpened: number;
}

async function updateStore<T>(
  globalState: vscode.Memento,
  key: string,
  defaultValue: T,
  updater: (current: T) => T,
): Promise<T> {
  const current = globalState.get<T>(key, defaultValue);
  const next = updater(current);
  await globalState.update(key, next);
  return next;
}

/** Reads recent sessions sorted by most recently opened first. */
export function readRecentSessions(globalState: vscode.Memento): RecentSession[] {
  const stored = globalState.get<RecentSession[]>(STORAGE_KEY, []);
  return [...stored].sort((a, b) => b.lastOpened - a.lastOpened);
}

/** Adds or bumps a session in the recent list and persists it. */
export async function rememberSession(
  globalState: vscode.Memento,
  sessionId: string,
): Promise<RecentSession[]> {
  const trimmed = sessionId.trim();
  if (!trimmed) { return readRecentSessions(globalState); }
  return updateStore<RecentSession[]>(globalState, STORAGE_KEY, [], current => {
    const filtered = current.filter(s => s.sessionId !== trimmed);
    return [{ sessionId: trimmed, lastOpened: Date.now() }, ...filtered]
      .sort((a, b) => b.lastOpened - a.lastOpened)
      .slice(0, MAX_RECENT);
  });
}

/** Removes a session from the recent list. */
export async function forgetSession(
  globalState: vscode.Memento,
  sessionId: string,
): Promise<RecentSession[]> {
  return updateStore<RecentSession[]>(globalState, STORAGE_KEY, [], current =>
    current.filter(s => s.sessionId !== sessionId),
  );
}

/** Reads session IDs hidden from the sidebar list. */
export function readHiddenSessions(globalState: vscode.Memento): string[] {
  return globalState.get<string[]>(HIDDEN_KEY, []);
}

/** Hides a session from the sidebar without deleting it in Langfuse. */
export async function hideSession(
  globalState: vscode.Memento,
  sessionId: string,
): Promise<string[]> {
  const trimmed = sessionId.trim();
  if (!trimmed) { return readHiddenSessions(globalState); }
  return updateStore<string[]>(globalState, HIDDEN_KEY, [], current => {
    const hidden = new Set(current);
    hidden.add(trimmed);
    return [...hidden];
  });
}

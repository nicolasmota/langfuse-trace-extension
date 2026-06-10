import type { Memento } from 'vscode';
import type { LangfuseConfig, LangfuseSession } from '../langfuse-client.js';
import { LangfuseClient } from '../langfuse-client.js';
import { readHiddenSessions } from './store.js';

/**
 * Fetches the latest Langfuse sessions, excluding any the user hid from the sidebar.
 */
export async function loadRecentLangfuseSessions(
  globalState: Memento,
  config: LangfuseConfig,
  limit: number,
): Promise<LangfuseSession[]> {
  const client = new LangfuseClient(config);
  const sessions = await client.fetchRecentSessions(limit);
  const hidden = new Set(readHiddenSessions(globalState));
  return sessions.filter(session => !hidden.has(session.id));
}

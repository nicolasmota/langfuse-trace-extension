import * as vscode from 'vscode';
import { LangfuseConfig, buildLangfuseConfig } from './langfuse-client';
import { loadTracesAndObservationsWithConfig } from './trace-loader';

const DEFAULT_RECENT_SESSIONS_LIMIT = 10;
const MAX_RECENT_SESSIONS_LIMIT = 100;

export const SECRET_KEY_STORAGE_ID = 'langfuse.secretKey';

/** Reads how many recent Langfuse sessions to show in the sidebar. */
export function readRecentSessionsLimit(): number {
  const configured = vscode.workspace.getConfiguration('langfuse')
    .get<number>('recentSessionsLimit', DEFAULT_RECENT_SESSIONS_LIMIT);
  if (!Number.isFinite(configured)) { return DEFAULT_RECENT_SESSIONS_LIMIT; }
  return Math.max(1, Math.min(Math.trunc(configured), MAX_RECENT_SESSIONS_LIMIT));
}

/** Reads Langfuse connection settings from VS Code configuration with local defaults. */
export function readLangfuseConfig(): LangfuseConfig {
  const config = vscode.workspace.getConfiguration('langfuse');
  return buildLangfuseConfig({
    host: config.get<string>('host'),
    publicKey: config.get<string>('publicKey'),
    secretKey: config.get<string>('secretKey'),
  });
}

/**
 * Reads Langfuse connection settings, preferring a secret key stored in VS Code
 * SecretStorage over the plaintext workspace setting.
 */
export async function readLangfuseConfigAsync(secrets: vscode.SecretStorage): Promise<LangfuseConfig> {
  const config = vscode.workspace.getConfiguration('langfuse');
  const storedSecret = await secrets.get(SECRET_KEY_STORAGE_ID);
  return buildLangfuseConfig({
    host: config.get<string>('host'),
    publicKey: config.get<string>('publicKey'),
    secretKey: storedSecret ?? config.get<string>('secretKey'),
  });
}

/**
 * Fetches full traces and their flattened observations for a given Langfuse session.
 * Returns null when no traces are found (session not yet traced or not flushed).
 */
export async function loadTracesAndObservations(sessionId: string, secrets?: vscode.SecretStorage) {
  const config = secrets ? await readLangfuseConfigAsync(secrets) : readLangfuseConfig();
  return loadTracesAndObservationsWithConfig(config, sessionId);
}

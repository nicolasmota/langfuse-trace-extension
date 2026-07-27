import * as vscode from 'vscode';
import { LangfuseConfig, buildLangfuseConfig } from './langfuse-client';
import { loadTracesAndObservationsWithConfig } from './trace-loader';
import { readVaultCredentialSettingsFromConfig } from './vault-settings';

const DEFAULT_RECENT_SESSIONS_LIMIT = 10;
const MAX_RECENT_SESSIONS_LIMIT = 100;

export const SECRET_KEY_STORAGE_ID = 'langfuse.secretKey';
export const PUBLIC_KEY_STORAGE_ID = 'langfuse.publicKey';
export const HOST_STORAGE_ID = 'langfuse.host';

/** Reads how many recent Langfuse sessions to show in the sidebar. */
export function readRecentSessionsLimit(): number {
  const configured = vscode.workspace.getConfiguration('langfuse')
    .get<number>('recentSessionsLimit', DEFAULT_RECENT_SESSIONS_LIMIT);
  if (!Number.isFinite(configured)) { return DEFAULT_RECENT_SESSIONS_LIMIT; }
  return Math.max(1, Math.min(Math.trunc(configured), MAX_RECENT_SESSIONS_LIMIT));
}

/** Reads Vault CLI settings used by Sync Credentials from Vault. */
export function readVaultCredentialSettings() {
  return readVaultCredentialSettingsFromConfig();
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
 * Reads Langfuse connection settings, preferring API keys stored in VS Code
 * SecretStorage over plaintext workspace settings. Host always comes from settings.
 */
export async function readLangfuseConfigAsync(secrets: vscode.SecretStorage): Promise<LangfuseConfig> {
  const config = vscode.workspace.getConfiguration('langfuse');
  const [storedPublic, storedSecret] = await Promise.all([
    secrets.get(PUBLIC_KEY_STORAGE_ID),
    secrets.get(SECRET_KEY_STORAGE_ID),
  ]);
  return buildLangfuseConfig({
    host: config.get<string>('host'),
    publicKey: storedPublic ?? config.get<string>('publicKey'),
    secretKey: storedSecret ?? config.get<string>('secretKey'),
  });
}

/**
 * Persists Langfuse API keys in SecretStorage (and optionally updates host setting).
 */
export async function storeLangfuseCredentials(
  secrets: vscode.SecretStorage,
  credentials: LangfuseConfig,
  options?: { updateHostSetting?: boolean },
): Promise<void> {
  await Promise.all([
    secrets.store(PUBLIC_KEY_STORAGE_ID, credentials.publicKey),
    secrets.store(SECRET_KEY_STORAGE_ID, credentials.secretKey),
    // Host belongs in settings; clear any legacy SecretStorage host entry.
    secrets.delete(HOST_STORAGE_ID),
  ]);
  if (options?.updateHostSetting) {
    await vscode.workspace.getConfiguration('langfuse').update(
      'host',
      credentials.host,
      vscode.ConfigurationTarget.Global,
    );
  }
}

/**
 * Fetches full traces and their flattened observations for a given Langfuse session.
 * Returns null when no traces are found (session not yet traced or not flushed).
 */
export async function loadTracesAndObservations(sessionId: string, secrets?: vscode.SecretStorage) {
  const config = secrets ? await readLangfuseConfigAsync(secrets) : readLangfuseConfig();
  return loadTracesAndObservationsWithConfig(config, sessionId);
}

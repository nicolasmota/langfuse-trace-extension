import * as vscode from 'vscode';
import { LangfuseConfig, buildLangfuseConfig } from './langfuse-client';
import { loadByTraceIdWithConfig, loadTracesAndObservationsWithConfig } from './trace-loader';

const DEFAULT_RECENT_SESSIONS_LIMIT = 10;
const MAX_RECENT_SESSIONS_LIMIT = 100;

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
 * Fetches full traces and their flattened observations for a given Langfuse session.
 * Returns null when no traces are found (session not yet traced or not flushed).
 */
export async function loadTracesAndObservations(sessionId: string) {
  return loadTracesAndObservationsWithConfig(readLangfuseConfig(), sessionId);
}

/** Loads a trace by ID, expanding to its session when available. */
export async function loadByTraceId(traceId: string) {
  return loadByTraceIdWithConfig(readLangfuseConfig(), traceId);
}

import * as vscode from 'vscode';
import { LangfuseClient, LangfuseConfig, defaultLangfuseConfig } from './langfuse-client';

/** Reads Langfuse connection settings from VS Code configuration with local defaults. */
export function readLangfuseConfig(): LangfuseConfig {
  const defaults = defaultLangfuseConfig();
  const config = vscode.workspace.getConfiguration('langfuse');
  return {
    host: config.get<string>('host', defaults.host).trim() || defaults.host,
    publicKey: config.get<string>('publicKey', defaults.publicKey).trim() || defaults.publicKey,
    secretKey: config.get<string>('secretKey', defaults.secretKey).trim() || defaults.secretKey,
  };
}

/**
 * Fetches full traces and their flattened observations for a given Langfuse session.
 * Returns null when no traces are found (session not yet traced or not flushed).
 */
export async function loadTracesAndObservations(sessionId: string) {
  const client = new LangfuseClient(readLangfuseConfig());
  const traces = await client.fetchSessionTraces(sessionId);
  if (traces.length === 0) { return null; }
  const fullTraces = await Promise.all(traces.map(t => client.fetchFullTrace(t.id)));
  return { fullTraces, observations: fullTraces.flatMap(t => t.observations ?? []) };
}

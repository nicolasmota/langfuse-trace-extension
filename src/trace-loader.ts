import { LangfuseClient, type LangfuseConfig } from './langfuse-client.js';

/**
 * Fetches full traces and their flattened observations for a given Langfuse session.
 * Returns null when no traces are found (session not yet traced or not flushed).
 */
export async function loadTracesAndObservationsWithConfig(config: LangfuseConfig, sessionId: string) {
  const client = new LangfuseClient(config);
  const traces = await client.fetchSessionTraces(sessionId);
  if (traces.length === 0) { return null; }
  const fullTraces = await Promise.all(traces.map(t => client.fetchFullTrace(t.id)));
  return { fullTraces, observations: fullTraces.flatMap(t => t.observations ?? []) };
}

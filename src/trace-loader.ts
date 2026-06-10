import {
  LangfuseClient,
  type LangfuseConfig,
  type LangfuseObservation,
  type LangfuseTrace,
} from './langfuse-client.js';

export interface TraceLoadResult {
  panelKey: string;
  sessionId?: string;
  fullTraces: LangfuseTrace[];
  observations: LangfuseObservation[];
  focusTraceId: string;
}

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

/**
 * Loads a trace by ID and, when present, expands to the full parent session.
 * Traces without a sessionId open as a single-trace panel keyed by the trace ID.
 */
export async function loadByTraceIdWithConfig(
  config: LangfuseConfig,
  traceId: string,
): Promise<TraceLoadResult | null> {
  const client = new LangfuseClient(config);
  const trimmedTraceId = traceId.trim();
  if (!trimmedTraceId) { return null; }

  let fullTrace: LangfuseTrace & { observations: LangfuseObservation[] };
  try {
    fullTrace = await client.fetchFullTrace(trimmedTraceId);
  } catch {
    return null;
  }

  const sessionId = fullTrace.sessionId?.trim();
  if (sessionId) {
    const sessionData = await loadTracesAndObservationsWithConfig(config, sessionId);
    if (sessionData) {
      return {
        panelKey: sessionId,
        sessionId,
        fullTraces: sessionData.fullTraces,
        observations: sessionData.observations,
        focusTraceId: trimmedTraceId,
      };
    }
  }

  return {
    panelKey: sessionId ?? trimmedTraceId,
    sessionId,
    fullTraces: [fullTrace],
    observations: fullTrace.observations ?? [],
    focusTraceId: trimmedTraceId,
  };
}

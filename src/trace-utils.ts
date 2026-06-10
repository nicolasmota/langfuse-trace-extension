import type { LangfuseObservation, LangfuseTrace } from './langfuse-client.js';

export interface TraceSummary {
  trace: LangfuseTrace;
  observations: LangfuseObservation[];
  minStart: number;
  maxEnd: number;
  totalMs: number;
  tokenInput: number;
  tokenOutput: number;
}

/** Returns true when value is neither null nor undefined. */
export function isDefined<T>(v: T | null | undefined): v is T {
  return v !== null && v !== undefined;
}

/** Formats an ISO timestamp to a locale time string with millisecond precision. */
export function fmtDate(iso?: string): string {
  if (!iso) { return '—'; }
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) { return iso; }
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 3 });
  } catch {
    return iso;
  }
}

/** Formats a duration in milliseconds to a human-readable string. */
export function fmtMs(ms?: number): string {
  if (!isDefined(ms)) { return '—'; }
  if (ms >= 1000) { return (ms / 1000).toFixed(2) + 's'; }
  return ms.toFixed(0) + 'ms';
}

/** Returns the duration in milliseconds for an observation, preferring the latency field. */
export function durationMs(obs: LangfuseObservation): number | undefined {
  if (isDefined(obs.latency)) { return obs.latency * 1000; }
  if (obs.startTime && obs.endTime) {
    return new Date(obs.endTime).getTime() - new Date(obs.startTime).getTime();
  }
  return undefined;
}

/** Returns the CSS color variable for a given observation type. */
export function observationTypeColor(type?: string): string {
  switch ((type ?? '').toUpperCase()) {
    case 'GENERATION': return 'var(--vscode-terminal-ansiGreen)';
    case 'SPAN': return 'var(--vscode-terminal-ansiBlue)';
    case 'EVENT': return 'var(--vscode-terminal-ansiYellow)';
    default: return 'var(--vscode-descriptionForeground)';
  }
}

/**
 * Computes aggregate token usage for a trace from its observations.
 * When the trace-level `usage` field is absent (common with OTel-based
 * local Langfuse), sums GENERATION observations deduplicated by startTime
 * to avoid double-counting wrapper/inner spans that share the same call.
 */
export function computeTraceTokens(
  trace: LangfuseTrace,
  traceObs: LangfuseObservation[],
): { input: number; output: number } {
  const traceCast = trace as unknown as { usage?: { input?: number; output?: number } };
  if (traceCast.usage && ((traceCast.usage.input ?? 0) + (traceCast.usage.output ?? 0)) > 0) {
    return { input: traceCast.usage.input ?? 0, output: traceCast.usage.output ?? 0 };
  }
  const genObs = traceObs.filter(o => o.type === 'GENERATION' && isDefined(o.usage));
  const byStart = new Map<string, LangfuseObservation>();
  for (const o of genObs) {
    const key = o.startTime ?? o.id;
    if (!byStart.has(key)) { byStart.set(key, o); }
  }
  let input = 0; let output = 0;
  for (const o of byStart.values()) {
    input += o.usage?.input ?? 0;
    output += o.usage?.output ?? 0;
  }
  return { input, output };
}

/**
 * Computes the nesting depth of each observation within the trace by walking
 * the parentObservationId chain. Depth 0 = root (no parent in the set).
 */
export function computeDepths(obs: LangfuseObservation[]): Map<string, number> {
  const idSet = new Set(obs.map(o => o.id));
  const depths = new Map<string, number>();

  function depthOf(id: string): number {
    if (depths.has(id)) { return depths.get(id)!; }
    const o = obs.find(x => x.id === id);
    if (!o || !o.parentObservationId || !idSet.has(o.parentObservationId)) {
      depths.set(id, 0);
      return 0;
    }
    const d = depthOf(o.parentObservationId) + 1;
    depths.set(id, d);
    return d;
  }

  obs.forEach(o => depthOf(o.id));
  return depths;
}

/** Sorts traces newest-first, matching the trace viewer panel display order. */
export function sortTracesNewestFirst(traces: LangfuseTrace[]): LangfuseTrace[] {
  return [...traces].sort((a, b) => {
    const ta = a.timestamp ? new Date(a.timestamp as string).getTime() : 0;
    const tb = b.timestamp ? new Date(b.timestamp as string).getTime() : 0;
    return tb - ta;
  });
}

/** Returns the panel index for a trace ID after newest-first sorting. */
export function focusIndexForTraceId(traces: LangfuseTrace[], traceId: string): number {
  const idx = sortTracesNewestFirst(traces).findIndex(t => t.id === traceId);
  return idx >= 0 ? idx : 0;
}

/** Builds a TraceSummary for each trace, aggregating timing and token usage. */
export function buildTraceSummaries(traces: LangfuseTrace[], observations: LangfuseObservation[]): TraceSummary[] {
  return traces.map(trace => {
    const traceObs = observations
      .filter(o => o.traceId === trace.id)
      .sort((a, b) => {
        const ta = a.startTime ? new Date(a.startTime).getTime() : 0;
        const tb = b.startTime ? new Date(b.startTime).getTime() : 0;
        if (ta !== tb) { return ta - tb; }
        const da = isDefined(a.latency) ? a.latency : 0;
        const db = isDefined(b.latency) ? b.latency : 0;
        return db - da;
      });
    const starts = traceObs.map(o => o.startTime ? new Date(o.startTime).getTime() : Infinity).filter(isFinite);
    const ends = traceObs.map(o => o.endTime ? new Date(o.endTime).getTime() : -Infinity).filter(n => n !== -Infinity);
    const traceStart = trace.timestamp ? new Date(trace.timestamp).getTime() : (starts.length ? Math.min(...starts) : 0);
    const minStart = starts.length ? Math.min(...starts, traceStart) : traceStart;
    const maxEnd = ends.length ? Math.max(...ends) : traceStart;
    const traceCast = trace as unknown as { latency?: number };
    const totalMs = maxEnd > minStart ? maxEnd - minStart : isDefined(traceCast.latency) ? traceCast.latency * 1000 : 0;
    const { input: tokenInput, output: tokenOutput } = computeTraceTokens(trace, traceObs);
    return { trace, observations: traceObs, minStart, maxEnd, totalMs, tokenInput, tokenOutput };
  });
}

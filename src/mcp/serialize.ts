import type { LangfuseObservation, LangfuseTrace } from '../langfuse-client.js';
import { buildTraceSummaries, computeDepths, durationMs } from '../trace-utils.js';

const SUMMARY_TEXT_LIMIT = 500;

/** Compact span metadata for MCP session listings. */
export interface McpSpanSummary {
  id: string;
  name?: string;
  type?: string;
  depth: number;
  durationMs?: number;
  model?: string;
  tokens?: { input?: number; output?: number };
  level?: string;
  statusMessage?: string;
  parentObservationId?: string;
}

/** Compact trace metadata for MCP session listings. */
export interface McpTraceSummary {
  id: string;
  name?: string;
  timestamp?: string;
  totalMs: number;
  tokenInput: number;
  tokenOutput: number;
  totalCost?: number;
  inputPreview?: string;
  outputPreview?: string;
  spans: McpSpanSummary[];
}

/** Full session snapshot exposed to Cursor chat via MCP tools and resources. */
export interface McpSessionSnapshot {
  sessionId: string;
  traceCount: number;
  observationCount: number;
  traces: McpTraceSummary[];
}

/** Detailed span payload including full input and output. */
export interface McpSpanDetail {
  traceId: string;
  traceName?: string;
  observation: LangfuseObservation;
}

/** Truncates long text for compact MCP summaries. */
export function truncateForSummary(value: unknown, limit = SUMMARY_TEXT_LIMIT): string | undefined {
  if (value === null || value === undefined) { return undefined; }
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  if (text.length <= limit) { return text; }
  return `${text.slice(0, limit)}… (${text.length} chars)`;
}

/** Builds a compact, LLM-friendly snapshot of a Langfuse session. */
export function buildSessionSnapshot(
  sessionId: string,
  fullTraces: Array<LangfuseTrace & { observations?: LangfuseObservation[] }>,
  observations: LangfuseObservation[],
): McpSessionSnapshot {
  const summaries = buildTraceSummaries(fullTraces, observations);
  return {
    sessionId,
    traceCount: fullTraces.length,
    observationCount: observations.length,
    traces: summaries.map(summary => {
      const depths = computeDepths(summary.observations);
      return {
        id: summary.trace.id,
        name: summary.trace.name,
        timestamp: summary.trace.timestamp,
        totalMs: summary.totalMs,
        tokenInput: summary.tokenInput,
        tokenOutput: summary.tokenOutput,
        totalCost: summary.trace.totalCost,
        inputPreview: truncateForSummary(summary.trace.input),
        outputPreview: truncateForSummary(summary.trace.output),
        spans: summary.observations.map(obs => ({
          id: obs.id,
          name: obs.name,
          type: obs.type,
          depth: depths.get(obs.id) ?? 0,
          durationMs: durationMs(obs),
          model: obs.model,
          tokens: obs.usage
            ? { input: obs.usage.input, output: obs.usage.output }
            : undefined,
          level: obs.level,
          statusMessage: obs.statusMessage,
          parentObservationId: obs.parentObservationId,
        })),
      };
    }),
  };
}

/** Locates an observation within loaded trace data. */
export function findObservation(
  traceId: string,
  observationId: string,
  fullTraces: Array<LangfuseTrace & { observations?: LangfuseObservation[] }>,
): McpSpanDetail | null {
  const trace = fullTraces.find(t => t.id === traceId);
  if (!trace) { return null; }
  const observation = (trace.observations ?? []).find(o => o.id === observationId);
  if (!observation) { return null; }
  return {
    traceId: trace.id,
    traceName: trace.name,
    observation,
  };
}

import type { LangfuseObservation, LangfuseTrace } from './langfuse-client.js';
import { isDefined, isErrorObservation } from './trace-utils.js';
import { extractPrimaryText, isChatMessages, resolveObservationCost } from './span-detail-render.js';
import { computeUsageBreakdown, type UsageBreakdown } from './usage-breakdown.js';

/** Filter groups offered by the trace panel's type switcher. */
export type SpanGroup = 'llm' | 'tool' | 'other';

/** Maps an observation type to the panel's All / LLM / Tools filter groups. */
export function observationGroup(type?: string): SpanGroup {
  switch ((type ?? '').toUpperCase()) {
    case 'GENERATION':
    case 'EMBEDDING':
      return 'llm';
    case 'TOOL':
    case 'RETRIEVER':
      return 'tool';
    default:
      return 'other';
  }
}

/** Collapses whitespace and truncates to `max` characters with an ellipsis. */
export function truncateText(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= max) { return flat; }
  return `${flat.slice(0, Math.max(1, max - 1)).trimEnd()}…`;
}

function chatMessageText(msg: Record<string, unknown>): string | undefined {
  const content = msg['content'] ?? msg['parts'];
  if (typeof content === 'string') { return content; }
  if (Array.isArray(content)) {
    for (const part of content) {
      if (typeof part === 'string') { return part; }
      if (isDefined(part) && typeof part === 'object') {
        const text = (part as Record<string, unknown>)['text'];
        if (typeof text === 'string') { return text; }
      }
    }
  }
  return undefined;
}

function firstStringDeep(value: unknown, depth: number): string | undefined {
  if (typeof value === 'string') { return value.trim() ? value : undefined; }
  if (depth <= 0 || !isDefined(value) || typeof value !== 'object') { return undefined; }
  const entries = Array.isArray(value) ? value : Object.values(value as Record<string, unknown>);
  for (const entry of entries) {
    const found = firstStringDeep(entry, depth - 1);
    if (found) { return found; }
  }
  return undefined;
}

/**
 * Pulls a short, human-readable line out of a trace/session input or output
 * (plain strings, chat message lists, `{query|message|text…}` objects, nested shapes).
 * Returns undefined when nothing readable is found.
 */
export function extractPreviewText(value: unknown, max = 90): string | undefined {
  if (!isDefined(value)) { return undefined; }

  let raw: string | undefined;
  if (Array.isArray(value) && isChatMessages(value)) {
    const messages = value as Array<Record<string, unknown>>;
    const lastUser = [...messages].reverse().find(m => m['role'] === 'user');
    raw = chatMessageText(lastUser ?? messages[messages.length - 1] ?? {});
  } else if (typeof value === 'string') {
    raw = value;
  } else if (typeof value === 'object') {
    const extracted = extractPrimaryText(value);
    raw = extracted?.primary;
    if (!raw && !Array.isArray(value)) {
      const obj = value as Record<string, unknown>;
      const messages = obj['messages'] ?? obj['contents'];
      if (Array.isArray(messages) && isChatMessages(messages)) {
        return extractPreviewText(messages, max);
      }
    }
    raw = raw ?? firstStringDeep(value, 4);
  }

  if (!raw) { return undefined; }
  const text = truncateText(raw, max);
  return text.length > 0 ? text : undefined;
}

/** Counts observations recorded with level ERROR. */
export function countErrorObservations(obs: LangfuseObservation[]): number {
  return obs.filter(isErrorObservation).length;
}

/**
 * Best-effort USD cost for a trace: the trace-level total when Langfuse reports it,
 * otherwise the sum of generation costs. Returns undefined when nothing is priced.
 */
export function computeTraceCost(trace: LangfuseTrace, traceObs: LangfuseObservation[]): number | undefined {
  if (isDefined(trace.totalCost) && !Number.isNaN(trace.totalCost) && trace.totalCost > 0) {
    return trace.totalCost;
  }
  let total = 0;
  let found = false;
  for (const o of traceObs) {
    if ((o.type ?? '').toUpperCase() !== 'GENERATION') { continue; }
    const cost = resolveObservationCost(o);
    if (isDefined(cost) && cost > 0) {
      total += cost;
      found = true;
    }
  }
  return found ? total : undefined;
}

/** Formats a timeline tick: 0, 200ms, 1s, 1.5s. */
export function fmtTick(ms: number): string {
  if (ms <= 0) { return '0'; }
  if (ms < 1000) { return `${Math.round(ms)}ms`; }
  return `${Number((ms / 1000).toFixed(2))}s`;
}

/**
 * Derives the Langfuse project-scoped session URL from a trace's `htmlPath`
 * (`/project/<id>/traces/<traceId>`). Returns undefined when the project is unknown.
 */
export function buildSessionUrl(host: string, sessionId: string, traces: LangfuseTrace[]): string | undefined {
  if (!host) { return undefined; }
  for (const trace of traces) {
    const match = /^\/project\/([^/]+)\//.exec(trace.htmlPath ?? '');
    if (match?.[1]) {
      return `${host.replace(/\/$/, '')}/project/${match[1]}/sessions/${encodeURIComponent(sessionId)}`;
    }
  }
  return undefined;
}

/** Lowercased text a span row is matched against by the panel filter. */
export function buildSearchText(obs: LangfuseObservation): string {
  return [obs.name, obs.type, obs.model, obs.id]
    .filter((part): part is string => typeof part === 'string' && part.length > 0)
    .join(' ')
    .toLowerCase();
}

/** One-line summary of a session derived from its traces (oldest trace = opening message). */
export interface SessionSummary {
  firstMessage?: string;
  traceCount: number;
  errorCount: number;
}

/** Summarizes a session for the sidebar from its fully loaded traces. */
export function summarizeSession(traces: LangfuseTrace[]): SessionSummary {
  const oldestFirst = [...traces].sort((a, b) => {
    const ta = a.timestamp ? new Date(a.timestamp).getTime() : 0;
    const tb = b.timestamp ? new Date(b.timestamp).getTime() : 0;
    return ta - tb;
  });
  let firstMessage: string | undefined;
  for (const trace of oldestFirst) {
    firstMessage = extractPreviewText(trace.input, 48);
    if (firstMessage) { break; }
  }
  const errorCount = traces.filter(t => countErrorObservations(t.observations ?? []) > 0).length;
  return { firstMessage, traceCount: traces.length, errorCount };
}

/**
 * Sums token usage across a trace's generations, counting each model call once
 * (wrapper/inner generations sharing a startTime would otherwise double-count).
 * Returns undefined when no generation reports tokens.
 */
export function aggregateUsage(obs: LangfuseObservation[]): UsageBreakdown | undefined {
  const seen = new Set<string>();
  let input = 0; let output = 0; let cached = 0; let reasoning = 0;
  for (const o of obs) {
    if ((o.type ?? '').toUpperCase() !== 'GENERATION') { continue; }
    const key = o.startTime ?? o.id;
    if (seen.has(key)) { continue; }
    const usage = computeUsageBreakdown(o);
    if (!usage) { continue; }
    seen.add(key);
    input += usage.input;
    output += usage.output;
    cached += usage.inputParts.find(p => p.key === 'cached')?.tokens ?? 0;
    reasoning += usage.outputParts.find(p => p.key === 'reasoning')?.tokens ?? 0;
  }
  if (input + output === 0) { return undefined; }
  return {
    input,
    output,
    total: input + output,
    inputParts: cached > 0 ? [{ key: 'cached', label: 'Cached', tokens: cached }] : [],
    outputParts: reasoning > 0 ? [{ key: 'reasoning', label: 'Reasoning', tokens: reasoning }] : [],
    extraParts: [],
  };
}

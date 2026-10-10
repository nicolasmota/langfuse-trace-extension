import type { LangfuseSession, LangfuseTrace } from '../langfuse-client.js';
import {
  countErrorObservations,
  extractPreviewText,
  truncateText,
  type SessionSummary,
} from '../trace-insights.js';
import { fmtMs, fmtRelativeTime } from '../trace-utils.js';

/** Text shown for a session row in the sidebar. */
export interface SessionDescription {
  label: string;
  description: string;
  hasErrors: boolean;
}

/** Text shown for a trace row under a session. */
export interface TraceDescription {
  label: string;
  description: string;
  hasErrors: boolean;
}

/** Shortens a session ID to its first 8 characters when it is long. */
export function shortSessionId(sessionId: string): string {
  return sessionId.length > 12 ? sessionId.slice(0, 8) : sessionId;
}

/**
 * Builds the sidebar label/description for a session. The label is the opening user message
 * when known (from a previously loaded session), otherwise the short session ID.
 */
export function describeSession(
  sessionId: string,
  session: Pick<LangfuseSession, 'createdAt' | 'environment'> | undefined,
  summary: SessionSummary | undefined,
  now: number = Date.now(),
): SessionDescription {
  const shortId = shortSessionId(sessionId);
  const label = summary?.firstMessage ?? (sessionId.length > 12 ? `${shortId}…` : sessionId);
  const parts: string[] = [];
  if (summary?.firstMessage) { parts.push(shortId); }
  if (session?.createdAt) { parts.push(fmtRelativeTime(session.createdAt, now)); }
  if (session?.environment) { parts.push(session.environment); }
  if (summary && summary.errorCount > 0) {
    parts.push(`${summary.errorCount} error${summary.errorCount === 1 ? '' : 's'}`);
  }
  return { label, description: parts.join(' · '), hasErrors: Boolean(summary && summary.errorCount > 0) };
}

/** Builds the sidebar label/description for one trace of a session. */
export function describeTrace(trace: LangfuseTrace, index: number, now: number = Date.now()): TraceDescription {
  const preview = extractPreviewText(trace.input, 60);
  const label = preview ?? truncateText(trace.name ?? `trace ${index + 1}`, 60);
  const obs = trace.observations ?? [];
  const errors = countErrorObservations(obs);
  const parts: string[] = [];
  if (trace.latency) { parts.push(fmtMs(trace.latency * 1000)); }
  if (obs.length > 0) { parts.push(`${obs.length} span${obs.length === 1 ? '' : 's'}`); }
  if (errors > 0) { parts.push(`${errors} error${errors === 1 ? '' : 's'}`); }
  if (trace.timestamp) { parts.push(fmtRelativeTime(trace.timestamp, now)); }
  return { label, description: parts.join(' · '), hasErrors: errors > 0 };
}

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
  return computeDepthsWithParents(obs, resolveDisplayParents(obs));
}

/** Computes nesting depths from an explicit parent map. */
export function computeDepthsWithParents(
  obs: LangfuseObservation[],
  parents: Map<string, string | null>,
): Map<string, number> {
  const depths = new Map<string, number>();

  function depthOf(id: string, stack: Set<string>): number {
    if (depths.has(id)) { return depths.get(id)!; }
    if (stack.has(id)) {
      depths.set(id, 0);
      return 0;
    }
    const parent = parents.get(id) ?? null;
    if (!parent) {
      depths.set(id, 0);
      return 0;
    }
    stack.add(id);
    const d = depthOf(parent, stack) + 1;
    stack.delete(id);
    depths.set(id, d);
    return d;
  }

  obs.forEach(o => depthOf(o.id, new Set()));
  return depths;
}

/**
 * Resolves the display parent for each observation from `parentObservationId`.
 * Matches Langfuse UI hierarchy; time overlap alone must not reparent siblings
 * such as `send_chatbot_message` under a concurrent `call_llm`.
 */
export function resolveDisplayParents(obs: LangfuseObservation[]): Map<string, string | null> {
  const idSet = new Set(obs.map(o => o.id));
  const result = new Map<string, string | null>();
  for (const o of obs) {
    result.set(
      o.id,
      o.parentObservationId && idSet.has(o.parentObservationId) ? o.parentObservationId : null,
    );
  }
  return result;
}

/**
 * Returns observation IDs that should be hidden given a set of collapsed parents.
 * Walks display-parent links so interleaved children still collapse correctly.
 */
export function computeHiddenByCollapsedParents(
  obs: LangfuseObservation[],
  collapsedIds: Iterable<string>,
): Set<string> {
  const parents = resolveDisplayParents(obs);
  const collapsed = new Set(collapsedIds);
  const hidden = new Set<string>();

  for (const o of obs) {
    let parentId = parents.get(o.id) ?? null;
    const seen = new Set<string>();
    while (parentId && !seen.has(parentId)) {
      seen.add(parentId);
      if (collapsed.has(parentId)) {
        hidden.add(o.id);
        break;
      }
      parentId = parents.get(parentId) ?? null;
    }
  }

  return hidden;
}

/** One column in a folder-style tree guide: continuing pipe, branch, last child, or blank. */
export type TreeGuideCell = 'blank' | 'pipe' | 'branch' | 'last';

/**
 * Groups observation IDs by display parent. Roots use `null`.
 * Children keep the relative order of `obs`.
 */
export function computeChildrenByParent(obs: LangfuseObservation[]): Map<string | null, string[]> {
  const parents = resolveDisplayParents(obs);
  const childrenByParent = new Map<string | null, string[]>();

  for (const o of obs) {
    const parent = parents.get(o.id) ?? null;
    const list = childrenByParent.get(parent) ?? [];
    list.push(o.id);
    childrenByParent.set(parent, list);
  }

  return childrenByParent;
}

/**
 * Builds per-observation tree guide columns for a folder-style hierarchy.
 * Cells follow display order of `obs` (siblings keep that relative order).
 */
export function computeTreeGuides(obs: LangfuseObservation[]): Map<string, TreeGuideCell[]> {
  const parents = resolveDisplayParents(obs);
  const depths = computeDepthsWithParents(obs, parents);
  const childrenByParent = computeChildrenByParent(obs);

  const isLastAmongSiblings = new Map<string, boolean>();
  for (const children of childrenByParent.values()) {
    children.forEach((id, i) => {
      isLastAmongSiblings.set(id, i === children.length - 1);
    });
  }

  const guides = new Map<string, TreeGuideCell[]>();
  for (const o of obs) {
    const depth = depths.get(o.id) ?? 0;
    if (depth === 0) {
      guides.set(o.id, []);
      continue;
    }

    const ancestors: string[] = [];
    let currentId: string | null = o.id;
    const seen = new Set<string>();
    while (currentId) {
      const parent: string | null = parents.get(currentId) ?? null;
      if (!parent || seen.has(parent)) { break; }
      seen.add(parent);
      ancestors.unshift(parent);
      currentId = parent;
    }

    const cells: TreeGuideCell[] = [];
    for (let i = 0; i < depth - 1; i++) {
      const throughChild = ancestors[i + 1];
      cells.push(throughChild && isLastAmongSiblings.get(throughChild) ? 'blank' : 'pipe');
    }
    cells.push(isLastAmongSiblings.get(o.id) ? 'last' : 'branch');
    guides.set(o.id, cells);
  }

  return guides;
}

/** Compares observations by start time, then by latency descending (matches trace summary tie-break). */
export function compareObservationsByStartTime(
  a: LangfuseObservation,
  b: LangfuseObservation,
): number {
  const ta = a.startTime ? new Date(a.startTime).getTime() : 0;
  const tb = b.startTime ? new Date(b.startTime).getTime() : 0;
  if (ta !== tb) { return ta - tb; }
  const da = isDefined(a.latency) ? a.latency : 0;
  const db = isDefined(b.latency) ? b.latency : 0;
  return db - da;
}

/**
 * Orders observations for display using Langfuse UI tree rules: orphan parents are
 * promoted to roots, siblings sort by startTime, and the flat list follows pre-order DFS.
 */
export function sortObservationsForTraceDisplay(obs: LangfuseObservation[]): LangfuseObservation[] {
  if (obs.length === 0) { return []; }

  const parents = resolveDisplayParents(obs);
  const childrenByParent = new Map<string | null, LangfuseObservation[]>();

  for (const o of obs) {
    const parent = parents.get(o.id) ?? null;
    const list = childrenByParent.get(parent) ?? [];
    list.push(o);
    childrenByParent.set(parent, list);
  }

  for (const list of childrenByParent.values()) {
    list.sort(compareObservationsByStartTime);
  }

  const ordered: LangfuseObservation[] = [];
  const visited = new Set<string>();

  const visit = (node: LangfuseObservation): void => {
    if (visited.has(node.id)) { return; }
    visited.add(node.id);
    ordered.push(node);
    for (const child of childrenByParent.get(node.id) ?? []) {
      visit(child);
    }
  };

  for (const root of childrenByParent.get(null) ?? []) {
    visit(root);
  }

  const remaining = obs.filter(o => !visited.has(o.id));
  remaining.sort(compareObservationsByStartTime);
  for (const o of remaining) {
    visit(o);
  }

  return ordered;
}

/** Sorts traces newest-first, matching the trace viewer panel display order. */
export function sortTracesNewestFirst(traces: LangfuseTrace[]): LangfuseTrace[] {
  return [...traces].sort((a, b) => {
    const ta = a.timestamp ? new Date(a.timestamp as string).getTime() : 0;
    const tb = b.timestamp ? new Date(b.timestamp as string).getTime() : 0;
    return tb - ta;
  });
}

/** Builds a TraceSummary for each trace, aggregating timing and token usage. */
export function buildTraceSummaries(traces: LangfuseTrace[], observations: LangfuseObservation[]): TraceSummary[] {
  return traces.map(trace => {
    const traceObs = sortObservationsForTraceDisplay(
      observations.filter(o => o.traceId === trace.id),
    );
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

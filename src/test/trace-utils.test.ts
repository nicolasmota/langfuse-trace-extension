import { describe, it, expect } from 'vitest';
import type { LangfuseObservation, LangfuseTrace } from '../langfuse-client.js';
import {
  isDefined,
  fmtMs,
  fmtDate,
  durationMs,
  observationTypeColor,
  computeDepths,
  computeTreeGuides,
  computeChildrenByParent,
  resolveDisplayParents,
  computeHiddenByCollapsedParents,
  computeTraceTokens,
  buildTraceSummaries,
  sortObservationsForTraceDisplay,
} from '../trace-utils.js';

function makeObs(overrides: Partial<LangfuseObservation> = {}): LangfuseObservation {
  return {
    id: 'obs-1',
    traceId: 'trace-1',
    ...overrides,
  };
}

function makeTrace(overrides: Partial<LangfuseTrace> = {}): LangfuseTrace {
  return {
    id: 'trace-1',
    ...overrides,
  };
}

describe('isDefined', () => {
  it('returns false for null', () => {
    expect(isDefined(null)).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(isDefined(undefined)).toBe(false);
  });

  it('returns true for zero', () => {
    expect(isDefined(0)).toBe(true);
  });

  it('returns true for empty string', () => {
    expect(isDefined('')).toBe(true);
  });

  it('returns true for false', () => {
    expect(isDefined(false)).toBe(true);
  });
});

describe('fmtMs', () => {
  it('returns em dash for undefined', () => {
    expect(fmtMs(undefined)).toBe('—');
  });

  it('formats milliseconds below 1000 without decimal', () => {
    expect(fmtMs(250)).toBe('250ms');
  });

  it('formats exactly 1000ms as seconds', () => {
    expect(fmtMs(1000)).toBe('1.00s');
  });

  it('formats values above 1000ms as seconds with 2 decimal places', () => {
    expect(fmtMs(3750)).toBe('3.75s');
  });

  it('formats zero as 0ms', () => {
    expect(fmtMs(0)).toBe('0ms');
  });
});

describe('fmtDate', () => {
  it('returns em dash for undefined', () => {
    expect(fmtDate(undefined)).toBe('—');
  });

  it('returns the original string when parsing fails', () => {
    expect(fmtDate('not-a-date')).toBe('not-a-date');
  });

  it('returns a non-empty time string for a valid ISO timestamp', () => {
    const result = fmtDate('2024-01-15T10:30:45.123Z');
    expect(result).toBeTruthy();
    expect(result).not.toBe('—');
  });
});

describe('durationMs', () => {
  it('returns undefined when no timing information is available', () => {
    expect(durationMs(makeObs())).toBeUndefined();
  });

  it('prefers latency field over start/end times', () => {
    const obs = makeObs({
      latency: 2.5,
      startTime: '2024-01-01T00:00:00.000Z',
      endTime: '2024-01-01T00:00:10.000Z',
    });
    expect(durationMs(obs)).toBe(2500);
  });

  it('computes duration from startTime and endTime when latency is absent', () => {
    const obs = makeObs({
      startTime: '2024-01-01T00:00:00.000Z',
      endTime: '2024-01-01T00:00:01.500Z',
    });
    expect(durationMs(obs)).toBe(1500);
  });
});

describe('observationTypeColor', () => {
  it('returns green for GENERATION', () => {
    expect(observationTypeColor('GENERATION')).toBe('var(--vscode-terminal-ansiGreen)');
  });

  it('returns blue for SPAN', () => {
    expect(observationTypeColor('SPAN')).toBe('var(--vscode-terminal-ansiBlue)');
  });

  it('returns yellow for EVENT', () => {
    expect(observationTypeColor('EVENT')).toBe('var(--vscode-terminal-ansiYellow)');
  });

  it('is case-insensitive', () => {
    expect(observationTypeColor('generation')).toBe('var(--vscode-terminal-ansiGreen)');
  });

  it('returns description foreground for unknown types', () => {
    expect(observationTypeColor('UNKNOWN')).toBe('var(--vscode-descriptionForeground)');
  });

  it('returns description foreground for undefined', () => {
    expect(observationTypeColor(undefined)).toBe('var(--vscode-descriptionForeground)');
  });
});

describe('computeDepths', () => {
  it('returns depth 0 for a single root observation', () => {
    const obs = [makeObs({ id: 'a' })];
    expect(computeDepths(obs).get('a')).toBe(0);
  });

  it('assigns depth 1 to direct children', () => {
    const obs = [
      makeObs({ id: 'parent' }),
      makeObs({ id: 'child', parentObservationId: 'parent' }),
    ];
    const depths = computeDepths(obs);
    expect(depths.get('parent')).toBe(0);
    expect(depths.get('child')).toBe(1);
  });

  it('computes depth for a deep chain', () => {
    const obs = [
      makeObs({ id: 'a' }),
      makeObs({ id: 'b', parentObservationId: 'a' }),
      makeObs({ id: 'c', parentObservationId: 'b' }),
      makeObs({ id: 'd', parentObservationId: 'c' }),
    ];
    const depths = computeDepths(obs);
    expect(depths.get('a')).toBe(0);
    expect(depths.get('b')).toBe(1);
    expect(depths.get('c')).toBe(2);
    expect(depths.get('d')).toBe(3);
  });

  it('treats a parent outside the set as absent (depth 0)', () => {
    const obs = [makeObs({ id: 'orphan', parentObservationId: 'missing-parent' })];
    expect(computeDepths(obs).get('orphan')).toBe(0);
  });

  it('handles multiple independent roots', () => {
    const obs = [
      makeObs({ id: 'root-a' }),
      makeObs({ id: 'root-b' }),
      makeObs({ id: 'child-a', parentObservationId: 'root-a' }),
    ];
    const depths = computeDepths(obs);
    expect(depths.get('root-a')).toBe(0);
    expect(depths.get('root-b')).toBe(0);
    expect(depths.get('child-a')).toBe(1);
  });

  it('returns an empty map for an empty list', () => {
    expect(computeDepths([]).size).toBe(0);
  });
});

describe('computeTreeGuides', () => {
  it('returns empty guides for roots', () => {
    const obs = [makeObs({ id: 'root' })];
    expect(computeTreeGuides(obs).get('root')).toEqual([]);
  });

  it('marks a single child as last', () => {
    const obs = [
      makeObs({ id: 'parent' }),
      makeObs({ id: 'child', parentObservationId: 'parent' }),
    ];
    expect(computeTreeGuides(obs).get('child')).toEqual(['last']);
  });

  it('uses branch then last for siblings', () => {
    const obs = [
      makeObs({ id: 'parent' }),
      makeObs({ id: 'a', parentObservationId: 'parent' }),
      makeObs({ id: 'b', parentObservationId: 'parent' }),
    ];
    const guides = computeTreeGuides(obs);
    expect(guides.get('a')).toEqual(['branch']);
    expect(guides.get('b')).toEqual(['last']);
  });

  it('keeps a continuing pipe under a non-last sibling', () => {
    const obs = [
      makeObs({ id: 'root' }),
      makeObs({ id: 'mid', parentObservationId: 'root' }),
      makeObs({ id: 'leaf', parentObservationId: 'mid' }),
      makeObs({ id: 'sib', parentObservationId: 'root' }),
    ];
    const guides = computeTreeGuides(obs);
    expect(guides.get('leaf')).toEqual(['pipe', 'last']);
    expect(guides.get('sib')).toEqual(['last']);
  });

  it('uses blank instead of pipe under a last sibling', () => {
    const obs = [
      makeObs({ id: 'root' }),
      makeObs({ id: 'first', parentObservationId: 'root' }),
      makeObs({ id: 'last', parentObservationId: 'root' }),
      makeObs({ id: 'nested', parentObservationId: 'last' }),
    ];
    expect(computeTreeGuides(obs).get('nested')).toEqual(['blank', 'last']);
  });
});

describe('computeChildrenByParent', () => {
  it('groups children under their parent and roots under null', () => {
    const obs = [
      makeObs({ id: 'root' }),
      makeObs({ id: 'a', parentObservationId: 'root' }),
      makeObs({ id: 'b', parentObservationId: 'root' }),
      makeObs({ id: 'leaf', parentObservationId: 'a' }),
    ];
    const map = computeChildrenByParent(obs);
    expect(map.get(null)).toEqual(['root']);
    expect(map.get('root')).toEqual(['a', 'b']);
    expect(map.get('a')).toEqual(['leaf']);
    expect(map.get('b')).toBeUndefined();
  });
});

describe('resolveDisplayParents', () => {
  it('uses parentObservationId when the parent is in the set', () => {
    const obs = [
      makeObs({ id: 'root' }),
      makeObs({ id: 'child', parentObservationId: 'root' }),
    ];
    expect(resolveDisplayParents(obs).get('child')).toBe('root');
  });

  it('does not nest a sibling under a concurrent call_llm by time overlap', () => {
    const obs = [
      makeObs({
        id: 'agent',
        startTime: '2026-07-24T12:00:00.000Z',
        endTime: '2026-07-24T12:00:20.000Z',
      }),
      makeObs({
        id: 'call_llm',
        parentObservationId: 'agent',
        startTime: '2026-07-24T12:00:01.000Z',
        endTime: '2026-07-24T12:00:10.000Z',
      }),
      makeObs({
        id: 'generate_content',
        parentObservationId: 'call_llm',
        startTime: '2026-07-24T12:00:01.500Z',
        endTime: '2026-07-24T12:00:09.000Z',
      }),
      makeObs({
        id: 'send_chatbot_message',
        parentObservationId: 'agent',
        startTime: '2026-07-24T12:00:08.000Z',
        endTime: '2026-07-24T12:00:08.500Z',
      }),
    ];
    const parents = resolveDisplayParents(obs);
    expect(parents.get('generate_content')).toBe('call_llm');
    expect(parents.get('send_chatbot_message')).toBe('agent');
  });

  it('hides interleaved children when a call_llm is collapsed', () => {
    const obs = [
      makeObs({ id: 'agent' }),
      makeObs({ id: 'call_llm_1', parentObservationId: 'agent' }),
      makeObs({ id: 'call_llm_2', parentObservationId: 'agent' }),
      makeObs({ id: 'gen_1a', parentObservationId: 'call_llm_1' }),
      makeObs({ id: 'gen_1b', parentObservationId: 'call_llm_1' }),
      makeObs({ id: 'gen_2', parentObservationId: 'call_llm_2' }),
      makeObs({ id: 'send_chatbot_message', parentObservationId: 'agent' }),
    ];

    const hidden = computeHiddenByCollapsedParents(obs, ['call_llm_1']);
    expect(hidden.has('gen_1a')).toBe(true);
    expect(hidden.has('gen_1b')).toBe(true);
    expect(hidden.has('gen_2')).toBe(false);
    expect(hidden.has('call_llm_2')).toBe(false);
    expect(hidden.has('send_chatbot_message')).toBe(false);
  });
});

describe('computeTraceTokens', () => {
  it('uses trace-level usage when non-zero', () => {
    const trace = makeTrace({ usage: { input: 100, output: 200, total: 300 } });
    expect(computeTraceTokens(trace, [])).toEqual({ input: 100, output: 200 });
  });

  it('falls back to GENERATION observations when trace usage is absent', () => {
    const trace = makeTrace();
    const obs = [
      makeObs({ id: 'g1', type: 'GENERATION', startTime: 'T1', usage: { input: 50, output: 80 } }),
    ];
    expect(computeTraceTokens(trace, obs)).toEqual({ input: 50, output: 80 });
  });

  it('deduplicates GENERATION observations sharing the same startTime', () => {
    const trace = makeTrace();
    const obs = [
      makeObs({ id: 'g1', type: 'GENERATION', startTime: 'T1', usage: { input: 10, output: 20 } }),
      makeObs({ id: 'g2', type: 'GENERATION', startTime: 'T1', usage: { input: 10, output: 20 } }),
    ];
    expect(computeTraceTokens(trace, obs)).toEqual({ input: 10, output: 20 });
  });

  it('sums GENERATION observations with distinct startTimes', () => {
    const trace = makeTrace();
    const obs = [
      makeObs({ id: 'g1', type: 'GENERATION', startTime: 'T1', usage: { input: 10, output: 20 } }),
      makeObs({ id: 'g2', type: 'GENERATION', startTime: 'T2', usage: { input: 5, output: 15 } }),
    ];
    expect(computeTraceTokens(trace, obs)).toEqual({ input: 15, output: 35 });
  });

  it('ignores non-GENERATION observations', () => {
    const trace = makeTrace();
    const obs = [
      makeObs({ id: 's1', type: 'SPAN', usage: { input: 999, output: 999 } }),
    ];
    expect(computeTraceTokens(trace, obs)).toEqual({ input: 0, output: 0 });
  });

  it('returns zeros when no observations and no trace usage', () => {
    expect(computeTraceTokens(makeTrace(), [])).toEqual({ input: 0, output: 0 });
  });
});

describe('sortObservationsForTraceDisplay', () => {
  it('orders siblings by startTime at the root level', () => {
    const obs = [
      makeObs({ id: 'later', startTime: '2024-01-01T00:00:02.000Z' }),
      makeObs({ id: 'earlier', startTime: '2024-01-01T00:00:00.000Z' }),
    ];
    expect(sortObservationsForTraceDisplay(obs).map(o => o.id)).toEqual(['earlier', 'later']);
  });

  it('groups children under their parent in pre-order DFS like Langfuse UI', () => {
    const obs = [
      makeObs({ id: 'rec', name: 'recommendation_specialist', startTime: '2026-07-27T18:07:22.400Z' }),
      makeObs({
        id: 'call-1',
        name: 'call_llm',
        parentObservationId: 'rec',
        startTime: '2026-07-27T18:07:22.426Z',
      }),
      makeObs({
        id: 'sub-agent',
        name: 'mandatory_filters_extractor',
        parentObservationId: 'missing-parent',
        startTime: '2026-07-27T18:07:23.026Z',
      }),
      makeObs({
        id: 'sub-call',
        name: 'call_llm',
        parentObservationId: 'sub-agent',
        startTime: '2026-07-27T18:07:23.033Z',
      }),
      makeObs({
        id: 'call-2',
        name: 'call_llm',
        parentObservationId: 'rec',
        startTime: '2026-07-27T18:07:23.445Z',
      }),
      makeObs({
        id: 'call-3',
        name: 'call_llm',
        parentObservationId: 'rec',
        startTime: '2026-07-27T18:07:24.623Z',
      }),
    ];

    expect(sortObservationsForTraceDisplay(obs).map(o => o.id)).toEqual([
      'rec',
      'call-1',
      'call-2',
      'call-3',
      'sub-agent',
      'sub-call',
    ]);
  });
});

describe('buildTraceSummaries', () => {
  it('returns an empty array for an empty trace list', () => {
    expect(buildTraceSummaries([], [])).toEqual([]);
  });

  it('groups observations by traceId', () => {
    const traces = [makeTrace({ id: 'trace-1' }), makeTrace({ id: 'trace-2' })];
    const obs = [
      makeObs({ id: 'o1', traceId: 'trace-1' }),
      makeObs({ id: 'o2', traceId: 'trace-2' }),
      makeObs({ id: 'o3', traceId: 'trace-1' }),
    ];
    const summaries = buildTraceSummaries(traces, obs);
    expect(summaries[0].observations.map(o => o.id).sort()).toEqual(['o1', 'o3']);
    expect(summaries[1].observations.map(o => o.id)).toEqual(['o2']);
  });

  it('computes totalMs from startTime and endTime of observations', () => {
    const trace = makeTrace({ id: 'trace-1' });
    const obs = [
      makeObs({ id: 'o1', traceId: 'trace-1', startTime: '2024-01-01T00:00:00.000Z', endTime: '2024-01-01T00:00:02.000Z' }),
    ];
    const [summary] = buildTraceSummaries([trace], obs);
    expect(summary.totalMs).toBe(2000);
  });

  it('orders observations in tree DFS order for display', () => {
    const trace = makeTrace({ id: 'trace-1' });
    const obs = [
      makeObs({ id: 'parent', traceId: 'trace-1', startTime: '2024-01-01T00:00:00.000Z' }),
      makeObs({
        id: 'later-child',
        traceId: 'trace-1',
        parentObservationId: 'parent',
        startTime: '2024-01-01T00:00:02.000Z',
      }),
      makeObs({
        id: 'other-root',
        traceId: 'trace-1',
        parentObservationId: 'missing-parent',
        startTime: '2024-01-01T00:00:01.500Z',
      }),
      makeObs({
        id: 'earlier-child',
        traceId: 'trace-1',
        parentObservationId: 'parent',
        startTime: '2024-01-01T00:00:01.000Z',
      }),
    ];
    const [summary] = buildTraceSummaries([trace], obs);
    expect(summary.observations.map(o => o.id)).toEqual([
      'parent',
      'earlier-child',
      'later-child',
      'other-root',
    ]);
  });
});

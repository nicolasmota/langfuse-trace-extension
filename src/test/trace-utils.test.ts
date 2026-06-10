import { describe, it, expect } from 'vitest';
import type { LangfuseObservation, LangfuseTrace } from '../langfuse-client.js';
import {
  isDefined,
  fmtMs,
  fmtDate,
  durationMs,
  observationTypeColor,
  computeDepths,
  computeTraceTokens,
  buildTraceSummaries,
  focusIndexForTraceId,
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

describe('focusIndexForTraceId', () => {
  it('returns the newest-first index for the matching trace', () => {
    const traces = [
      makeTrace({ id: 'old', timestamp: '2024-01-01T00:00:00.000Z' }),
      makeTrace({ id: 'new', timestamp: '2024-01-01T00:00:02.000Z' }),
    ];
    expect(focusIndexForTraceId(traces, 'new')).toBe(0);
    expect(focusIndexForTraceId(traces, 'old')).toBe(1);
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

  it('sorts observations by startTime ascending', () => {
    const trace = makeTrace({ id: 'trace-1' });
    const obs = [
      makeObs({ id: 'later', traceId: 'trace-1', startTime: '2024-01-01T00:00:02.000Z' }),
      makeObs({ id: 'earlier', traceId: 'trace-1', startTime: '2024-01-01T00:00:00.000Z' }),
    ];
    const [summary] = buildTraceSummaries([trace], obs);
    expect(summary.observations[0].id).toBe('earlier');
    expect(summary.observations[1].id).toBe('later');
  });
});

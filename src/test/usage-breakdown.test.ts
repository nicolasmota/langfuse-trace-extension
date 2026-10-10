import { describe, it, expect } from 'vitest';
import type { LangfuseObservation } from '../langfuse-client.js';
import { computeUsageBreakdown } from '../usage-breakdown.js';

function makeObs(overrides: Partial<LangfuseObservation> = {}): LangfuseObservation {
  return { id: 'o1', traceId: 't1', type: 'GENERATION', ...overrides };
}

describe('computeUsageBreakdown', () => {
  it('returns undefined without token data', () => {
    expect(computeUsageBreakdown(makeObs())).toBeUndefined();
  });

  it('falls back to the legacy usage field', () => {
    const result = computeUsageBreakdown(makeObs({ usage: { input: 742, output: 23 } }));
    expect(result).toMatchObject({ input: 742, output: 23, total: 765, inputParts: [], outputParts: [] });
  });

  it('treats cached/reasoning as subsets when total equals input + output', () => {
    const result = computeUsageBreakdown(makeObs({
      usageDetails: { input: 3156, output: 130, total: 3286, cached_tokens: 2048, reasoning_tokens: 64 },
    }))!;
    expect(result.input).toBe(3156);
    expect(result.output).toBe(130);
    expect(result.total).toBe(3286);
    expect(result.inputParts.map(p => [p.key, p.tokens])).toEqual([['cached', 2048], ['uncached', 1108]]);
    expect(result.outputParts.map(p => [p.key, p.tokens])).toEqual([['reasoning', 64], ['response', 66]]);
  });

  it('folds cached tokens into input when total shows they are counted on top', () => {
    const result = computeUsageBreakdown(makeObs({
      usageDetails: { input: 1108, output: 130, total: 3286, cache_read_input_tokens: 2048 },
    }))!;
    expect(result.input).toBe(3156);
    expect(result.total).toBe(3286);
    expect(result.inputParts.map(p => [p.key, p.tokens])).toEqual([['cached', 2048], ['uncached', 1108]]);
  });

  it('accepts provider-specific key names', () => {
    const result = computeUsageBreakdown(makeObs({
      usageDetails: { input: 100, output: 50, total: 150, input_cached_tokens: 40, output_reasoning_tokens: 10 },
    }))!;
    expect(result.inputParts[0]).toMatchObject({ key: 'cached', tokens: 40 });
    expect(result.outputParts[0]).toMatchObject({ key: 'reasoning', tokens: 10 });
  });

  it('lists cache writes and unknown categories as extra parts counted in the total', () => {
    const result = computeUsageBreakdown(makeObs({
      usageDetails: { input: 100, output: 50, total: 180, cache_creation_input_tokens: 20, audio_tokens: 10 },
    }))!;
    expect(result.extraParts.map(p => [p.label, p.tokens])).toEqual([['Cache write', 20], ['Audio', 10]]);
    expect(result.total).toBe(180);
  });

  it('attaches per-category costs and totals', () => {
    const result = computeUsageBreakdown(makeObs({
      usageDetails: { input: 100, output: 50, total: 150, cached_tokens: 40 },
      costDetails: { input: 0.0003, output: 0.0002, total: 0.0005, cached_tokens: 0.00005 },
    }))!;
    expect(result.inputCost).toBe(0.0003);
    expect(result.outputCost).toBe(0.0002);
    expect(result.totalCost).toBe(0.0005);
    expect(result.inputParts[0]?.cost).toBe(0.00005);
  });
});

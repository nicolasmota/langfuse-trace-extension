import type { LangfuseObservation } from './langfuse-client.js';

function isDefined<T>(v: T | null | undefined): v is T {
  return v !== null && v !== undefined;
}

/** A token category shown under Input or Output (cached, reasoning, audio, …). */
export interface UsagePart {
  key: string;
  label: string;
  tokens: number;
  cost?: number;
}

/** Normalized token usage for one generation. Cached/reasoning are subsets of input/output. */
export interface UsageBreakdown {
  input: number;
  output: number;
  total: number;
  /** Subsets of `input` (cached, uncached). */
  inputParts: UsagePart[];
  /** Subsets of `output` (reasoning, response). */
  outputParts: UsagePart[];
  /** Categories billed on top of input/output (cache writes, audio, …). */
  extraParts: UsagePart[];
  inputCost?: number;
  outputCost?: number;
  totalCost?: number;
}

const CACHED_KEYS = [
  'cached_tokens', 'input_cached_tokens', 'cache_read_input_tokens', 'input_cache_read', 'cache_read',
];
const REASONING_KEYS = ['reasoning_tokens', 'output_reasoning_tokens', 'output_reasoning'];
const CACHE_WRITE_KEYS = [
  'cache_creation_input_tokens', 'input_cache_creation', 'input_cache_write', 'cache_write',
];
const KNOWN_TOTAL_KEYS = new Set(['total', 'input', 'output', 'promptTokens', 'completionTokens', 'totalTokens']);

function pick(details: Record<string, number>, keys: string[]): { key?: string; value: number } {
  for (const key of keys) {
    const value = details[key];
    if (typeof value === 'number' && value > 0) { return { key, value }; }
  }
  return { value: 0 };
}

function humanize(key: string): string {
  const spaced = key.replace(/_?tokens?$/i, '').replace(/[_-]+/g, ' ').trim();
  return spaced.length > 0 ? spaced.charAt(0).toUpperCase() + spaced.slice(1) : key;
}

/**
 * Builds a provider-independent usage breakdown from `usageDetails` / `usage`.
 * Langfuse providers disagree on whether `input` already includes cached tokens:
 * when `total` shows the part is counted on top, it is folded into its parent so
 * the displayed Input/Output rows always contain their sub-rows.
 * Returns undefined when the observation has no token data.
 */
export function computeUsageBreakdown(obs: LangfuseObservation): UsageBreakdown | undefined {
  const details: Record<string, number> = {};
  for (const [key, value] of Object.entries(obs.usageDetails ?? {})) {
    if (typeof value === 'number' && !Number.isNaN(value)) { details[key] = value; }
  }

  const rawInput = details['input'] ?? details['promptTokens'] ?? obs.usage?.input ?? 0;
  const rawOutput = details['output'] ?? details['completionTokens'] ?? obs.usage?.output ?? 0;
  const reportedTotal = details['total'] ?? details['totalTokens'] ?? obs.usage?.total;

  const cached = pick(details, CACHED_KEYS);
  const reasoning = pick(details, REASONING_KEYS);
  const cacheWrite = pick(details, CACHE_WRITE_KEYS);

  const claimed = new Set<string>([
    ...(cached.key ? [cached.key] : []),
    ...(reasoning.key ? [reasoning.key] : []),
    ...(cacheWrite.key ? [cacheWrite.key] : []),
  ]);
  const extras: UsagePart[] = [];
  for (const [key, value] of Object.entries(details)) {
    if (KNOWN_TOTAL_KEYS.has(key) || claimed.has(key) || value <= 0) { continue; }
    // Skip near-duplicates of an already claimed category (e.g. both cached_tokens and input_cached_tokens).
    if (CACHED_KEYS.includes(key) || REASONING_KEYS.includes(key) || CACHE_WRITE_KEYS.includes(key)) { continue; }
    extras.push({ key, label: humanize(key), tokens: value });
  }
  if (cacheWrite.key) {
    extras.unshift({ key: cacheWrite.key, label: 'Cache write', tokens: cacheWrite.value });
  }

  if (rawInput + rawOutput + cached.value + reasoning.value + extras.length === 0) { return undefined; }

  const extrasSum = extras.reduce((sum, e) => sum + e.tokens, 0);
  const baseSum = rawInput + rawOutput + extrasSum;

  // Parts are additive when the reported total only reconciles by adding them on top.
  const additive = (part: number): boolean => {
    if (part <= 0) { return false; }
    if (isDefined(reportedTotal)) {
      return Math.abs(reportedTotal - (baseSum + cached.value + reasoning.value)) <
        Math.abs(reportedTotal - baseSum);
    }
    return false;
  };
  const cachedAdditive = additive(cached.value);
  const reasoningAdditive = additive(reasoning.value);

  const input = rawInput + (cachedAdditive ? cached.value : 0);
  const output = rawOutput + (reasoningAdditive ? reasoning.value : 0);

  const costs = obs.costDetails ?? {};
  const costOf = (keys: string[]): number | undefined => {
    for (const key of keys) {
      const value = costs[key];
      if (typeof value === 'number' && value > 0) { return value; }
    }
    return undefined;
  };

  const inputParts: UsagePart[] = [];
  if (cached.value > 0) {
    const cachedTokens = Math.min(cached.value, input);
    inputParts.push({ key: 'cached', label: 'Cached', tokens: cachedTokens, cost: costOf(CACHED_KEYS) });
    inputParts.push({ key: 'uncached', label: 'Uncached', tokens: Math.max(0, input - cachedTokens) });
  }
  const outputParts: UsagePart[] = [];
  if (reasoning.value > 0) {
    const reasoningTokens = Math.min(reasoning.value, output);
    outputParts.push({ key: 'reasoning', label: 'Reasoning', tokens: reasoningTokens, cost: costOf(REASONING_KEYS) });
    outputParts.push({ key: 'response', label: 'Response', tokens: Math.max(0, output - reasoningTokens) });
  }

  return {
    input,
    output,
    total: input + output + extrasSum,
    inputParts,
    outputParts,
    extraParts: extras,
    inputCost: costs['input'] ?? obs.calculatedInputCost,
    outputCost: costs['output'] ?? obs.calculatedOutputCost,
    totalCost: costs['total'] ?? obs.totalCost ?? obs.calculatedTotalCost,
  };
}

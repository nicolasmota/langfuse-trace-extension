import { describe, it, expect } from 'vitest';
import type { LangfuseObservation, LangfuseTrace } from '../langfuse-client.js';
import {
  aggregateUsage,
  buildSearchText,
  buildSessionUrl,
  computeTraceCost,
  countErrorObservations,
  extractPreviewText,
  fmtTick,
  observationGroup,
  summarizeSession,
  truncateText,
} from '../trace-insights.js';

function obs(overrides: Partial<LangfuseObservation> = {}): LangfuseObservation {
  return { id: 'o1', traceId: 't1', ...overrides };
}

function trace(overrides: Partial<LangfuseTrace> = {}): LangfuseTrace {
  return { id: 't1', ...overrides };
}

describe('observationGroup', () => {
  it('maps types to filter groups', () => {
    expect(observationGroup('GENERATION')).toBe('llm');
    expect(observationGroup('embedding')).toBe('llm');
    expect(observationGroup('TOOL')).toBe('tool');
    expect(observationGroup('RETRIEVER')).toBe('tool');
    expect(observationGroup('SPAN')).toBe('other');
    expect(observationGroup(undefined)).toBe('other');
  });
});

describe('truncateText', () => {
  it('collapses whitespace and truncates with an ellipsis', () => {
    expect(truncateText('a   b\n c', 20)).toBe('a b c');
    expect(truncateText('abcdefghij', 5)).toBe('abcd…');
  });
});

describe('extractPreviewText', () => {
  it('returns plain strings', () => {
    expect(extractPreviewText('how are you?')).toBe('how are you?');
  });

  it('prefers primary text keys in objects', () => {
    expect(extractPreviewText({ query: 'where is my order', user_id: 'u1' })).toBe('where is my order');
  });

  it('reads the last user message from chat arrays', () => {
    const messages = [
      { role: 'system', content: 'be nice' },
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'ok' },
      { role: 'user', content: [{ type: 'text', text: 'second' }] },
    ];
    expect(extractPreviewText(messages)).toBe('second');
  });

  it('reads messages nested in a request wrapper', () => {
    expect(extractPreviewText({ model: 'x', messages: [{ role: 'user', content: 'hi there' }] })).toBe('hi there');
  });

  it('finds nested text like assistant_messages[0].text', () => {
    const output = { assistant_messages: [{ text: 'Hi! I\'m Ava.', metadata: null }] };
    expect(extractPreviewText(output)).toBe('Hi! I\'m Ava.');
  });

  it('returns undefined for empty or unreadable values', () => {
    expect(extractPreviewText(undefined)).toBeUndefined();
    expect(extractPreviewText({})).toBeUndefined();
    expect(extractPreviewText('   ')).toBeUndefined();
    expect(extractPreviewText({ n: 1 })).toBeUndefined();
  });

  it('truncates long text', () => {
    expect(extractPreviewText('x'.repeat(200), 20)).toHaveLength(20);
  });
});

describe('countErrorObservations', () => {
  it('counts ERROR levels case-insensitively', () => {
    expect(countErrorObservations([obs({ level: 'ERROR' }), obs({ level: 'error' }), obs({ level: 'WARNING' }), obs()])).toBe(2);
  });
});

describe('computeTraceCost', () => {
  it('prefers the trace-level total', () => {
    expect(computeTraceCost(trace({ totalCost: 0.5 }), [obs({ type: 'GENERATION', totalCost: 1 })])).toBe(0.5);
  });

  it('sums generation costs otherwise', () => {
    const result = computeTraceCost(trace(), [
      obs({ id: 'a', type: 'GENERATION', totalCost: 0.001 }),
      obs({ id: 'b', type: 'GENERATION', calculatedTotalCost: 0.002 }),
      obs({ id: 'c', type: 'SPAN', totalCost: 5 }),
    ]);
    expect(result).toBeCloseTo(0.003, 10);
  });

  it('returns undefined when nothing is priced', () => {
    expect(computeTraceCost(trace(), [obs({ type: 'GENERATION' })])).toBeUndefined();
  });
});

describe('fmtTick', () => {
  it('formats ticks', () => {
    expect(fmtTick(0)).toBe('0');
    expect(fmtTick(200)).toBe('200ms');
    expect(fmtTick(1000)).toBe('1s');
    expect(fmtTick(1500)).toBe('1.5s');
  });
});

describe('buildSessionUrl', () => {
  it('derives the project-scoped URL from htmlPath', () => {
    const url = buildSessionUrl('https://cloud.langfuse.com/', 'sess 1', [
      trace({ htmlPath: '/project/abc123/traces/t1' }),
    ]);
    expect(url).toBe('https://cloud.langfuse.com/project/abc123/sessions/sess%201');
  });

  it('returns undefined when the project is unknown', () => {
    expect(buildSessionUrl('http://x', 's', [trace()])).toBeUndefined();
    expect(buildSessionUrl('', 's', [trace({ htmlPath: '/project/p/traces/t' })])).toBeUndefined();
  });
});

describe('buildSearchText', () => {
  it('joins name, type, model and id in lowercase', () => {
    expect(buildSearchText(obs({ name: 'Call_LLM', type: 'GENERATION', model: 'GPT-4o' })))
      .toBe('call_llm generation gpt-4o o1');
  });
});

describe('summarizeSession', () => {
  it('uses the oldest trace input and counts traces with errors', () => {
    const summary = summarizeSession([
      trace({ id: 'b', timestamp: '2026-01-01T00:00:02Z', input: 'second', observations: [obs({ level: 'ERROR' })] }),
      trace({ id: 'a', timestamp: '2026-01-01T00:00:01Z', input: 'first', observations: [] }),
    ]);
    expect(summary).toEqual({ firstMessage: 'first', traceCount: 2, errorCount: 1 });
  });
});

describe('aggregateUsage', () => {
  it('sums generations once per startTime and totals cached/reasoning', () => {
    const gen = (id: string, startTime: string, extra: Record<string, number>) => obs({
      id, type: 'GENERATION', startTime,
      usageDetails: { input: 100, output: 50, total: 150, ...extra },
    });
    const result = aggregateUsage([
      gen('a', '2026-01-01T00:00:00Z', { cached_tokens: 40 }),
      gen('a-dup', '2026-01-01T00:00:00Z', { cached_tokens: 40 }),
      gen('b', '2026-01-01T00:00:01Z', { reasoning_tokens: 10 }),
      obs({ id: 's', type: 'SPAN', usageDetails: { input: 999, output: 999 } }),
    ])!;
    expect(result.input).toBe(200);
    expect(result.output).toBe(100);
    expect(result.inputParts[0]?.tokens).toBe(40);
    expect(result.outputParts[0]?.tokens).toBe(10);
  });

  it('returns undefined without generation tokens', () => {
    expect(aggregateUsage([obs({ type: 'SPAN' })])).toBeUndefined();
  });
});

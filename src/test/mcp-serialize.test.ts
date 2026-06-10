import { describe, it, expect } from 'vitest';
import type { LangfuseObservation, LangfuseTrace } from '../langfuse-client.js';
import {
  buildSessionSnapshot,
  findObservation,
  truncateForSummary,
} from '../mcp/serialize.js';

describe('truncateForSummary', () => {
  it('truncates long strings', () => {
    const result = truncateForSummary('a'.repeat(600), 100);
    expect(result).toContain('… (600 chars)');
    expect(result!.length).toBeLessThan(200);
  });

  it('returns short strings unchanged', () => {
    expect(truncateForSummary('hello')).toBe('hello');
  });
});

describe('buildSessionSnapshot', () => {
  it('builds compact trace and span summaries', () => {
    const trace: LangfuseTrace & { observations: LangfuseObservation[] } = {
      id: 'trace-1',
      name: 'agentic_run',
      timestamp: '2026-01-01T12:00:00.000Z',
      input: 'user question',
      output: 'assistant reply',
      observations: [{
        id: 'obs-1',
        traceId: 'trace-1',
        name: 'llm-call',
        type: 'GENERATION',
        startTime: '2026-01-01T12:00:00.000Z',
        endTime: '2026-01-01T12:00:01.000Z',
        model: 'gpt-4',
        usage: { input: 10, output: 20 },
      }],
    };

    const snapshot = buildSessionSnapshot('session-abc', [trace], trace.observations);
    expect(snapshot.sessionId).toBe('session-abc');
    expect(snapshot.traceCount).toBe(1);
    expect(snapshot.traces[0]?.spans[0]?.model).toBe('gpt-4');
    expect(snapshot.traces[0]?.inputPreview).toBe('user question');
  });
});

describe('findObservation', () => {
  it('returns observation detail when ids match', () => {
    const trace: LangfuseTrace & { observations: LangfuseObservation[] } = {
      id: 'trace-1',
      observations: [{
        id: 'obs-1',
        traceId: 'trace-1',
        output: { text: 'done' },
      }],
    };

    const detail = findObservation('trace-1', 'obs-1', [trace]);
    expect(detail?.observation.output).toEqual({ text: 'done' });
  });

  it('returns null when observation is missing', () => {
    expect(findObservation('trace-1', 'missing', [])).toBeNull();
  });
});

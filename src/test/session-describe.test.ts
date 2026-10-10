import { describe, it, expect } from 'vitest';
import type { LangfuseTrace } from '../langfuse-client.js';
import { describeSession, describeTrace, shortSessionId } from '../session/describe.js';

const NOW = Date.parse('2026-10-09T12:00:00Z');

describe('shortSessionId', () => {
  it('keeps short ids and trims long ones', () => {
    expect(shortSessionId('abc')).toBe('abc');
    expect(shortSessionId('c5d21d92-0373-4739-b132-a63249b3c39b')).toBe('c5d21d92');
  });
});

describe('describeSession', () => {
  const session = { createdAt: '2026-10-09T11:58:00Z', environment: 'production' };

  it('falls back to the short id before the session is loaded', () => {
    const d = describeSession('c5d21d92-0373-4739-b132-a63249b3c39b', session, undefined, NOW);
    expect(d.label).toBe('c5d21d92…');
    expect(d.description).toBe('2 min ago · production');
    expect(d.hasErrors).toBe(false);
  });

  it('uses the opening message and error count once known', () => {
    const d = describeSession('c5d21d92-0373-4739-b132-a63249b3c39b', session,
      { firstMessage: 'check my order', traceCount: 3, errorCount: 2 }, NOW);
    expect(d.label).toBe('check my order');
    expect(d.description).toBe('c5d21d92 · 2 min ago · production · 2 errors');
    expect(d.hasErrors).toBe(true);
  });

  it('handles sessions without metadata (pinned but not in the recent list)', () => {
    expect(describeSession('abc', undefined, undefined, NOW)).toEqual({ label: 'abc', description: '', hasErrors: false });
  });
});

describe('describeTrace', () => {
  it('shows the user message, duration, spans, errors and age', () => {
    const trace: LangfuseTrace = {
      id: 't1',
      name: 'send_user_message',
      timestamp: '2026-10-09T11:55:00Z',
      input: 'where is my order?',
      latency: 0.486,
      observations: [
        { id: 'a', traceId: 't1', level: 'ERROR' },
        { id: 'b', traceId: 't1' },
      ],
    };
    expect(describeTrace(trace, 0, NOW)).toEqual({
      label: 'where is my order?',
      description: '486ms · 2 spans · 1 error · 5 min ago',
      hasErrors: true,
    });
  });

  it('falls back to the trace name', () => {
    expect(describeTrace({ id: 't', name: 'agent_run' }, 0, NOW).label).toBe('agent_run');
    expect(describeTrace({ id: 't' }, 2, NOW).label).toBe('trace 3');
  });
});

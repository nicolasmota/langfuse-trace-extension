import { describe, it, expect } from 'vitest';
import { buildSessionMcpPointer, buildTraceMcpPointer } from '../mcp-pointer.js';
import type { McpSessionSnapshot, McpTraceSummary } from '../mcp/serialize.js';

const sampleTrace = (id: string, spanCount: number): McpTraceSummary => ({
  id,
  name: `trace-${id}`,
  totalMs: 1000,
  tokenInput: 10,
  tokenOutput: 20,
  spans: Array.from({ length: spanCount }, (_, i) => ({
    id: `obs-${i}`,
    name: `span-${i}`,
    type: 'SPAN',
    depth: 0,
  })),
});

describe('mcp-pointer', () => {
  it('builds session pointer with MCP instructions and compact trace index', () => {
    const snapshot: McpSessionSnapshot = {
      sessionId: 'session-abc',
      traceCount: 2,
      observationCount: 4,
      traces: [sampleTrace('t1', 2), sampleTrace('t2', 2)],
    };
    const text = buildSessionMcpPointer(snapshot);
    expect(text).toContain('get_session_traces');
    expect(text).toContain('session-abc');
    expect(text).toContain('langfuse://session/session-abc');
    expect(text).not.toContain('"input"');
  });

  it('truncates large trace lists in session pointer', () => {
    const traces = Array.from({ length: 12 }, (_, i) => sampleTrace(`t${i}`, 1));
    const text = buildSessionMcpPointer({
      sessionId: 'big-session',
      traceCount: 12,
      observationCount: 12,
      traces,
    });
    expect(text).toContain('+4 more traces');
  });

  it('builds trace pointer with traceId and span index', () => {
    const text = buildTraceMcpPointer('session-abc', sampleTrace('trace-xyz', 3));
    expect(text).toContain('trace-xyz');
    expect(text).toContain('get_span_detail');
    expect(text).toContain('session-abc');
  });
});

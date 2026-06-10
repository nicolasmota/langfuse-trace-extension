import { describe, it, expect } from 'vitest';
import { buildExportMarkdown, buildSpanExportMarkdown } from '../export-context.js';
import type { McpSessionSnapshot } from '../mcp/serialize.js';

describe('buildExportMarkdown', () => {
  it('includes session summary and trace details', () => {
    const snapshot: McpSessionSnapshot = {
      sessionId: 'session-1',
      traceCount: 1,
      observationCount: 1,
      traces: [{
        id: 'trace-1',
        name: 'send_user_message',
        totalMs: 2000,
        tokenInput: 10,
        tokenOutput: 20,
        inputPreview: 'hello',
        outputPreview: 'hi there',
        spans: [{ id: 'obs-1', name: 'llm', type: 'GENERATION', depth: 0 }],
      }],
    };

    const markdown = buildExportMarkdown(snapshot);
    expect(markdown).toContain('session-1');
    expect(markdown).toContain('send_user_message');
    expect(markdown).toContain('hello');
    expect(markdown).toContain('[GENERATION] llm');
  });
});

describe('buildSpanExportMarkdown', () => {
  it('includes span input and output', () => {
    const markdown = buildSpanExportMarkdown('session-1', {
      traceId: 'trace-1',
      traceName: 'run',
      observation: {
        id: 'obs-1',
        traceId: 'trace-1',
        name: 'generate_content',
        type: 'GENERATION',
        input: { prompt: 'hi' },
        output: { text: 'hello' },
      },
    });
    expect(markdown).toContain('generate_content');
    expect(markdown).toContain('"prompt": "hi"');
    expect(markdown).toContain('"text": "hello"');
  });
});

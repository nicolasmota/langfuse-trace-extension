import type { McpSessionSnapshot, McpTraceSummary } from './mcp/serialize.js';

const MCP_SERVER_NAME = 'langfuse-traces';
const MAX_TRACES_IN_POINTER = 8;
const MAX_SPANS_IN_POINTER = 12;

const MCP_TOOLS_BLOCK = [
  '## MCP tools (langfuse-traces)',
  '',
  'Fetch live data via the **langfuse-traces** MCP server — do not guess or invent span contents.',
  'If tools are unavailable, run **Langfuse: Register MCP Server** or enable **langfuse-traces** under Cursor Settings → MCP.',
  '',
  '| Tool | Server | When to use |',
  '|------|--------|-------------|',
  '| `get_session_traces` | langfuse-traces | Trace list + span hierarchy for a session |',
  '| `get_span_detail` | langfuse-traces | Full input/output for one observation |',
  '| `get_active_panel_state` | langfuse-traces-panel | What the user is viewing in the panel |',
  '| `get_active_span_detail` | langfuse-traces-panel | Full I/O for the span open in the panel |',
  '',
].join('\n');

/** Compact chat prompt for a Langfuse session — delegates detail to MCP tools. */
export function buildSessionMcpPointer(snapshot: McpSessionSnapshot): string {
  const { sessionId, traceCount, observationCount, traces } = snapshot;

  const traceLines = traces.slice(0, MAX_TRACES_IN_POINTER).map(formatTraceLine);
  if (traces.length > MAX_TRACES_IN_POINTER) {
    traceLines.push(`- … +${traces.length - MAX_TRACES_IN_POINTER} more traces — call \`get_session_traces\``);
  }

  return [
    '# Langfuse session — analyze via MCP',
    '',
    MCP_TOOLS_BLOCK,
    '### Session',
    '',
    `- **sessionId:** \`${sessionId}\``,
    `- **traces:** ${traceCount}`,
    `- **spans:** ${observationCount}`,
    `- **resource:** \`langfuse://session/${sessionId}\``,
    '',
    '```json',
    JSON.stringify({ sessionId }, null, 2),
    '```',
    '',
    '### Trace index (compact)',
    '',
    traceLines.length > 0 ? traceLines.join('\n') : '- (no traces)',
    '',
    '### Task',
    '',
    'Use `get_session_traces` with the sessionId above, then drill into spans with `get_span_detail` as needed. ' +
    'Focus on errors, latency outliers, and token usage.',
    '',
  ].join('\n');
}

/** Compact chat prompt for a single trace — delegates span detail to MCP tools. */
export function buildTraceMcpPointer(sessionId: string, trace: McpTraceSummary): string {
  const spanLines = trace.spans.slice(0, MAX_SPANS_IN_POINTER).map(span => {
    const dur = span.durationMs !== undefined ? `${span.durationMs}ms` : '—';
    return `- \`${span.id}\` [${span.type ?? 'SPAN'}] ${span.name ?? 'span'} (${dur})`;
  });
  if (trace.spans.length > MAX_SPANS_IN_POINTER) {
    spanLines.push(`- … +${trace.spans.length - MAX_SPANS_IN_POINTER} more spans — use \`get_span_detail\``);
  }

  return [
    '# Langfuse trace — analyze via MCP',
    '',
    MCP_TOOLS_BLOCK,
    '### Trace',
    '',
    `- **sessionId:** \`${sessionId}\``,
    `- **traceId:** \`${trace.id}\``,
    `- **name:** ${trace.name ?? '—'}`,
    `- **duration:** ${trace.totalMs}ms`,
    `- **tokens:** ↑${trace.tokenInput} ↓${trace.tokenOutput}`,
    `- **spans:** ${trace.spans.length}`,
    '',
    '```json',
    JSON.stringify({ sessionId, traceId: trace.id }, null, 2),
    '```',
    '',
    '### Span index (compact)',
    '',
    spanLines.length > 0 ? spanLines.join('\n') : '- (no spans)',
    '',
    '### Task',
    '',
    `Use \`get_session_traces\` for session \`${sessionId}\`, then \`get_span_detail\` for spans in trace \`${trace.id}\` as needed.`,
    '',
  ].join('\n');
}

function formatTraceLine(trace: McpTraceSummary): string {
  return `- \`${trace.id}\` ${trace.name ?? 'trace'} (${trace.totalMs}ms, ${trace.spans.length} spans)`;
}

export { MCP_SERVER_NAME };

import type { McpSessionSnapshot, McpSpanDetail } from './mcp/serialize.js';
import type { PanelUiState } from './panel-state.js';

/** Builds a Markdown document suitable for @-mentioning in Cursor chat. */
export function buildExportMarkdown(
  snapshot: McpSessionSnapshot,
  panelState?: PanelUiState,
  activeSpanDetail?: McpSpanDetail | null,
): string {
  const lines: string[] = [
    `# Langfuse trace context: ${snapshot.sessionId}`,
    '',
    `- Traces: ${snapshot.traceCount}`,
    `- Spans: ${snapshot.observationCount}`,
    '',
  ];

  if (panelState) {
    lines.push('## Active panel state', '');
    lines.push(`- Focused trace: ${panelState.focusedTraceId ?? 'none'}`);
    lines.push(`- Expanded spans: ${panelState.expandedObservationIds.length}`);
    lines.push(`- Last interacted span: ${panelState.lastInteractedObservationId ?? 'none'}`);
    lines.push('');
  }

  if (activeSpanDetail) {
    lines.push('## Active span detail', '');
    lines.push(`- Trace: ${activeSpanDetail.traceId}`);
    lines.push(`- Observation: ${activeSpanDetail.observation.id}`);
    lines.push(`- Name: ${activeSpanDetail.observation.name ?? '—'}`);
    lines.push(`- Type: ${activeSpanDetail.observation.type ?? '—'}`);
    if (activeSpanDetail.observation.input !== undefined) {
      lines.push('', '### Input', '', '```json', JSON.stringify(activeSpanDetail.observation.input, null, 2), '```', '');
    }
    if (activeSpanDetail.observation.output !== undefined) {
      lines.push('### Output', '', '```json', JSON.stringify(activeSpanDetail.observation.output, null, 2), '```', '');
    }
  }

  lines.push('## Trace summary', '');
  for (const trace of snapshot.traces) {
    lines.push(`### ${trace.name ?? trace.id}`);
    lines.push(`- ID: ${trace.id}`);
    lines.push(`- Duration: ${trace.totalMs}ms`);
    lines.push(`- Tokens: ↑${trace.tokenInput} ↓${trace.tokenOutput}`);
    if (trace.inputPreview) {
      lines.push(`- User: ${trace.inputPreview}`);
    }
    if (trace.outputPreview) {
      lines.push(`- Assistant: ${trace.outputPreview}`);
    }
    lines.push('');
    for (const span of trace.spans) {
      const dur = span.durationMs !== undefined ? `${span.durationMs}ms` : '—';
      lines.push(`- [${span.type ?? 'SPAN'}] ${span.name ?? span.id} (${dur})`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

/** Builds a Markdown document focused on a single span for AI chat context. */
export function buildSpanExportMarkdown(sessionId: string, spanDetail: McpSpanDetail): string {
  const { observation } = spanDetail;
  const lines: string[] = [
    `# Langfuse span: ${observation.name ?? observation.id}`,
    '',
    `- Session: ${sessionId}`,
    `- Trace: ${spanDetail.traceId}`,
    `- Observation: ${observation.id}`,
    `- Type: ${observation.type ?? '—'}`,
  ];

  if (observation.model) {
    lines.push(`- Model: ${observation.model}`);
  }
  if (observation.usage) {
    lines.push(`- Tokens: ↑${observation.usage.input ?? '?'} ↓${observation.usage.output ?? '?'}`);
  }
  if (observation.statusMessage) {
    lines.push(`- Status: ${observation.statusMessage}`);
  }

  lines.push('');
  if (observation.input !== undefined) {
    lines.push('## Input', '', '```json', JSON.stringify(observation.input, null, 2), '```', '');
  }
  if (observation.output !== undefined) {
    lines.push('## Output', '', '```json', JSON.stringify(observation.output, null, 2), '```', '');
  }
  if (observation.metadata !== undefined) {
    lines.push('## Metadata', '', '```json', JSON.stringify(observation.metadata, null, 2), '```', '');
  }

  return lines.join('\n');
}


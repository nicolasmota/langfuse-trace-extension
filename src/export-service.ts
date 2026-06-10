import * as vscode from 'vscode';
import { buildSpanExportMarkdown } from './export-context.js';
import { buildSessionMcpPointer, buildTraceMcpPointer } from './mcp-pointer.js';
import type { PanelUiState } from './panel-state.js';
import { findObservation, buildSessionSnapshot } from './mcp/serialize.js';
import { loadTracesAndObservations } from './langfuse-service.js';
import { sendToChat } from './send-to-chat.js';

/** Scope of context sent to chat. */
export type ExportScope = 'span' | 'trace' | 'session';

/** Options for sending trace context to chat. */
export interface ExportContextOptions {
  sessionId: string;
  panelState?: PanelUiState;
  traceId?: string;
  observationId?: string;
  scope?: ExportScope;
}

/** Sends trace context to chat — full payload for spans, MCP pointers for trace/session. */
export async function performExportContext(options: ExportContextOptions): Promise<void> {
  const { sessionId, traceId, observationId } = options;
  const scope = options.scope ?? inferScope(traceId, observationId);

  const result = await loadTracesAndObservations(sessionId);
  if (!result) {
    void vscode.window.showInformationMessage(`No traces found for session ${sessionId.slice(0, 8)}….`);
    return;
  }

  let markdown: string;
  let label: string;

  if (scope === 'span') {
    if (!traceId || !observationId) {
      void vscode.window.showErrorMessage('Span export requires traceId and observationId.');
      return;
    }
    const spanDetail = findObservation(traceId, observationId, result.fullTraces);
    if (!spanDetail) {
      void vscode.window.showErrorMessage(`Span "${observationId}" not found.`);
      return;
    }
    markdown = buildSpanExportMarkdown(sessionId, spanDetail);
    label = 'Span';
  } else if (scope === 'trace') {
    if (!traceId) {
      void vscode.window.showErrorMessage('Trace export requires traceId.');
      return;
    }
    const snapshot = buildSessionSnapshot(sessionId, result.fullTraces, result.observations);
    const trace = snapshot.traces.find(t => t.id === traceId);
    if (!trace) {
      void vscode.window.showErrorMessage(`Trace "${traceId}" not found.`);
      return;
    }
    markdown = buildTraceMcpPointer(sessionId, trace);
    label = 'Trace';
  } else {
    const snapshot = buildSessionSnapshot(sessionId, result.fullTraces, result.observations);
    markdown = buildSessionMcpPointer(snapshot);
    label = 'Session';
  }

  await sendToChat(markdown);
  void vscode.window.showInformationMessage(
    scope === 'span'
      ? `${label} context sent to chat`
      : `${label} pointer sent to chat — use langfuse-traces MCP tools for details`,
  );
}

function inferScope(traceId?: string, observationId?: string): ExportScope {
  if (traceId && observationId) { return 'span'; }
  if (traceId) { return 'trace'; }
  return 'session';
}

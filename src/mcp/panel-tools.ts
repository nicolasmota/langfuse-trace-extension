import * as vscode from 'vscode';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { McpServer as McpServerType } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { loadSessionContext } from '../session/context.js';
import type { PanelUiState } from '../panel-state.js';
import { TraceViewerPanel } from '../trace-panel.js';
import { loadTracesAndObservations } from '../langfuse-service.js';

export const MCP_PANEL_SERVER_NAME = 'langfuse-traces-panel';

/** Dependencies injected from the extension host for panel interaction. */
export interface LangfuseMcpDeps {
  openTracePanel: (sessionId: string, traceIndex?: number) => Promise<void>;
  refreshOpenTrace: (sessionId?: string) => Promise<{ refreshed: boolean; sessionId?: string; message: string }>;
  getActiveSessionId: () => string | undefined;
  getOpenSessionIds: () => string[];
  getActivePanelState: () => PanelUiState | undefined;
}

function textResult(payload: unknown): CallToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
  };
}

function errorResult(message: string): CallToolResult {
  return {
    isError: true,
    content: [{ type: 'text', text: message }],
  };
}

/** Registers panel interaction tools and the active-session resource on an MCP server. */
export function registerPanelTools(server: McpServerType, deps: LangfuseMcpDeps): void {
  server.registerTool(
    'open_trace_panel',
    {
      description:
        'Open the Langfuse trace viewer panel in VS Code for the given session. ' +
        'Optionally focus a trace by index (0 = oldest message).',
      inputSchema: z.object({
        sessionId: z.string().describe('Langfuse session ID'),
        traceIndex: z.number().int().min(0).optional().describe('0-based trace index (oldest first)'),
      }),
      annotations: { readOnlyHint: false, openWorldHint: false },
    },
    async ({ sessionId, traceIndex }) => {
      try {
        await deps.openTracePanel(sessionId, traceIndex);
        return textResult({ opened: true, sessionId, traceIndex: traceIndex ?? null });
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err));
      }
    },
  );

  server.registerTool(
    'refresh_open_trace',
    {
      description:
        'Refresh trace data in an open viewer panel. Uses the active panel when sessionId is omitted.',
      inputSchema: z.object({
        sessionId: z.string().optional().describe('Session to refresh; defaults to the active panel'),
      }),
      annotations: { readOnlyHint: false, openWorldHint: false },
    },
    async ({ sessionId }) => {
      try {
        const outcome = await deps.refreshOpenTrace(sessionId);
        return textResult(outcome);
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err));
      }
    },
  );

  server.registerTool(
    'get_active_panel_state',
    {
      description:
        'Returns UI state from the active trace viewer: focused trace, expanded spans, ' +
        'and the last span the user clicked.',
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => {
      const panelState = deps.getActivePanelState();
      if (!panelState) {
        return errorResult('No trace panel is active or no UI interactions recorded yet.');
      }
      return textResult(panelState);
    },
  );

  server.registerTool(
    'get_active_span_detail',
    {
      description:
        'Returns full input/output for the span the user is currently viewing in the active panel.',
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => {
      const panelState = deps.getActivePanelState();
      const sessionId = panelState?.sessionId ?? deps.getActiveSessionId();
      if (!sessionId) {
        return errorResult('No trace panel is active.');
      }
      try {
        const context = await loadSessionContext(sessionId, panelState);
        if (!context) {
          return errorResult(`No traces found for session "${sessionId}".`);
        }
        if (!context.activeSpanDetail) {
          return errorResult('No span is selected or expanded in the active panel.');
        }
        return textResult(context.activeSpanDetail);
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err));
      }
    },
  );

  server.registerTool(
    'list_open_trace_panels',
    {
      description: 'List Langfuse trace viewer panels currently open in VS Code.',
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => {
      const openSessionIds = deps.getOpenSessionIds();
      return textResult({
        activeSessionId: deps.getActiveSessionId() ?? null,
        openSessionIds,
      });
    },
  );

  server.registerResource(
    'active-session',
    'langfuse://active',
    {
      description: 'JSON snapshot of the trace session currently shown in the active viewer panel.',
      mimeType: 'application/json',
    },
    async () => {
      const panelState = deps.getActivePanelState();
      const sessionId = panelState?.sessionId ?? deps.getActiveSessionId();
      if (!sessionId) {
        return {
          contents: [{
            uri: 'langfuse://active',
            mimeType: 'application/json',
            text: JSON.stringify({ error: 'No trace panel is currently active.' }, null, 2),
          }],
        };
      }
      const context = await loadSessionContext(sessionId, panelState);
      const payload = context ?? { sessionId, error: 'No traces found for the active session.' };
      return {
        contents: [{
          uri: 'langfuse://active',
          mimeType: 'application/json',
          text: JSON.stringify(payload, null, 2),
        }],
      };
    },
  );
}

/** Builds MCP panel interaction callbacks for the extension host. */
export function createPanelActions(): LangfuseMcpDeps {
  return {
    getActiveSessionId: () => TraceViewerPanel.getActiveSessionId(),
    getOpenSessionIds: () => TraceViewerPanel.getOpenSessionIds(),
    getActivePanelState: () => TraceViewerPanel.getActivePanelState(),

    openTracePanel: async (sessionId, traceIndex) => {
      await vscode.commands.executeCommand('langfuse.openTrace', { sessionId, traceIndex });
    },

    refreshOpenTrace: async (sessionId) => {
      const targetSessionId = sessionId?.trim() || TraceViewerPanel.getActiveSessionId();
      if (!targetSessionId) {
        return { refreshed: false, message: 'No trace panel is open and no sessionId was provided.' };
      }
      if (!TraceViewerPanel.isOpen(targetSessionId)) {
        return {
          refreshed: false,
          sessionId: targetSessionId,
          message: `No trace panel is open for session "${targetSessionId}".`,
        };
      }
      const result = await loadTracesAndObservations(targetSessionId);
      if (!result) {
        return {
          refreshed: false,
          sessionId: targetSessionId,
          message: `No traces found for session "${targetSessionId}".`,
        };
      }
      TraceViewerPanel.updateIfOpen(targetSessionId, result.fullTraces, result.observations);
      return {
        refreshed: true,
        sessionId: targetSessionId,
        message: `Refreshed trace panel for session "${targetSessionId}".`,
      };
    },
  };
}

/** Creates an MCP server with panel interaction tools (extension host only). */
export function createLangfusePanelMcpServer(deps: LangfuseMcpDeps): McpServer {
  const server = new McpServer(
    {
      name: MCP_PANEL_SERVER_NAME,
      version: '0.1.0',
    },
    {
      instructions:
        'Langfuse panel tools for the VS Code extension. Open, refresh, and inspect the active trace viewer.',
    },
  );
  registerPanelTools(server, deps);
  return server;
}

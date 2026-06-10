import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import type { LangfuseConfig } from '../langfuse-client.js';
import { LangfuseClient } from '../langfuse-client.js';
import { loadTracesAndObservationsWithConfig } from '../trace-loader.js';
import { buildSessionSnapshot, findObservation } from './serialize.js';

export const MCP_READ_SERVER_NAME = 'langfuse-traces';

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

/** Creates an MCP server with Langfuse read-only tools and session resources. */
export function createLangfuseReadMcpServer(config: LangfuseConfig): McpServer {
  const loadTraces = (sessionId: string) => loadTracesAndObservationsWithConfig(config, sessionId);
  const server = new McpServer(
    {
      name: MCP_READ_SERVER_NAME,
      version: '0.1.0',
    },
    {
      instructions:
        'Langfuse trace tools for Cursor. Use get_session_traces to inspect LLM spans and ' +
        'get_span_detail for full input/output. Resource langfuse://session/{sessionId} ' +
        'provides a JSON snapshot. Panel interaction tools require the Langfuse VS Code extension.',
    },
  );

  server.registerTool(
    'get_session_traces',
    {
      description:
        'Fetch all Langfuse traces and span summaries for a session ID. ' +
        'Returns compact JSON with timings, tokens, and span hierarchy.',
      inputSchema: z.object({
        sessionId: z.string().describe('Langfuse session ID'),
      }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ sessionId }) => {
      try {
        const result = await loadTraces(sessionId);
        if (!result) {
          return errorResult(`No traces found for session "${sessionId}".`);
        }
        return textResult(buildSessionSnapshot(sessionId, result.fullTraces, result.observations));
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err));
      }
    },
  );

  server.registerTool(
    'list_recent_sessions',
    {
      description:
        'List the most recent Langfuse sessions for the configured project, newest first.',
      inputSchema: z.object({
        limit: z.number().int().min(1).max(100).optional().describe('Max sessions to return (default 10)'),
      }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ limit }) => {
      try {
        const client = new LangfuseClient(config);
        const sessions = await client.fetchRecentSessions(limit ?? 10);
        return textResult({ sessions, count: sessions.length });
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err));
      }
    },
  );

  server.registerTool(
    'get_span_detail',
    {
      description:
        'Fetch full input, output, metadata and model parameters for a single span (observation).',
      inputSchema: z.object({
        sessionId: z.string().describe('Langfuse session ID that owns the trace'),
        traceId: z.string().describe('Langfuse trace ID'),
        observationId: z.string().describe('Langfuse observation / span ID'),
      }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ sessionId, traceId, observationId }) => {
      try {
        const result = await loadTraces(sessionId);
        if (!result) {
          return errorResult(`No traces found for session "${sessionId}".`);
        }
        const detail = findObservation(traceId, observationId, result.fullTraces);
        if (!detail) {
          return errorResult(`Observation "${observationId}" not found in trace "${traceId}".`);
        }
        return textResult(detail);
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err));
      }
    },
  );

  server.registerResource(
    'session-traces',
    new ResourceTemplate('langfuse://session/{sessionId}', { list: undefined }),
    {
      description: 'JSON snapshot of all traces for a Langfuse session ID.',
      mimeType: 'application/json',
    },
    async (uri, variables) => {
      const rawSessionId = variables.sessionId;
      const sessionId = Array.isArray(rawSessionId) ? rawSessionId[0] : rawSessionId;
      if (!sessionId) {
        return {
          contents: [{
            uri: uri.href,
            mimeType: 'application/json',
            text: JSON.stringify({ error: 'Missing sessionId in resource URI.' }, null, 2),
          }],
        };
      }
      const result = await loadTraces(sessionId);
      const snapshot = result
        ? buildSessionSnapshot(sessionId, result.fullTraces, result.observations)
        : { sessionId, error: `No traces found for session "${sessionId}".` };
      return {
        contents: [{
          uri: uri.href,
          mimeType: 'application/json',
          text: JSON.stringify(snapshot, null, 2),
        }],
      };
    },
  );

  return server;
}

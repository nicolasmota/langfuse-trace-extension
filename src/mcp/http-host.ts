import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import * as vscode from 'vscode';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createLangfusePanelMcpServer, MCP_PANEL_SERVER_NAME, type LangfuseMcpDeps } from './panel-tools.js';


interface CursorMcpApi {
  mcp?: {
    registerServer: (config: { name: string; server: { url: string } }) => void;
    unregisterServer: (serverName: string) => void;
  };
}

const PANEL_MCP_PATH = '/mcp-panel';

/** Returns true when the JSON-RPC body is an MCP initialize request. */
function isInitializeRequest(body: unknown): boolean {
  if (!body || typeof body !== 'object') { return false; }
  return (body as { method?: string }).method === 'initialize';
}

/** Reads and parses a JSON request body from an HTTP request. */
async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (chunks.length === 0) { return undefined; }
  const text = Buffer.concat(chunks).toString('utf8');
  return text ? JSON.parse(text) as unknown : undefined;
}

/** Sends a JSON error response when MCP handling fails. */
function sendJsonRpcError(res: ServerResponse, status: number, message: string): void {
  if (res.headersSent) { return; }
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({
    jsonrpc: '2.0',
    error: { code: -32_000, message },
    id: null,
  }));
}

/**
 * Hosts an in-process Streamable HTTP MCP server and registers it with Cursor
 * so the chat agent can read and interact with Langfuse traces.
 */
export class LangfuseMcpHost {
  private readonly _transports = new Map<string, StreamableHTTPServerTransport>();
  private readonly _createServer: () => McpServer;
  private _httpServer?: Server;
  private _url?: string;

  constructor(deps: LangfuseMcpDeps) {
    this._createServer = () => createLangfusePanelMcpServer(deps);
  }

  /** Starts the local MCP HTTP server and registers it with Cursor when available. */
  async start(): Promise<string | undefined> {
    if (this._httpServer) { return this._url; }

    this._httpServer = createServer((req, res) => {
      void this._handleRequest(req, res);
    });

    const url = await new Promise<string>((resolve, reject) => {
      this._httpServer!.once('error', reject);
      this._httpServer!.listen(0, '127.0.0.1', () => {
        const address = this._httpServer!.address();
        if (!address || typeof address === 'string') {
          reject(new Error('Failed to resolve MCP HTTP server address.'));
          return;
        }
        resolve(`http://127.0.0.1:${address.port}${PANEL_MCP_PATH}`);
      });
    });

    this._url = url;
    this._registerWithCursor(url);
    return url;
  }

  /** Stops the MCP server and unregisters it from Cursor. */
  async dispose(): Promise<void> {
    this._unregisterFromCursor();
    for (const transport of this._transports.values()) {
      await transport.close();
    }
    this._transports.clear();
    if (!this._httpServer) { return; }
    await new Promise<void>((resolve, reject) => {
      this._httpServer!.close(err => (err ? reject(err) : resolve()));
    });
    this._httpServer = undefined;
    this._url = undefined;
  }

  /** Returns the local MCP endpoint URL when the server is running. */
  get url(): string | undefined {
    return this._url;
  }

  private async _handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const pathname = req.url?.split('?')[0];
    if (pathname !== PANEL_MCP_PATH) {
      res.statusCode = 404;
      res.end('Not found');
      return;
    }

    try {
      if (req.method === 'GET') {
        await this._handleGet(req, res);
        return;
      }
      if (req.method === 'POST') {
        await this._handlePost(req, res);
        return;
      }
      res.statusCode = 405;
      res.end('Method not allowed');
    } catch (err) {
      console.error('[langfuse-traces] MCP request failed:', err);
      sendJsonRpcError(res, 500, err instanceof Error ? err.message : String(err));
    }
  }

  private async _handleGet(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const sessionId = req.headers['mcp-session-id'];
    const sessionKey = Array.isArray(sessionId) ? sessionId[0] : sessionId;
    if (!sessionKey) {
      res.statusCode = 400;
      res.end('Missing session ID');
      return;
    }
    const transport = this._transports.get(sessionKey);
    if (!transport) {
      res.statusCode = 404;
      res.end('Session not found');
      return;
    }
    await transport.handleRequest(req, res);
  }

  private async _handlePost(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await readJsonBody(req);
    const sessionHeader = req.headers['mcp-session-id'];
    const sessionKey = Array.isArray(sessionHeader) ? sessionHeader[0] : sessionHeader;

    if (sessionKey && this._transports.has(sessionKey)) {
      await this._transports.get(sessionKey)!.handleRequest(req, res, body);
      return;
    }

    if (!sessionKey && isInitializeRequest(body)) {
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        enableDnsRebindingProtection: false,
        onsessioninitialized: (id) => {
          this._transports.set(id, transport);
        },
      });

      transport.onclose = () => {
        const id = transport.sessionId;
        if (id) { this._transports.delete(id); }
      };

      const mcpServer = this._createServer();
      await mcpServer.connect(transport);
      await transport.handleRequest(req, res, body);
      return;
    }

    if (sessionKey) {
      sendJsonRpcError(res, 404, 'Session not found');
      return;
    }

    sendJsonRpcError(res, 400, 'Bad Request: Session ID required');
  }

  private _registerWithCursor(url: string): void {
    const cursorApi = (vscode as typeof vscode & { cursor?: CursorMcpApi }).cursor;
    if (!cursorApi?.mcp?.registerServer) {
      console.info('[langfuse-traces] Cursor MCP API not available; MCP server started at', url);
      return;
    }
    cursorApi.mcp.registerServer({
      name: MCP_PANEL_SERVER_NAME,
      server: { url },
    });
    console.info('[langfuse-traces] Registered panel MCP server with Cursor at', url);
  }

  private _unregisterFromCursor(): void {
    const cursorApi = (vscode as typeof vscode & { cursor?: CursorMcpApi }).cursor;
    if (!cursorApi?.mcp?.unregisterServer) { return; }
    cursorApi.mcp.unregisterServer(MCP_PANEL_SERVER_NAME);
  }
}

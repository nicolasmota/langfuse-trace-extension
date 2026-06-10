import * as path from 'node:path';
import * as vscode from 'vscode';
import { readLangfuseConfigAsync } from '../langfuse-service.js';
import { MCP_READ_SERVER_NAME } from './read-server.js';

/** Registers the Langfuse read MCP server with Cursor via a stdio subprocess. */
export function registerCursorMcp(context: vscode.ExtensionContext): boolean {
  const cursorApi = vscode.cursor?.mcp;
  if (!cursorApi?.registerServer) {
    console.info('[langfuse-traces] Cursor MCP API not available; stdio server not registered.');
    return false;
  }

  const scriptPath = path.join(context.extensionPath, 'out', 'mcp', 'stdio-main.js');

  void readLangfuseConfigAsync(context.secrets).then(config => {
    const env: Record<string, string> = {
      ELECTRON_RUN_AS_NODE: '1',
      LANGFUSE_HOST: config.host,
      LANGFUSE_PUBLIC_KEY: config.publicKey,
      LANGFUSE_SECRET_KEY: config.secretKey,
    };

    try {
      cursorApi.unregisterServer(MCP_READ_SERVER_NAME);
    } catch {
      // First registration — nothing to unregister.
    }

    cursorApi.registerServer({
      name: MCP_READ_SERVER_NAME,
      server: {
        command: process.execPath,
        args: [scriptPath],
        env,
      },
    });

    console.info('[langfuse-traces] Registered stdio MCP server with Cursor:', MCP_READ_SERVER_NAME);
  }).catch(err => {
    console.error('[langfuse-traces] Failed to read config for MCP registration:', err);
  });

  return true;
}

/** Unregisters the Langfuse read MCP server from Cursor. */
export function unregisterCursorMcp(): void {
  const cursorApi = vscode.cursor?.mcp;
  if (!cursorApi?.unregisterServer) { return; }
  try {
    cursorApi.unregisterServer(MCP_READ_SERVER_NAME);
  } catch {
    // Already unregistered.
  }
}

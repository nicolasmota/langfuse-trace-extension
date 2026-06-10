import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { readLangfuseConfigFromEnv } from '../langfuse-env.js';
import { createLangfuseReadMcpServer } from './read-server.js';

/**
 * Stdio MCP entry point spawned by the extension and registered with Cursor.
 * Must not import vscode — runs as a child process of the editor.
 */
async function main(): Promise<void> {
  const server = createLangfuseReadMcpServer(readLangfuseConfigFromEnv());
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err: unknown) => {
  console.error('[langfuse-traces] stdio MCP failed:', err);
  process.exit(1);
});

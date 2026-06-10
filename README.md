# Langfuse Traces for VS Code

Inspect LLM traces, spans, token usage and costs from [Langfuse](https://langfuse.com) directly inside VS Code or Cursor — without switching tabs.

## Screenshots

![Trace panel with waterfall view](https://raw.githubusercontent.com/nicolasmota/langfuse-trace-extension/main/images/screenshot-waterfall.png)

## Quick start

1. **Configure Langfuse** in Settings → search `langfuse` and set `host`, `publicKey`, and `secretKey`.
2. **Open the Langfuse sidebar** — click the Langfuse icon in the Activity Bar. Recent sessions from your project load automatically.
3. **Open a session** — click a session in the sidebar, or use the Command Palette:
   - `Langfuse: Open Trace Panel` — focuses the active panel or prompts for a session ID
   - `Langfuse: Open Trace by Session ID…` — paste a session ID to load the full conversation

The first trace panel opens beside your editor; additional sessions open as tabs in the same editor group. Re-opening an already-open session focuses the existing tab instead of creating a new split.

## Features

- **Inline trace panel** — waterfall view with span timings, nesting depth, tokens and costs
- **Session sidebar** — lists recent Langfuse sessions; pin, refresh, hide, or open with one click
- **JSON / Formatted toggle** — raw JSON or human-readable chat view for every input and output
- **Open by session ID** — load a full conversation from the sidebar or Command Palette
- **Send context to chat** — export span, trace, or session context into Cursor/VS Code chat (MCP pointers for agents)
- **MCP integration (Cursor)** — agents can list sessions, fetch traces, inspect spans, and control the open panel
- **Auto-refresh** — panel updates when a host extension triggers `langfuse.autoRefreshIfOpen`
- **Direct link to Langfuse UI** — open any trace in the full Langfuse web app
- **Local or cloud Langfuse** — point `langfuse.host` at Docker, self-hosted, or [cloud.langfuse.com](https://cloud.langfuse.com)

## Commands

| Command | Description |
|---|---|
| `Langfuse: Open Trace Panel` | Focus the active panel or open by session ID |
| `Langfuse: Open Trace by Session ID…` | Open (or focus) a panel by session ID |
| `Langfuse: Send Trace Context to Chat` | Send active panel context to chat |
| `Langfuse: Add Session` | Pin a session ID in the sidebar |
| `Langfuse: Refresh` | Reload recent sessions in the sidebar |
| `Langfuse: Open Session Traces` | Open traces for a sidebar session |
| `Langfuse: Hide from Sidebar` | Remove a session from the sidebar (does not delete data in Langfuse) |
| `Langfuse: Send Session to Chat (MCP)` | Send an MCP pointer for a sidebar session to chat |
| `Langfuse: Register MCP Server` | Re-register the Langfuse MCP server with Cursor |

## Configuration

| Setting | Default | Description |
|---|---|---|
| `langfuse.host` | `http://127.0.0.1:3000` | Base URL of your Langfuse instance |
| `langfuse.publicKey` | `pk-lf-local-dev` | Langfuse public API key |
| `langfuse.secretKey` | `sk-lf-local-dev` | Langfuse secret API key |
| `langfuse.recentSessionsLimit` | `10` | How many recent sessions to show in the sidebar (1–100) |

## Requirements

A running Langfuse instance with API access:

- **Local (Docker):** follow the [self-host guide](https://langfuse.com/docs/deployment/local) — defaults work out of the box
- **Cloud:** [cloud.langfuse.com](https://cloud.langfuse.com) — set your project API keys in settings

The extension talks directly to the host you configure. With a local instance, data stays on your machine; with cloud Langfuse, requests go to your cloud project.

## MCP (Cursor)

On activation, the extension registers two MCP servers when running in Cursor:

### `langfuse-traces` (stdio — Langfuse API)

Read-only access to your Langfuse project:

| Tool | Description |
|---|---|
| `get_session_traces` | Fetch all traces and span summaries for a session |
| `list_recent_sessions` | List recent sessions (newest first) |
| `get_span_detail` | Full input/output for a single span |

**Resource:** `langfuse://session/{sessionId}` — JSON snapshot of a session.

### `langfuse-traces-panel` (HTTP — active viewer)

Interact with open trace panels in the editor:

| Tool | Description |
|---|---|
| `open_trace_panel` | Open the viewer for a session (optional `traceIndex`) |
| `refresh_open_trace` | Refresh data in an open panel |
| `get_active_panel_state` | Focused trace, expanded spans, last clicked span |
| `get_active_span_detail` | Full I/O for the span currently viewed |
| `list_open_trace_panels` | Session IDs of all open panels |

**Resource:** `langfuse://active` — JSON snapshot of the active panel session.

Enable both servers under **Cursor Settings → MCP**. If they do not appear, run `Langfuse: Register MCP Server`.

## Programmatic API (for extension authors)

Host extensions (e.g. a webchat panel) can open traces without user input:

```typescript
await vscode.commands.executeCommand('langfuse.openTrace', {
  sessionId: '<your-langfuse-session-id>',
  traceIndex: 2, // optional — 0-based, oldest message first
});

// Background refresh after a new LLM response (no-op if panel is closed)
vscode.commands.executeCommand('langfuse.autoRefreshIfOpen', {
  sessionId: '<your-langfuse-session-id>',
});
```

`sessionId` must match the Langfuse `sessionId` field on your traces (Python/JS SDK or OTel `session.id` attribute).

## How it works

1. Your backend instruments LLM calls with the Langfuse SDK and sets `sessionId` on each trace.
2. This extension queries the Langfuse REST API (`GET /api/public/traces?sessionId=…` and `GET /api/public/traces/{traceId}` per trace).
3. Traces render in a webview panel beside the editor; the sidebar lists recent sessions from `GET /api/public/sessions`.

## Development

```bash
make setup          # install deps, compile, run tests
make dev            # open Extension Development Host (Cursor or VS Code)
make package        # build langfuse-traces.vsix
make install-local  # install .vsix in the current editor window
make test           # run unit tests
make doctor         # diagnostics when the extension does not show up
```

Override the editor with `make dev IDE=code` if you prefer VS Code over Cursor.

## License

MIT

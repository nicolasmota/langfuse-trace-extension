# Langfuse Traces for VS Code

Inspect LLM traces, spans, token usage and costs from [Langfuse](https://langfuse.com) directly inside VS Code — without switching tabs.

## Features

- **Inline trace panel** — opens beside your active editor, scoped to a single session
- **Waterfall view** — visualise span timings and nesting depth at a glance
- **Token & cost summary** — aggregated across all traces in the session
- **JSON / Formatted toggle** — flip between raw JSON and a human-readable chat-message view for every input and output
- **Auto-refresh** — panel updates automatically when a new LLM response arrives (when triggered by a host extension)
- **Direct link to Langfuse UI** — one-click to open any trace in the full Langfuse web app
- **Works with local and cloud Langfuse** — configure any host URL

## Requirements

A running Langfuse instance:

- **Local (Docker):** follow the [self-host guide](https://langfuse.com/docs/deployment/local) — defaults work out of the box
- **Cloud:** [cloud.langfuse.com](https://cloud.langfuse.com) — set your API keys in settings

## Configuration

| Setting | Default | Description |
|---|---|---|
| `langfuse.host` | `http://127.0.0.1:3000` | Base URL of your Langfuse instance |
| `langfuse.publicKey` | `pk-lf-local-dev` | Langfuse public API key |
| `langfuse.secretKey` | `sk-lf-local-dev` | Langfuse secret API key |

## Programmatic API (for extension authors)

Other VS Code extensions can open the trace panel by calling the commands this extension registers:

```typescript
// Open the trace viewer for a Langfuse session
await vscode.commands.executeCommand('langfuse.openTrace', {
  sessionId: '<your-langfuse-session-id>',
  traceIndex: 2, // optional — scroll to the Nth trace (0-based, oldest first)
});

// Trigger a background auto-refresh (no-op if panel is not open)
vscode.commands.executeCommand('langfuse.autoRefreshIfOpen', {
  sessionId: '<your-langfuse-session-id>',
});
```

`sessionId` must match the native Langfuse `sessionId` field set on your traces (via the Python/JS SDK or OTel `session.id` attribute).

## How it works

1. Your backend instruments LLM calls with the Langfuse SDK and sets a `sessionId` on each trace
2. A host extension calls `langfuse.openTrace` with that identifier
3. This extension queries the Langfuse REST API using `?sessionId=...` and renders the matching traces in a webview panel beside the chat

No data leaves your machine — the extension talks directly to your Langfuse instance.

## License

MIT

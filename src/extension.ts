import * as vscode from 'vscode';
import { TraceViewerPanel } from './trace-panel';
import { readLangfuseConfig, loadByTraceId, loadTracesAndObservations } from './langfuse-service';
import { focusIndexForTraceId } from './trace-utils';
import { LangfuseMcpHost } from './mcp/http-host';
import { createPanelActions } from './mcp/panel-tools';
import { registerCursorMcp, unregisterCursorMcp } from './mcp/register-cursor';
import { LangfuseSessionsProvider, SessionTreeItem } from './session/tree';
import { rememberSession } from './session/store';
import { performExportContext } from './export-service';

export function activate(context: vscode.ExtensionContext): void {
  const sessionsProvider = new LangfuseSessionsProvider(context.globalState);
  context.subscriptions.push(
    vscode.window.createTreeView('langfuse.sessions', {
      treeDataProvider: sessionsProvider,
      showCollapseAll: true,
    }),
  );

  registerCursorMcp(context);
  context.subscriptions.push({ dispose: () => unregisterCursorMcp() });
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(event => {
      if (event.affectsConfiguration('langfuse')) {
        registerCursorMcp(context);
        sessionsProvider.refresh();
      }
    }),
  );

  const mcpHost = new LangfuseMcpHost(createPanelActions());
  void mcpHost.start().catch(err => {
    console.warn(`[langfuse-traces] panel MCP server failed to start: ${err instanceof Error ? err.message : String(err)}`);
  });
  context.subscriptions.push({ dispose: () => { void mcpHost.dispose(); } });

  const promptForSessionId = async (title: string): Promise<string | undefined> => {
    const sessionId = await vscode.window.showInputBox({
      title,
      prompt: 'Enter the Langfuse session ID',
      placeHolder: 'e.g. my-session-abc123',
      ignoreFocusOut: true,
    });
    return sessionId?.trim() || undefined;
  };

  const promptForTraceId = async (title: string): Promise<string | undefined> => {
    const traceId = await vscode.window.showInputBox({
      title,
      prompt: 'Enter the Langfuse trace ID (from the Langfuse UI URL)',
      placeHolder: 'e.g. copy from …/trace/abc-123',
      ignoreFocusOut: true,
    });
    return traceId?.trim() || undefined;
  };

  context.subscriptions.push(
    vscode.commands.registerCommand('langfuse.sessions.refresh', () => {
      sessionsProvider.refresh();
    }),
    vscode.commands.registerCommand('langfuse.sessions.add', async () => {
      const sessionId = await promptForSessionId('Add Langfuse Session');
      if (!sessionId) { return; }
      await sessionsProvider.addSession(sessionId);
      await vscode.commands.executeCommand('langfuse.openTrace', { sessionId });
    }),
    vscode.commands.registerCommand('langfuse.sessions.open', async (item?: SessionTreeItem) => {
      const sessionId = item?.sessionId ?? await promptForSessionId('Open Langfuse Session');
      if (!sessionId) { return; }
      await sessionsProvider.addSession(sessionId);
      if (TraceViewerPanel.isOpen(sessionId)) {
        TraceViewerPanel.reveal(sessionId);
        return;
      }
      await vscode.commands.executeCommand('langfuse.openTrace', { sessionId });
    }),
    vscode.commands.registerCommand('langfuse.sessions.remove', async (item?: SessionTreeItem) => {
      const sessionId = item?.sessionId ?? await promptForSessionId('Remove Langfuse Session');
      if (!sessionId) { return; }
      await sessionsProvider.removeSession(sessionId);
    }),
    vscode.commands.registerCommand('langfuse.sessions.sendToChat', async (item?: SessionTreeItem) => {
      const sessionId = item?.sessionId ?? await promptForSessionId('Send Langfuse Session to Chat');
      if (!sessionId) { return; }
      try {
        await performExportContext({ sessionId, scope: 'session' });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        void vscode.window.showErrorMessage(`Could not send session to chat: ${message}`);
      }
    }),
    vscode.commands.registerCommand(
      'langfuse.openTrace',
      async (args?: { sessionId?: string; traceId?: string; traceIndex?: number }) => {
        let sessionId = args?.sessionId?.trim();
        let traceId = args?.traceId?.trim();
        const traceIndex = args?.traceIndex;

        if (!sessionId && !traceId) {
          const activeSessionId = TraceViewerPanel.getActiveSessionId();
          if (activeSessionId && TraceViewerPanel.isOpen(activeSessionId)) {
            TraceViewerPanel.reveal(activeSessionId);
            const refreshFn = async (): Promise<void> => {
              const result = await loadTracesAndObservations(activeSessionId);
              if (!result) { return; }
              TraceViewerPanel.updateIfOpen(activeSessionId, result.fullTraces, result.observations);
            };
            void refreshFn();
            return;
          }
          traceId = await promptForTraceId('Open Langfuse Trace Panel');
        }
        if (!sessionId && !traceId) { return; }

        const { host: langfuseHost } = readLangfuseConfig();
        try {
          if (traceId) {
            const loaded = await loadByTraceId(traceId);
            if (!loaded) {
              vscode.window.showInformationMessage(
                `No Langfuse trace found for ID ${traceId.slice(0, 8)}…. ` +
                'Check the trace ID from the Langfuse UI and that the trace has flushed.',
              );
              return;
            }

            const { panelKey, sessionId: loadedSessionId, fullTraces, observations } = loaded;
            const refreshFn = async (): Promise<void> => {
              const refreshed = await loadByTraceId(traceId);
              if (!refreshed) { return; }
              TraceViewerPanel.updateIfOpen(panelKey, refreshed.fullTraces, refreshed.observations);
            };
            const focusIdx = typeof traceIndex === 'number'
              ? (fullTraces.length - 1 - traceIndex)
              : focusIndexForTraceId(fullTraces, traceId);

            if (TraceViewerPanel.isOpen(panelKey) && typeof traceIndex !== 'number') {
              TraceViewerPanel.reveal(panelKey);
              void refreshFn();
              TraceViewerPanel.focusAt(panelKey, Math.max(0, focusIdx));
              return;
            }

            if (loadedSessionId) {
              await rememberSession(context.globalState, loadedSessionId);
              sessionsProvider.refresh();
            }
            TraceViewerPanel.createOrShow(panelKey, fullTraces, observations, context, refreshFn, langfuseHost);
            TraceViewerPanel.focusAt(panelKey, Math.max(0, focusIdx));
            return;
          }

          const refreshFn = async (): Promise<void> => {
            const result = await loadTracesAndObservations(sessionId!);
            if (!result) { return; }
            TraceViewerPanel.updateIfOpen(sessionId!, result.fullTraces, result.observations);
          };
          const alreadyOpen = TraceViewerPanel.isOpen(sessionId!);
          if (alreadyOpen && typeof traceIndex !== 'number') {
            TraceViewerPanel.reveal(sessionId!);
            void refreshFn();
            return;
          }

          const result = await loadTracesAndObservations(sessionId!);
          if (!result) {
            vscode.window.showInformationMessage(
              `No Langfuse traces found for session ${sessionId!.slice(0, 8)}…. ` +
              'Ensure local Langfuse is running, the service sent at least one reply, and a few seconds have passed for the trace to flush.',
            );
            return;
          }
          const focusIdx = typeof traceIndex === 'number'
            ? (result.fullTraces.length - 1 - traceIndex)
            : 0;
          await rememberSession(context.globalState, sessionId!);
          sessionsProvider.refresh();
          TraceViewerPanel.createOrShow(sessionId!, result.fullTraces, result.observations, context, refreshFn, langfuseHost);
          TraceViewerPanel.focusAt(sessionId!, Math.max(0, focusIdx));
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          vscode.window.showErrorMessage(`Could not fetch Langfuse trace: ${message}`);
        }
      },
    ),
    vscode.commands.registerCommand(
      'langfuse.openTraceById',
      async () => {
        const sessionId = await vscode.window.showInputBox({
          title: 'Open Langfuse Trace',
          prompt: 'Enter the Langfuse session ID',
          placeHolder: 'e.g. my-session-abc123',
          ignoreFocusOut: true,
        });
        if (!sessionId?.trim()) { return; }
        await vscode.commands.executeCommand('langfuse.openTrace', { sessionId: sessionId.trim() });
      },
    ),
    vscode.commands.registerCommand(
      'langfuse.exportContext',
      async () => {
        const panelState = TraceViewerPanel.getActivePanelState();
        let sessionId = panelState?.sessionId ?? TraceViewerPanel.getActiveSessionId();
        if (!sessionId) {
          sessionId = await promptForSessionId('Export Langfuse Trace Context');
        }
        if (!sessionId) { return; }

        try {
          await performExportContext({ sessionId, panelState, scope: 'session' });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          void vscode.window.showErrorMessage(`Could not export trace context: ${message}`);
        }
      },
    ),
    vscode.commands.registerCommand('langfuse.mcp.reregister', () => {
      const ok = registerCursorMcp(context);
      void vscode.window.showInformationMessage(
        ok
          ? 'Langfuse MCP server (langfuse-traces) re-registered with Cursor.'
          : 'Cursor MCP API not available. Ensure you are running in Cursor with the extension activated.',
      );
    }),
    vscode.commands.registerCommand(
      'langfuse.autoRefreshIfOpen',
      ({ sessionId }: { sessionId: string }) => {
        if (!TraceViewerPanel.isOpen(sessionId)) { return; }
        setTimeout(() => {
          if (!TraceViewerPanel.isOpen(sessionId)) { return; }
          loadTracesAndObservations(sessionId).then(result => {
            if (!result || !TraceViewerPanel.isOpen(sessionId)) { return; }
            TraceViewerPanel.updateIfOpen(sessionId, result.fullTraces, result.observations);
          }).catch(err => {
            console.warn(`[langfuse-traces] auto-refresh failed for ${sessionId}: ${err instanceof Error ? err.message : String(err)}`);
          });
        }, 3500);
      },
    ),
  );
}

export function deactivate(): void {}

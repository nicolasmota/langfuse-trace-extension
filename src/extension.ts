import * as vscode from 'vscode';
import { TraceViewerPanel } from './trace-panel';
import { readLangfuseConfig, loadTracesAndObservations } from './langfuse-service';

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'langfuse.openTrace',
      async ({ streamId, traceIndex }: { streamId: string; traceIndex?: number }) => {
        const { host: langfuseHost } = readLangfuseConfig();
        const refreshFn = async (): Promise<void> => {
          const result = await loadTracesAndObservations(streamId);
          if (!result) { return; }
          TraceViewerPanel.updateIfOpen(streamId, result.fullTraces, result.observations);
        };
        try {
          const result = await loadTracesAndObservations(streamId);
          if (!result) {
            vscode.window.showInformationMessage(
              `No Langfuse traces found for stream ${streamId.slice(0, 8)}…. ` +
              'Ensure local Langfuse is running, the service sent at least one reply, and a few seconds have passed for the trace to flush.',
            );
            return;
          }
          // Panel sorts newest-first (index 0 = latest); chat bubbles are
          // oldest-first (traceIndex 0 = first message). Mirror formula converts.
          // Header button (no traceIndex) → focus index 0 (most recent).
          const focusIdx = typeof traceIndex === 'number'
            ? (result.fullTraces.length - 1 - traceIndex)
            : 0;
          TraceViewerPanel.createOrShow(streamId, result.fullTraces, result.observations, context, refreshFn, langfuseHost);
          TraceViewerPanel.focusAt(streamId, Math.max(0, focusIdx));
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          vscode.window.showErrorMessage(`Could not fetch Langfuse trace: ${message}`);
        }
      },
    ),
    vscode.commands.registerCommand(
      'langfuse.autoRefreshIfOpen',
      ({ streamId }: { streamId: string }) => {
        if (!TraceViewerPanel.isOpen(streamId)) { return; }
        setTimeout(() => {
          if (!TraceViewerPanel.isOpen(streamId)) { return; }
          loadTracesAndObservations(streamId).then(result => {
            if (!result || !TraceViewerPanel.isOpen(streamId)) { return; }
            TraceViewerPanel.updateIfOpen(streamId, result.fullTraces, result.observations);
          }).catch(err => {
            console.warn(`[langfuse-traces] auto-refresh failed for ${streamId}: ${err instanceof Error ? err.message : String(err)}`);
          });
        }, 3500);
      },
    ),
  );
}

export function deactivate(): void {}

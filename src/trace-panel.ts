import * as vscode from 'vscode';
import type { LangfuseObservation, LangfuseTrace } from './langfuse-client.js';
import type { PanelUiState } from './panel-state.js';
import { performExportContext } from './export-service.js';
import { buildTracePanelHtml } from './trace-panel-html.js';

/** Manages a single "Langfuse Trace" webview panel per chat session. */
export class TraceViewerPanel {
  private static readonly _viewType = 'langfuseTrace';
  private static _instances = new Map<string, TraceViewerPanel>();
  private static _opening = new Set<string>();
  private static _sharedViewColumn?: vscode.ViewColumn;
  private static _activeSessionId?: string;

  private readonly _panel: vscode.WebviewPanel;
  private readonly _sessionId: string;
  private _refreshFn?: () => Promise<void>;
  private _langfuseHost: string;
  private _uiState?: PanelUiState;

  private constructor(
    sessionId: string,
    panel: vscode.WebviewPanel,
    refreshFn?: () => Promise<void>,
    langfuseHost = '',
  ) {
    this._sessionId = sessionId;
    this._panel = panel;
    this._refreshFn = refreshFn;
    this._langfuseHost = langfuseHost;
    this._panel.onDidDispose(() => {
      TraceViewerPanel._instances.delete(this._sessionId);
      if (TraceViewerPanel._instances.size === 0) {
        TraceViewerPanel._sharedViewColumn = undefined;
      }
      if (TraceViewerPanel._activeSessionId === this._sessionId) {
        const remaining = TraceViewerPanel.getOpenSessionIds();
        TraceViewerPanel._activeSessionId = remaining.at(-1);
      }
    });
    this._panel.webview.onDidReceiveMessage(async (msg: {
      command: string;
      url?: string;
      focusedTraceIndex?: number | null;
      focusedTraceId?: string | null;
      expandedObservationIds?: string[];
      lastInteractedObservationId?: string | null;
      lastInteractedTraceId?: string | null;
      traceId?: string;
      observationId?: string;
    }) => {
      if (msg.command === 'uiState') {
        this._uiState = {
          sessionId: this._sessionId,
          focusedTraceIndex: typeof msg.focusedTraceIndex === 'number' ? msg.focusedTraceIndex : null,
          focusedTraceId: msg.focusedTraceId ?? null,
          expandedObservationIds: Array.isArray(msg.expandedObservationIds) ? msg.expandedObservationIds : [],
          lastInteractedObservationId: msg.lastInteractedObservationId ?? null,
          lastInteractedTraceId: msg.lastInteractedTraceId ?? null,
        };
        TraceViewerPanel._setActiveSession(this._sessionId);
        return;
      }
      if (msg.command === 'refresh' && this._refreshFn) {
        try {
          await this._refreshFn();
        } catch (err) {
          void vscode.window.showErrorMessage(`Trace refresh failed: ${err instanceof Error ? err.message : String(err)}`);
        }
        void this._panel.webview.postMessage({ command: 'refreshDone' });
      }
      if (msg.command === 'openExternal' && msg.url) {
        try {
          const parsed = new URL(msg.url);
          if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
            void vscode.env.openExternal(vscode.Uri.parse(msg.url));
          }
        } catch {
          // Invalid URL — ignore silently.
        }
      }
      if (msg.command === 'exportSpan' && msg.traceId && msg.observationId) {
        try {
          await performExportContext({
            sessionId: this._sessionId,
            traceId: msg.traceId,
            observationId: msg.observationId,
            scope: 'span',
          });
        } catch (err) {
          void vscode.window.showErrorMessage(
            `Could not export span: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
        void this._panel.webview.postMessage({ command: 'exportDone', observationId: msg.observationId });
      }
      if (msg.command === 'exportSession') {
        try {
          await performExportContext({ sessionId: this._sessionId, scope: 'session' });
        } catch (err) {
          void vscode.window.showErrorMessage(
            `Could not send session to chat: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
        void this._panel.webview.postMessage({ command: 'exportDone' });
      }
      if (msg.command === 'exportTrace' && msg.traceId) {
        try {
          await performExportContext({
            sessionId: this._sessionId,
            traceId: msg.traceId,
            scope: 'trace',
          });
        } catch (err) {
          void vscode.window.showErrorMessage(
            `Could not send trace to chat: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
        void this._panel.webview.postMessage({ command: 'exportDone', traceId: msg.traceId });
      }
    });
  }

  /**
   * Opens or reveals the trace viewer panel for a given session.
   * An optional `refreshFn` is called when the user clicks the Refresh button
   * inside the panel; it should re-fetch and call `updateIfOpen` or `createOrShow`.
   */
  static createOrShow(
    sessionId: string,
    traces: LangfuseTrace[],
    observations: LangfuseObservation[],
    context: vscode.ExtensionContext,
    refreshFn?: () => Promise<void>,
    langfuseHost = '',
  ): void {
    const existing = TraceViewerPanel._instances.get(sessionId);
    if (existing) {
      existing._refreshFn = refreshFn ?? existing._refreshFn;
      if (langfuseHost) { existing._langfuseHost = langfuseHost; }
      TraceViewerPanel._revealPanel(existing._panel, sessionId);
      existing._update(traces, observations);
      return;
    }

    if (TraceViewerPanel._opening.has(sessionId)) { return; }
    TraceViewerPanel._opening.add(sessionId);

    try {
      const panel = vscode.window.createWebviewPanel(
        TraceViewerPanel._viewType,
        `Trace: ${sessionId.slice(0, 8)}…`,
        { viewColumn: TraceViewerPanel._resolveCreateViewColumn(), preserveFocus: false },
        {
          enableScripts: true,
          retainContextWhenHidden: true,
          localResourceRoots: context.extensionUri ? [context.extensionUri] : [],
        },
      );

      TraceViewerPanel._rememberSharedViewColumn(panel);

      const instance = new TraceViewerPanel(sessionId, panel, refreshFn, langfuseHost);
      TraceViewerPanel._instances.set(sessionId, instance);
      TraceViewerPanel._setActiveSession(sessionId);
      instance._update(traces, observations);
    } finally {
      TraceViewerPanel._opening.delete(sessionId);
    }
  }

  /** Reveals an already-open trace panel without creating a new editor split. */
  static reveal(sessionId: string): boolean {
    const existing = TraceViewerPanel._instances.get(sessionId);
    if (!existing) { return false; }
    TraceViewerPanel._revealPanel(existing._panel, sessionId);
    return true;
  }

  /** Returns true if a panel is currently open for the given session. */
  static isOpen(sessionId: string): boolean {
    return TraceViewerPanel._instances.has(sessionId);
  }

  /** Returns session IDs for all currently open trace viewer panels. */
  static getOpenSessionIds(): string[] {
    return [...TraceViewerPanel._instances.keys()];
  }

  /** Returns the session ID of the most recently revealed trace panel, if any. */
  static getActiveSessionId(): string | undefined {
    return TraceViewerPanel._activeSessionId;
  }

  /** Returns UI state from the active trace viewer panel, if any. */
  static getActivePanelState(): PanelUiState | undefined {
    const sessionId = TraceViewerPanel._activeSessionId;
    if (!sessionId) { return undefined; }
    return TraceViewerPanel._instances.get(sessionId)?._uiState;
  }

  private static _setActiveSession(sessionId: string): void {
    TraceViewerPanel._activeSessionId = sessionId;
  }

  private static _revealPanel(panel: vscode.WebviewPanel, sessionId: string): void {
    panel.reveal(panel.viewColumn ?? TraceViewerPanel._sharedViewColumn ?? vscode.ViewColumn.Beside, false);
    TraceViewerPanel._setActiveSession(sessionId);
  }

  /** First trace panel splits beside the editor; later ones open as tabs in that group. */
  private static _resolveCreateViewColumn(): vscode.ViewColumn {
    if (TraceViewerPanel._sharedViewColumn !== undefined) {
      return TraceViewerPanel._sharedViewColumn;
    }
    for (const instance of TraceViewerPanel._instances.values()) {
      const column = instance._panel.viewColumn;
      if (column !== undefined) {
        return column;
      }
    }
    return vscode.ViewColumn.Beside;
  }

  private static _rememberSharedViewColumn(panel: vscode.WebviewPanel): void {
    if (TraceViewerPanel._sharedViewColumn !== undefined) { return; }
    if (panel.viewColumn !== undefined) {
      TraceViewerPanel._sharedViewColumn = panel.viewColumn;
    }
  }

  /**
   * Updates an already-open panel with new trace data without revealing it.
   * Returns false when no panel is open for the session (no-op).
   */
  static updateIfOpen(
    sessionId: string,
    traces: LangfuseTrace[],
    observations: LangfuseObservation[],
  ): boolean {
    const existing = TraceViewerPanel._instances.get(sessionId);
    if (!existing) { return false; }
    existing._update(traces, observations);
    return true;
  }

  /**
   * Scrolls to and expands the trace at the given index.
   * The panel displays traces sorted oldest-first, so index 0 = first message sent.
   */
  static focusAt(sessionId: string, index: number): void {
    const existing = TraceViewerPanel._instances.get(sessionId);
    if (!existing) { return; }
    void existing._panel.webview.postMessage({ command: 'focusTrace', index });
  }

  private _update(traces: LangfuseTrace[], observations: LangfuseObservation[]): void {
    this._panel.webview.html = buildTracePanelHtml(this._sessionId, traces, observations, this._langfuseHost);
  }
}

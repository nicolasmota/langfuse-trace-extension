import * as vscode from 'vscode';
import type { LangfuseObservation, LangfuseTrace } from './langfuse-client.js';
import {
  type TraceSummary,
  isDefined,
  fmtDate,
  fmtMs,
  durationMs,
  observationTypeColor,
  computeDepths,
  buildTraceSummaries,
} from './trace-utils.js';
import type { PanelUiState } from './panel-state.js';
import { performExportContext } from './export-service.js';

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
        void vscode.env.openExternal(vscode.Uri.parse(msg.url));
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
    this._panel.webview.html = buildHtml(this._sessionId, traces, observations, this._langfuseHost);
  }
}

function escHtml(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}



function buildWaterfallBar(obs: LangfuseObservation, windowStart: number, windowMs: number): string {
  if (!obs.startTime || windowMs <= 0) {
    return `<div class="wf-bar" style="left:0%;width:100%;background:var(--wf-color)"></div>`;
  }
  const obsStart = new Date(obs.startTime).getTime();
  const obsDur = durationMs(obs) ?? 50;
  const left = Math.max(0, Math.min(98, ((obsStart - windowStart) / windowMs) * 100));
  const width = Math.max(1, Math.min(100 - left, (obsDur / windowMs) * 100));
  return `<div class="wf-bar" style="left:${left.toFixed(1)}%;width:${width.toFixed(1)}%;background:var(--wf-color)"></div>`;
}

function renderObsJson(value: unknown): string {
  if (!isDefined(value)) { return '<em class="dim">—</em>'; }
  try {
    const json = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
    return `<pre class="json-block">${escHtml(json)}</pre>`;
  } catch {
    return escHtml(String(value));
  }
}

/** Renders a content part that may be a string, a {text} object, or a nested array. */
function renderContentPart(part: unknown): string {
  if (typeof part === 'string') {
    return `<p class="fmt-text">${escHtml(part)}</p>`;
  }
  if (isDefined(part) && typeof part === 'object' && !Array.isArray(part)) {
    const p = part as Record<string, unknown>;
    if (typeof p['text'] === 'string') {
      return `<p class="fmt-text">${escHtml(p['text'])}</p>`;
    }
  }
  try {
    return `<pre class="json-block fmt-nested">${escHtml(JSON.stringify(part, null, 2))}</pre>`;
  } catch {
    return escHtml(String(part));
  }
}

/** Renders message content which may be a string, an array of parts, or other objects. */
function renderMessageContent(content: unknown): string {
  if (typeof content === 'string') {
    return `<p class="fmt-text">${escHtml(content)}</p>`;
  }
  if (Array.isArray(content)) {
    return (content as unknown[]).map(renderContentPart).join('');
  }
  return renderContentPart(content);
}

/** Returns true when an array looks like a chat messages/contents list. */
function isChatMessages(arr: unknown[]): boolean {
  return arr.length > 0 && arr.every(item => {
    if (!isDefined(item) || typeof item !== 'object' || Array.isArray(item)) { return false; }
    const o = item as Record<string, unknown>;
    return 'role' in o || 'content' in o || 'parts' in o;
  });
}

/**
 * Recursively renders a value in a human-friendly way.
 * Chat message arrays become role-labeled bubbles; objects become key-value
 * tables; primitives are shown inline.
 */
function renderFormatted(value: unknown, depth = 0): string {
  if (!isDefined(value)) { return '<em class="dim">null</em>'; }

  if (typeof value === 'string') {
    return value.length === 0
      ? '<em class="dim">(empty)</em>'
      : `<p class="fmt-text">${escHtml(value)}</p>`;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return `<span class="fmt-primitive">${escHtml(String(value))}</span>`;
  }

  if (Array.isArray(value)) {
    if (isChatMessages(value)) {
      return value.map(item => {
        const msg = item as Record<string, unknown>;
        const role = String(msg['role'] ?? '?');
        const content = msg['content'] ?? msg['parts'] ?? '';
        const safeRole = role.replace(/[^a-z0-9]/gi, '');
        return `<div class="fmt-msg fmt-msg-${escHtml(safeRole)}">
          <span class="fmt-msg-role">${escHtml(role)}</span>
          <div class="fmt-msg-body">${renderMessageContent(content)}</div>
        </div>`;
      }).join('');
    }
    if (value.length === 0) { return '<em class="dim">(empty list)</em>'; }
    return `<div class="fmt-list">${(value as unknown[]).map((item, i) =>
      `<div class="fmt-list-item"><span class="fmt-list-idx">[${i}]</span><div class="fmt-list-val">${renderFormatted(item, depth + 1)}</div></div>`
    ).join('')}</div>`;
  }

  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const entries = Object.entries(obj);
    if (entries.length === 0) { return '<em class="dim">{ }</em>'; }

    const chatKey = entries.find(([k]) => k === 'messages' || k === 'contents' || k === 'parts');
    if (chatKey && Array.isArray(chatKey[1]) && isChatMessages(chatKey[1])) {
      const rest = entries.filter(([k]) => k !== chatKey[0]);
      const header = rest.map(([k, v]) => `<span class="fmt-meta-kv"><span class="fmt-key">${escHtml(k)}</span>: <span class="fmt-primitive">${escHtml(String(v))}</span></span>`).join(' ');
      return (header ? `<div class="fmt-meta-row">${header}</div>` : '') + renderFormatted(chatKey[1], depth);
    }

    if (depth >= 2) {
      try { return `<pre class="json-block fmt-nested">${escHtml(JSON.stringify(value, null, 2))}</pre>`; } catch { /**/ }
    }

    return `<div class="fmt-kv-table">${entries.map(([k, v]) => {
      const isLong = typeof v === 'string' && v.length > 80;
      const valHtml = isLong || typeof v === 'object' || Array.isArray(v)
        ? `<div class="fmt-val-block">${renderFormatted(v, depth + 1)}</div>`
        : `<span class="fmt-val-inline">${renderFormatted(v, depth + 1)}</span>`;
      return `<div class="fmt-kv-row"><span class="fmt-key">${escHtml(k)}</span>${valHtml}</div>`;
    }).join('')}</div>`;
  }

  return escHtml(String(value));
}

/**
 * Wraps a field's value in a JSON/Formatted toggle.  The `fieldId` must be
 * unique within the page (used as a DOM id prefix).
 */
function renderFieldWithToggle(value: unknown, fieldId: string): string {
  const jsonHtml = renderObsJson(value);
  const fmtHtml = renderFormatted(value);
  return `
    <div class="field-tabs" data-field="${escHtml(fieldId)}">
      <button class="field-tab active" data-view="json">JSON</button>
      <button class="field-tab" data-view="fmt">Formatted</button>
    </div>
    <div class="field-view" id="${escHtml(fieldId)}-json">${jsonHtml}</div>
    <div class="field-view" id="${escHtml(fieldId)}-fmt" style="display:none">${fmtHtml}</div>`;
}

function buildHtml(sessionId: string, traces: LangfuseTrace[], observations: LangfuseObservation[], langfuseHost = ''): string {
  // Sort newest-first so the most recent message appears at the top (panel index 0).
  const sortedTraces = [...traces].sort((a, b) => {
    const ta = a.timestamp ? new Date(a.timestamp as string).getTime() : 0;
    const tb = b.timestamp ? new Date(b.timestamp as string).getTime() : 0;
    return tb - ta;
  });
  const summaries = buildTraceSummaries(sortedTraces, observations);
  const sessionStart = summaries.length ? Math.min(...summaries.map(s => s.minStart)) : 0;
  const sessionEnd = summaries.length ? Math.max(...summaries.map(s => s.maxEnd)) : 0;
  const sessionMs = sessionEnd > sessionStart ? sessionEnd - sessionStart : 0;

  const traceSectionsHtml = summaries.map((s, ti) => {
    const { trace, observations: traceObs, minStart, totalMs, tokenInput, tokenOutput } = s;
    const windowMs = totalMs || 1;
    const depths = computeDepths(traceObs);

    const obsRowsHtml = traceObs.map((obs, oi) => {
      const indent = (depths.get(obs.id) ?? 0) * 16;
      const dur = durationMs(obs);
      const typeColor = observationTypeColor(obs.type);
      const obsId = `obs-${ti}-${oi}`;
      const detailId = `det-${ti}-${oi}`;
      const modelInfo = obs.model ? `<span class="obs-model">${escHtml(obs.model)}</span>` : '';
      const usageInfo = obs.usage
        ? `<span class="obs-usage">↑${obs.usage.input ?? '?'} ↓${obs.usage.output ?? '?'} tk</span>`
        : '';

      const hasDetail = isDefined(obs.input) || isDefined(obs.output) || isDefined(obs.metadata)
        || isDefined(obs.modelParameters) || !!obs.statusMessage;
      const fldPfx = `fld-${ti}-${oi}`;
      const detailHtml = `
        <div class="obs-detail" id="${detailId}">
          ${isDefined(obs.input) ? `<div class="detail-section"><div class="detail-label">Input</div>${renderFieldWithToggle(obs.input, `${fldPfx}-input`)}</div>` : ''}
          ${isDefined(obs.output) ? `<div class="detail-section"><div class="detail-label">Output</div>${renderFieldWithToggle(obs.output, `${fldPfx}-output`)}</div>` : ''}
          ${isDefined(obs.metadata) ? `<div class="detail-section"><div class="detail-label">Metadata</div>${renderFieldWithToggle(obs.metadata, `${fldPfx}-metadata`)}</div>` : ''}
          ${isDefined(obs.modelParameters) ? `<div class="detail-section"><div class="detail-label">Model params</div>${renderFieldWithToggle(obs.modelParameters, `${fldPfx}-params`)}</div>` : ''}
          ${obs.statusMessage ? `<div class="detail-section"><div class="detail-label">Status</div><pre class="json-block">${escHtml(obs.statusMessage)}</pre></div>` : ''}
          ${!hasDetail ? '<div class="dim no-detail-msg">No input / output recorded for this span.</div>' : ''}
        </div>`;

      return `
        <div class="obs-row" style="--wf-color:${typeColor}" id="${obsId}" data-trace-id="${escHtml(trace.id)}" data-observation-id="${escHtml(obs.id)}">
          <div class="obs-header" style="padding-left:${20 + indent}px" data-detail="${detailId}" data-row="${obsId}">
            <span class="obs-type-badge" style="background:color-mix(in srgb,${typeColor} 18%,transparent);color:${typeColor}">${escHtml(obs.type ?? 'SPAN')}</span>
            <span class="obs-name">${escHtml(obs.name ?? obs.id)}</span>
            ${modelInfo}
            ${usageInfo}
            <span class="obs-time">${fmtMs(dur)}</span>
            <div class="wf-track">${buildWaterfallBar(obs, minStart, windowMs)}</div>
            <button class="obs-export-btn" type="button" title="Send span context to chat" data-trace-id="${escHtml(trace.id)}" data-observation-id="${escHtml(obs.id)}">
              <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="2" width="7" height="8" rx="0.5"/><path d="M2 4.5H1.5a.5.5 0 0 0-.5.5v6a.5.5 0 0 0 .5.5h6a.5.5 0 0 0 .5-.5V10"/></svg>
            </button>
            <span class="obs-toggle-icon${hasDetail ? '' : ' dim'}">▶</span>
          </div>
          ${detailHtml}
        </div>`;
    }).join('');

    const traceUrl = langfuseHost ? `${escHtml(langfuseHost.replace(/\/$/, ''))}/trace/${escHtml(trace.id)}` : '';
    const traceTime = fmtDate(trace.timestamp);
    const totalCostStr = (isDefined(trace.totalCost) && trace.totalCost > 0)
      ? `<span class="trace-cost">$${trace.totalCost.toFixed(5)}</span>`
      : '';
    const usageStr = (tokenInput + tokenOutput) > 0
      ? `<span class="trace-usage">↑${tokenInput.toLocaleString()} ↓${tokenOutput.toLocaleString()} tk</span>`
      : '';

    const ioFldPfx = `tio-${ti}`;
    const traceIoHtml = (isDefined(trace.input) || isDefined(trace.output)) ? `
      <div class="trace-io">
        ${isDefined(trace.input) ? `
          <div class="trace-io-row">
            <span class="trace-io-label">User</span>
            <div class="trace-io-value">${renderFieldWithToggle(trace.input, `${ioFldPfx}-input`)}</div>
          </div>` : ''}
        ${isDefined(trace.output) ? `
          <div class="trace-io-row">
            <span class="trace-io-label">Assistant</span>
            <div class="trace-io-value">${renderFieldWithToggle(trace.output, `${ioFldPfx}-output`)}</div>
          </div>` : ''}
      </div>` : '';

    return `
      <div class="trace-section" data-trace-id="${escHtml(trace.id)}" data-trace-index="${ti}">
        <div class="trace-header" data-body="trace-body-${ti}" data-chevron="trace-chevron-${ti}">
          <span class="trace-chevron" id="trace-chevron-${ti}">▼</span>
          <span class="trace-name">${escHtml(trace.name ?? 'agentic_run')}</span>
          <span class="trace-id-badge" title="Trace ID: ${escHtml(trace.id)}">${escHtml(trace.id)}</span>
          <span class="trace-ts dim">${traceTime}</span>
          ${usageStr}
          ${totalCostStr}
          <span class="trace-dur">${fmtMs(totalMs)}</span>
          <button class="trace-chat-btn" type="button" title="Send trace to chat (via MCP)" data-trace-id="${escHtml(trace.id)}">
            <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 3.5h8a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1H5l-2.5 1.5V4.5a1 1 0 0 1 1-1z"/></svg>
          </button>
          <button class="trace-ctrl-btn" data-expanded="false" title="Expand all spans in this trace">
            <svg class="icon-expand" width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><polyline points="8,1 11,1 11,4"/><polyline points="4,11 1,11 1,8"/><line x1="7" y1="5" x2="11" y2="1"/><line x1="5" y1="7" x2="1" y2="11"/></svg>
            <svg class="icon-collapse" width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" style="display:none"><polyline points="11,4 8,4 8,1"/><polyline points="1,8 4,8 4,11"/><line x1="8" y1="4" x2="11" y2="1"/><line x1="4" y1="8" x2="1" y2="11"/></svg>
          </button>
          ${langfuseHost ? `<a class="trace-ext-link" href="${traceUrl}" title="Open in Langfuse UI" data-href="${traceUrl}">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M5 2H2a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1V7"/><polyline points="8,1 11,1 11,4"/><line x1="11" y1="1" x2="5" y2="7"/></svg>
          </a>` : ''}
        </div>
        <div class="trace-body" id="trace-body-${ti}">
          ${traceIoHtml}
          ${traceObs.length === 0
          ? '<div class="dim" style="padding:10px 16px;font-size:0.85em">No observations recorded for this trace.</div>'
          : obsRowsHtml}
        </div>
      </div>`;
  }).join('');

  const processingMs = summaries.reduce((acc, s) => acc + s.totalMs, 0);
  const sessionTkIn = summaries.reduce((acc, s) => acc + s.tokenInput, 0);
  const sessionTkOut = summaries.reduce((acc, s) => acc + s.tokenOutput, 0);
  const showSession = sessionMs > 0 && sessionMs > processingMs * 1.5;
  const headerStats = `
    <span class="stat">${traces.length} trace${traces.length !== 1 ? 's' : ''}</span>
    ${observations.length > 0 ? `<span class="stat">${observations.length} span${observations.length !== 1 ? 's' : ''}</span>` : ''}
    ${processingMs > 0 ? `<span class="stat" title="Sum of individual trace durations">${fmtMs(processingMs)} processing</span>` : ''}
    ${(sessionTkIn + sessionTkOut) > 0 ? `<span class="stat" title="Total tokens across all traces in this session">↑${sessionTkIn.toLocaleString()} ↓${sessionTkOut.toLocaleString()} tk</span>` : ''}
    ${showSession ? `<span class="stat dim-stat" title="Wall-clock time from first to last span across all traces">${fmtMs(sessionMs)} session</span>` : ''}
    `;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
<style>
  *, *::before, *::after { box-sizing: border-box; }
  html, body {
    height: 100%;
    margin: 0;
    padding: 0;
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    color: var(--vscode-foreground);
    background: var(--vscode-editor-background);
  }
  body { display: flex; flex-direction: column; overflow: hidden; }

  /* ── Header ── */
  #header {
    padding: 10px 16px 8px;
    border-bottom: 2px solid var(--vscode-button-background);
    flex-shrink: 0;
  }
  #header-top {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
  }
  #header h1 {
    margin: 0;
    font-size: 1.05em;
    font-weight: 700;
    color: var(--vscode-button-background);
    letter-spacing: 0.15px;
    flex-shrink: 0;
  }
  .session-id {
    font-family: var(--vscode-editor-font-family);
    font-size: 0.8em;
    color: var(--vscode-descriptionForeground);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
    min-width: 0;
  }
  .stats-row {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    margin-top: 4px;
  }
  .stat {
    font-size: 0.78em;
    padding: 2px 8px;
    border-radius: 10px;
    background: color-mix(in srgb, var(--vscode-button-background) 15%, transparent);
    color: var(--vscode-foreground);
    opacity: 0.85;
  }
  .trace-ctrl-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    padding: 0;
    border-radius: 4px;
    border: 1px solid var(--vscode-editorWidget-border, rgba(255,255,255,0.15));
    background: transparent;
    color: var(--vscode-descriptionForeground);
    cursor: pointer;
    flex-shrink: 0;
  }
  .trace-ctrl-btn:hover {
    background: var(--vscode-list-hoverBackground, rgba(255,255,255,0.07));
    color: var(--vscode-foreground);
  }
  .trace-chat-btn,
  #btn-send-session-chat {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    padding: 0;
    border-radius: 4px;
    border: 1px solid var(--vscode-editorWidget-border, rgba(255,255,255,0.15));
    background: transparent;
    color: var(--vscode-descriptionForeground);
    cursor: pointer;
    flex-shrink: 0;
  }
  .trace-chat-btn:hover,
  #btn-send-session-chat:hover {
    background: var(--vscode-list-hoverBackground, rgba(255,255,255,0.07));
    color: var(--vscode-foreground);
  }
  .trace-ext-link {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    padding: 0;
    border-radius: 4px;
    border: 1px solid var(--vscode-editorWidget-border, rgba(255,255,255,0.15));
    background: transparent;
    color: var(--vscode-descriptionForeground);
    cursor: pointer;
    flex-shrink: 0;
    text-decoration: none;
  }
  .trace-ext-link:hover {
    background: var(--vscode-list-hoverBackground, rgba(255,255,255,0.07));
    color: var(--vscode-foreground);
  }
  .obs-export-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    padding: 0;
    border-radius: 4px;
    border: 1px solid var(--vscode-editorWidget-border, rgba(255,255,255,0.15));
    background: transparent;
    color: var(--vscode-descriptionForeground);
    cursor: pointer;
    flex-shrink: 0;
    opacity: 0;
    transition: opacity 0.12s;
  }
  .obs-row:hover .obs-export-btn,
  .obs-row.expanded .obs-export-btn,
  .obs-export-btn.exporting {
    opacity: 1;
  }
  .obs-export-btn:hover {
    background: var(--vscode-list-hoverBackground, rgba(255,255,255,0.07));
    color: var(--vscode-foreground);
  }
  .obs-export-btn.exporting {
    pointer-events: none;
    opacity: 0.5;
  }

  /* ── Scrollable content ── */
  #content {
    flex: 1;
    overflow-y: auto;
    padding: 0 0 24px 0;
    scrollbar-width: thin;
    scrollbar-color: var(--vscode-scrollbarSlider-background, rgba(128,128,128,0.3)) transparent;
  }

  /* ── Trace section ── */
  .trace-section {
    border-bottom: 1px solid var(--vscode-editorWidget-border, rgba(255,255,255,0.06));
  }
  .trace-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 16px;
    cursor: pointer;
    user-select: none;
    background: color-mix(in srgb, var(--vscode-editor-background) 100%, transparent);
    flex-wrap: wrap;
  }
  .trace-header:hover { background: var(--vscode-list-hoverBackground, rgba(255,255,255,0.04)); }
  .trace-chevron { font-size: 0.75em; color: var(--vscode-descriptionForeground); width: 12px; flex-shrink: 0; }
  .trace-name { font-weight: 600; font-size: 0.95em; flex-shrink: 0; }
  .trace-id-badge {
    font-family: var(--vscode-editor-font-family);
    font-size: 0.75em;
    padding: 1px 6px;
    border-radius: 4px;
    background: color-mix(in srgb, var(--vscode-descriptionForeground) 12%, transparent);
    color: var(--vscode-descriptionForeground);
    flex-shrink: 0;
    letter-spacing: 0.2px;
    cursor: default;
  }
  .trace-ts { font-size: 0.8em; color: var(--vscode-descriptionForeground); flex-shrink: 0; }
  .trace-dur { margin-left: auto; font-weight: 600; font-size: 0.88em; color: var(--vscode-button-background); flex-shrink: 0; }
  .trace-cost { font-size: 0.78em; color: var(--vscode-terminal-ansiYellow); flex-shrink: 0; }
  .trace-usage { font-size: 0.78em; color: var(--vscode-descriptionForeground); flex-shrink: 0; }
  .dim-stat { opacity: 0.6; }
  .trace-body { border-top: 1px solid var(--vscode-editorWidget-border, rgba(255,255,255,0.06)); }

  /* ── Trace-level I/O preview ── */
  .trace-io {
    display: flex;
    flex-direction: column;
    gap: 0;
    border-bottom: 1px solid var(--vscode-editorWidget-border, rgba(255,255,255,0.08));
    background: color-mix(in srgb, var(--vscode-editor-background) 60%, var(--vscode-editorWidget-background, transparent) 40%);
  }
  .trace-io-row {
    display: flex;
    gap: 10px;
    padding: 8px 16px;
    border-bottom: 1px solid var(--vscode-editorWidget-border, rgba(255,255,255,0.05));
    align-items: flex-start;
  }
  .trace-io-row:last-child { border-bottom: none; }
  .trace-io-label {
    font-size: 0.7em;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--vscode-descriptionForeground);
    padding-top: 3px;
    width: 62px;
    flex-shrink: 0;
  }
  .trace-io-value {
    flex: 1;
    min-width: 0;
    font-size: 0.88em;
  }
  .trace-io-value .field-tabs { margin-bottom: 4px; }
  .trace-io-value .fmt-text {
    white-space: pre-wrap;
    word-break: break-word;
    max-height: 120px;
    overflow-y: auto;
  }
  .trace-io-value .json-block { max-height: 120px; }

  /* ── Observation row ── */
  .obs-row {
    border-bottom: 1px solid var(--vscode-editorWidget-border, rgba(255,255,255,0.04));
  }
  .obs-row.expanded > .obs-header { background: color-mix(in srgb, var(--wf-color) 8%, transparent); }
  .obs-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 7px 16px 7px 20px;
    cursor: pointer;
    user-select: none;
    flex-wrap: nowrap;
    min-width: 0;
  }
  .obs-header:hover { background: var(--vscode-list-hoverBackground, rgba(255,255,255,0.04)); }
  .obs-type-badge {
    font-size: 0.68em;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.4px;
    padding: 2px 6px;
    border-radius: 8px;
    flex-shrink: 0;
  }
  .obs-name {
    font-size: 0.9em;
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
    min-width: 0;
  }
  .obs-model {
    font-size: 0.78em;
    color: var(--vscode-descriptionForeground);
    font-family: var(--vscode-editor-font-family);
    white-space: nowrap;
    flex-shrink: 0;
  }
  .obs-usage {
    font-size: 0.75em;
    color: var(--vscode-terminal-ansiCyan);
    white-space: nowrap;
    flex-shrink: 0;
  }
  .obs-time {
    font-size: 0.8em;
    font-weight: 600;
    color: var(--wf-color);
    white-space: nowrap;
    flex-shrink: 0;
    min-width: 40px;
    text-align: right;
  }
  .obs-toggle-icon {
    font-size: 0.65em;
    color: var(--vscode-descriptionForeground);
    flex-shrink: 0;
    transition: transform 0.15s;
  }
  .obs-row.expanded .obs-toggle-icon { transform: rotate(90deg); }

  /* ── Waterfall track ── */
  .wf-track {
    width: 120px;
    flex-shrink: 0;
    height: 8px;
    background: color-mix(in srgb, var(--vscode-editorWidget-border, rgba(255,255,255,0.1)) 60%, transparent);
    border-radius: 4px;
    position: relative;
    overflow: hidden;
  }
  .wf-bar {
    position: absolute;
    top: 0;
    height: 100%;
    border-radius: 4px;
    opacity: 0.75;
    min-width: 4px;
  }

  /* ── Detail panel ── */
  .obs-detail {
    display: none;
  }
  .obs-detail.open {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 10px 20px 14px 20px;
    background: color-mix(in srgb, var(--vscode-editorWidget-background, var(--vscode-editor-background)) 70%, transparent);
    border-top: 1px solid var(--vscode-editorWidget-border, rgba(255,255,255,0.05));
  }
  .no-detail-msg {
    font-size: 0.82em;
    font-style: italic;
  }
  .detail-section { display: flex; flex-direction: column; gap: 4px; }
  .detail-label {
    font-size: 0.72em;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--vscode-descriptionForeground);
  }
  .json-block {
    margin: 0;
    padding: 8px 10px;
    background: var(--vscode-textCodeBlock-background, rgba(0,0,0,0.2));
    border-radius: 5px;
    font-family: var(--vscode-editor-font-family);
    font-size: 0.82em;
    overflow-x: auto;
    white-space: pre;
    word-break: normal;
    max-height: 300px;
    overflow-y: auto;
    line-height: 1.5;
    color: var(--vscode-foreground);
    border: 1px solid var(--vscode-editorWidget-border, rgba(255,255,255,0.08));
  }
  .json-block.fmt-nested { max-height: 200px; font-size: 0.9em; }

  /* ── Field JSON/Formatted toggle ── */
  .field-tabs {
    display: flex;
    gap: 2px;
    margin-bottom: 4px;
  }
  .field-tab {
    font-size: 0.7em;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.3px;
    padding: 2px 8px;
    border-radius: 4px;
    border: 1px solid var(--vscode-editorWidget-border, rgba(255,255,255,0.15));
    background: transparent;
    color: var(--vscode-descriptionForeground);
    cursor: pointer;
    line-height: 1.6;
  }
  .field-tab:hover { background: var(--vscode-list-hoverBackground, rgba(255,255,255,0.05)); }
  .field-tab.active {
    background: color-mix(in srgb, var(--vscode-button-background) 20%, transparent);
    color: var(--vscode-button-background);
    border-color: color-mix(in srgb, var(--vscode-button-background) 50%, transparent);
  }

  /* ── Formatted view ── */
  .fmt-text {
    margin: 0;
    white-space: pre-wrap;
    word-break: break-word;
    font-size: 0.88em;
    line-height: 1.55;
    color: var(--vscode-foreground);
  }
  .fmt-msg {
    display: flex;
    flex-direction: column;
    gap: 3px;
    padding: 6px 10px;
    border-radius: 6px;
    border-left: 3px solid transparent;
    margin-bottom: 6px;
    background: var(--vscode-textCodeBlock-background, rgba(0,0,0,0.15));
  }
  .fmt-msg-system { border-left-color: var(--vscode-terminal-ansiYellow, #e5c07b); }
  .fmt-msg-user   { border-left-color: var(--vscode-terminal-ansiBlue, #61afef); }
  .fmt-msg-assistant, .fmt-msg-model { border-left-color: var(--vscode-terminal-ansiGreen, #98c379); }
  .fmt-msg-tool   { border-left-color: var(--vscode-terminal-ansiMagenta, #c678dd); }
  .fmt-msg-role {
    font-size: 0.68em;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--vscode-descriptionForeground);
    margin-bottom: 2px;
  }
  .fmt-msg-body { font-size: 0.88em; line-height: 1.5; }
  .fmt-primitive { font-family: var(--vscode-editor-font-family); font-size: 0.85em; }
  .fmt-kv-table { display: flex; flex-direction: column; gap: 4px; }
  .fmt-kv-row {
    display: flex;
    align-items: baseline;
    gap: 8px;
    flex-wrap: wrap;
    font-size: 0.85em;
  }
  .fmt-key {
    font-family: var(--vscode-editor-font-family);
    font-size: 0.88em;
    color: var(--vscode-descriptionForeground);
    white-space: nowrap;
    flex-shrink: 0;
  }
  .fmt-key::after { content: ':'; }
  .fmt-val-inline { color: var(--vscode-foreground); }
  .fmt-val-block { width: 100%; padding-left: 10px; }
  .fmt-meta-row {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    margin-bottom: 8px;
    font-size: 0.8em;
    color: var(--vscode-descriptionForeground);
  }
  .fmt-meta-kv .fmt-key::after { content: ':'; }
  .fmt-list { display: flex; flex-direction: column; gap: 4px; }
  .fmt-list-item { display: flex; align-items: baseline; gap: 6px; font-size: 0.85em; }
  .fmt-list-idx {
    font-family: var(--vscode-editor-font-family);
    font-size: 0.8em;
    color: var(--vscode-descriptionForeground);
    flex-shrink: 0;
  }
  .fmt-list-val { flex: 1; min-width: 0; }

  .dim { color: var(--vscode-descriptionForeground); }
  em.dim { font-style: normal; }

  /* ── Refresh button ── */
  #btn-refresh {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    padding: 0;
    margin-left: auto;
    border-radius: 4px;
    border: 1px solid var(--vscode-editorWidget-border, rgba(255,255,255,0.15));
    background: transparent;
    color: var(--vscode-descriptionForeground);
    cursor: pointer;
    flex-shrink: 0;
    font-size: 0.95em;
    line-height: 1;
  }
  #btn-refresh:hover { background: var(--vscode-list-hoverBackground, rgba(255,255,255,0.07)); color: var(--vscode-foreground); }
  #btn-refresh.spinning { animation: spin 0.7s linear infinite; pointer-events: none; opacity: 0.6; }
  @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }

  /* ── Trace highlighted (focus flash) ── */
  @keyframes traceFlash {
    0%   { background: color-mix(in srgb, var(--vscode-button-background) 18%, transparent); }
    100% { background: transparent; }
  }
  .trace-section.flash { animation: traceFlash 1.2s ease-out; }

  /* ── Empty state ── */
  #empty-state {
    padding: 48px 24px;
    text-align: center;
    color: var(--vscode-descriptionForeground);
    font-size: 0.9em;
    line-height: 1.7;
  }
  #empty-state .icon { font-size: 2.5em; margin-bottom: 12px; }
</style>
</head>
<body>
  <div id="header">
    <div id="header-top">
      <h1>⎆ Langfuse Trace</h1>
      <span class="session-id" title="Session / stream ID: ${escHtml(sessionId)}">${escHtml(sessionId)}</span>
      <button id="btn-send-session-chat" type="button" title="Send session to chat (via MCP)">
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 3.5h8a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1H5l-2.5 1.5V4.5a1 1 0 0 1 1-1z"/></svg>
      </button>
      <button id="btn-refresh" title="Refresh traces from Langfuse">↺</button>
    </div>
    <div class="stats-row">${headerStats}</div>
  </div>

  <div id="content">
    ${traces.length === 0
    ? `<div id="empty-state">
        <div class="icon">⎆</div>
        <div>No traces found for this session.</div>
        <div style="margin-top:6px;font-size:0.85em">Ensure the local Langfuse instance is running and the trace has been flushed.</div>
      </div>`
    : traceSectionsHtml}
  </div>

  <script>
    var vscode = acquireVsCodeApi();
    var lastInteractedObservationId = null;
    var lastInteractedTraceId = null;
    var focusedTraceIndex = null;
    var focusedTraceId = null;

    function reportUiState() {
      var expanded = [];
      document.querySelectorAll('.obs-row.expanded').forEach(function(row) {
        var id = row.getAttribute('data-observation-id');
        if (id) { expanded.push(id); }
      });
      vscode.postMessage({
        command: 'uiState',
        focusedTraceIndex: focusedTraceIndex,
        focusedTraceId: focusedTraceId,
        expandedObservationIds: expanded,
        lastInteractedObservationId: lastInteractedObservationId,
        lastInteractedTraceId: lastInteractedTraceId,
      });
    }

    // ── Export span for AI ────────────────────────────────────────────────────
    document.addEventListener('click', function(ev) {
      var el = ev.target;
      while (el && el !== document.body) {
        if (el.classList && el.classList.contains('obs-export-btn')) {
          ev.preventDefault();
          ev.stopPropagation();
          var traceId = el.getAttribute('data-trace-id');
          var observationId = el.getAttribute('data-observation-id');
          if (traceId && observationId) {
            el.classList.add('exporting');
            el.setAttribute('data-exporting-id', observationId);
            vscode.postMessage({ command: 'exportSpan', traceId: traceId, observationId: observationId });
          }
          return;
        }
        if (el.classList && el.classList.contains('trace-chat-btn')) {
          ev.preventDefault();
          ev.stopPropagation();
          var tId = el.getAttribute('data-trace-id');
          if (tId) {
            el.classList.add('exporting');
            vscode.postMessage({ command: 'exportTrace', traceId: tId });
          }
          return;
        }
        el = el.parentElement;
      }
    }, true);

    // ── External Langfuse links ───────────────────────────────────────────────
    document.addEventListener('click', function(ev) {
      var el = ev.target;
      while (el && el !== document.body) {
        if (el.classList && el.classList.contains('trace-ext-link')) {
          ev.preventDefault();
          ev.stopPropagation();
          var href = el.getAttribute('data-href');
          if (href) { vscode.postMessage({ command: 'openExternal', url: href }); }
          return;
        }
        el = el.parentElement;
      }
    }, true);

    // ── Send session to chat (MCP pointer) ────────────────────────────────────
    document.getElementById('btn-send-session-chat').addEventListener('click', function() {
      vscode.postMessage({ command: 'exportSession' });
    });

    // ── Refresh button ────────────────────────────────────────────────────────
    document.getElementById('btn-refresh').addEventListener('click', function() {
      this.classList.add('spinning');
      vscode.postMessage({ command: 'refresh' });
    });

    // ── Messages from extension host ─────────────────────────────────────────
    window.addEventListener('message', function(event) {
      var msg = event.data;
      if (msg.command === 'refreshDone') {
        var btn = document.getElementById('btn-refresh');
        if (btn) { btn.classList.remove('spinning'); }
      }
      if (msg.command === 'exportDone') {
        document.querySelectorAll('.obs-export-btn.exporting, .trace-chat-btn.exporting').forEach(function(b) {
          b.classList.remove('exporting');
          b.removeAttribute('data-exporting-id');
        });
      }
      if (msg.command === 'focusTrace') {
        var idx = typeof msg.index === 'number' ? msg.index : 0;
        var sections = document.querySelectorAll('.trace-section');
        var target = sections[idx];
        if (!target) { return; }
        // Ensure trace body is visible
        var body = target.querySelector('.trace-body');
        var chev = target.querySelector('.trace-chevron');
        if (body) { body.style.display = ''; }
        if (chev) { chev.textContent = '▼'; }
        // Scroll smoothly
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        // Flash highlight
        target.classList.remove('flash');
        void target.offsetWidth; // reflow to restart animation
        target.classList.add('flash');
        setTimeout(function() { target.classList.remove('flash'); }, 1300);
        focusedTraceIndex = idx;
        focusedTraceId = target.getAttribute('data-trace-id');
        reportUiState();
      }
    });

    document.addEventListener('click', function(e) {
      var target = e.target;

      // ── Per-trace expand / collapse toggle ───────────────────────────────
      var btn = target;
      while (btn && !btn.classList.contains('trace-ctrl-btn')) { btn = btn.parentElement; }
      if (btn && btn.classList.contains('trace-ctrl-btn')) {
        var isExpanded = btn.getAttribute('data-expanded') === 'true';
        var section = btn;
        while (section && !section.classList.contains('trace-section')) { section = section.parentElement; }
        if (section) {
          if (!isExpanded) {
            section.querySelectorAll('.obs-detail').forEach(function(d) { d.classList.add('open'); });
            section.querySelectorAll('.obs-row').forEach(function(r) { r.classList.add('expanded'); });
            var tbody = section.querySelector('.trace-body');
            var tchev = section.querySelector('.trace-chevron');
            if (tbody) { tbody.style.display = ''; }
            if (tchev) { tchev.textContent = '▼'; }
          } else {
            section.querySelectorAll('.obs-detail').forEach(function(d) { d.classList.remove('open'); });
            section.querySelectorAll('.obs-row').forEach(function(r) { r.classList.remove('expanded'); });
          }
          btn.setAttribute('data-expanded', isExpanded ? 'false' : 'true');
          btn.querySelector('.icon-expand').style.display  = isExpanded ? '' : 'none';
          btn.querySelector('.icon-collapse').style.display = isExpanded ? 'none' : '';
          btn.title = isExpanded ? 'Expand all spans in this trace' : 'Collapse all spans in this trace';
          focusedTraceIndex = section ? parseInt(section.getAttribute('data-trace-index') || '', 10) : null;
          focusedTraceId = section ? section.getAttribute('data-trace-id') : null;
          reportUiState();
        }
        e.stopPropagation();
        return;
      }

      // ── Field tab toggle (JSON / Formatted) ──────────────────────────────
      if (target.classList && target.classList.contains('field-tab')) {
        var view = target.getAttribute('data-view');
        var bar = target.closest ? target.closest('.field-tabs') : (function() {
          var n = target; while (n && !n.classList.contains('field-tabs')) { n = n.parentElement; } return n;
        })();
        if (!bar) { return; }
        var fieldId = bar.getAttribute('data-field');
        bar.querySelectorAll('.field-tab').forEach(function(btn) { btn.classList.remove('active'); });
        target.classList.add('active');
        var jsonEl = document.getElementById(fieldId + '-json');
        var fmtEl  = document.getElementById(fieldId + '-fmt');
        if (jsonEl) { jsonEl.style.display = view === 'json' ? '' : 'none'; }
        if (fmtEl)  { fmtEl.style.display  = view === 'fmt'  ? '' : 'none'; }
        e.stopPropagation();
        return;
      }

      // ── Walk up to find .obs-header or .trace-header ─────────────────────
      var header = target;
      while (header && header !== document.body) {
        if (header.classList && header.classList.contains('obs-header')) {
          var detailId = header.getAttribute('data-detail');
          var rowId = header.getAttribute('data-row');
          var detail = document.getElementById(detailId);
          var row = document.getElementById(rowId);
          if (!detail) { return; }
          var isOpen = detail.classList.contains('open');
          detail.classList.toggle('open', !isOpen);
          if (row) {
            row.classList.toggle('expanded', !isOpen);
            lastInteractedObservationId = row.getAttribute('data-observation-id');
            lastInteractedTraceId = row.getAttribute('data-trace-id');
          }
          reportUiState();
          return;
        }
        if (header.classList && header.classList.contains('trace-header')) {
          var bodyId = header.getAttribute('data-body');
          var chevronId = header.getAttribute('data-chevron');
          var body = document.getElementById(bodyId);
          var chevron = document.getElementById(chevronId);
          if (!body) { return; }
          var isHidden = body.style.display === 'none';
          body.style.display = isHidden ? '' : 'none';
          if (chevron) { chevron.textContent = isHidden ? '▼' : '▶'; }
          var section = header;
          while (section && !section.classList.contains('trace-section')) { section = section.parentElement; }
          if (section) {
            focusedTraceIndex = parseInt(section.getAttribute('data-trace-index') || '', 10);
            focusedTraceId = section.getAttribute('data-trace-id');
            reportUiState();
          }
          return;
        }
        header = header.parentElement;
      }
    });
  </script>
</body>
</html>`;
}

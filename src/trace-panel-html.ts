import { randomBytes } from 'node:crypto';
import type { LangfuseObservation, LangfuseTrace } from './langfuse-client.js';
import {
  type TraceSummary,
  type TreeGuideCell,
  isDefined,
  isErrorObservation,
  fmtDate,
  fmtMs,
  fmtTokens,
  durationMs,
  observationTypeColor,
  computeTreeGuides,
  computeChildrenByParent,
  computeDepths,
  computeTimeTicks,
  resolveDisplayParents,
  buildTraceSummaries,
  sortTracesNewestFirst,
} from './trace-utils.js';
import {
  aggregateUsage,
  buildSearchText,
  buildSessionUrl,
  computeTraceCost,
  countErrorObservations,
  extractPreviewText,
  fmtTick,
  observationGroup,
} from './trace-insights.js';
import { computeUsageBreakdown } from './usage-breakdown.js';
import {
  escHtml,
  fmtCost,
  hasUsageDetail,
  renderFieldWithToggle,
  renderIoSection,
  renderSpanDetailMeta,
  renderTraceMetaBar,
  renderUsageSection,
  resolveObservationCost,
  resolveTtftMs,
  summarizeUsage,
} from './span-detail-render.js';
import { PANEL_STYLES } from './trace-panel-style.js';
import { PANEL_SCRIPT } from './trace-panel-script.js';

/** Renders folder-style tree guide columns (│ ├ └) for a span row. */
function renderTreeGuides(cells: TreeGuideCell[]): string {
  if (cells.length === 0) { return ''; }
  const cols = cells.map(cell => `<span class="tg tg-${cell}" aria-hidden="true"></span>`).join('');
  return `<span class="tree-guides">${cols}</span>`;
}

/** Renders a compact type icon with the full type label as a tooltip. */
function renderObsTypeIcon(type: string | undefined, typeColor: string): string {
  const label = (type ?? 'SPAN').toUpperCase();
  const svg = (() => {
    switch (label) {
      case 'GENERATION':
        return '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M6 1.2l1.1 2.6 2.8.3-2.1 1.9.6 2.8L6 7.4 3.6 8.8l.6-2.8-2.1-1.9 2.8-.3L6 1.2z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>';
      case 'EVENT':
        return '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true"><circle cx="6" cy="6" r="3.2" stroke="currentColor" stroke-width="1.4"/><circle cx="6" cy="6" r="1" fill="currentColor"/></svg>';
      case 'AGENT':
        return '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true"><circle cx="6" cy="4" r="2.1" stroke="currentColor" stroke-width="1.3"/><path d="M2.5 10c.6-2 2-3 3.5-3s2.9 1 3.5 3" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>';
      case 'TOOL':
        return '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M7.8 2.2a2.4 2.4 0 0 0-3.2 3.2L2 8l2 2 2.6-2.6a2.4 2.4 0 0 0 3.2-3.2L8.2 5.2 7.8 2.2z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>';
      case 'CHAIN':
        return '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M5 7.2a2.4 2.4 0 0 1 0-3.4l1.2-1.2a2.4 2.4 0 1 1 3.4 3.4L8.8 6.8M7 4.8a2.4 2.4 0 0 1 0 3.4L5.8 9.4a2.4 2.4 0 1 1-3.4-3.4L3.2 5.2" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>';
      case 'RETRIEVER':
        return '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true"><circle cx="5.2" cy="5.2" r="3.1" stroke="currentColor" stroke-width="1.3"/><path d="M7.5 7.5L10.2 10.2" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>';
      case 'SPAN':
      default:
        return '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true"><rect x="2" y="3.2" width="8" height="5.6" rx="1.2" stroke="currentColor" stroke-width="1.3"/></svg>';
    }
  })();

  return `<span class="obs-type-icon tip" data-tip="${escHtml(label)}" aria-label="${escHtml(label)}" style="color:${typeColor};background:color-mix(in srgb,${typeColor} 16%,transparent)">${svg}</span>`;
}

/** Renders the tree expand/collapse control, or a spacer when the span has no children. */
function renderTreeToggle(hasChildren: boolean): string {
  if (!hasChildren) {
    return '<span class="obs-tree-toggle-spacer" aria-hidden="true"></span>';
  }
  return `<button class="obs-tree-toggle" type="button" title="Collapse children" aria-expanded="true" aria-label="Collapse children"><span class="obs-tree-chevron">▼</span></button>`;
}

const CHEVRON_DOWN = '<svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m2 3.5 3 3 3-3"/></svg>';
const ICON_CHAT = '<svg width="13" height="13" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" aria-hidden="true"><path d="M2 2.5h8a1 1 0 0 1 1 1v4.5a1 1 0 0 1-1 1H5l-2.5 2V3.5a1 1 0 0 1 1-1z"/></svg>';
const ICON_EXTERNAL = '<svg width="13" height="13" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" aria-hidden="true"><path d="M5 2H2.5a1 1 0 0 0-1 1v6.5a1 1 0 0 0 1 1H9a1 1 0 0 0 1-1V7"/><path d="M7.5 1.5h3v3M10.5 1.5 5.5 6.5"/></svg>';
const ICON_REFRESH = '<svg width="13" height="13" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" aria-hidden="true"><path d="M10 6a4 4 0 1 1-1.2-2.85"/><path d="M9.5 1.5v2.2H7.3"/></svg>';
const ICON_COPY = '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true"><rect x="3.5" y="3.5" width="6.5" height="6.5" rx="1"/><path d="M8 3.5V2.5a1 1 0 0 0-1-1H2.5a1 1 0 0 0-1 1V7a1 1 0 0 0 1 1h1"/></svg>';
const ICON_SEARCH = '<svg width="13" height="13" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" aria-hidden="true"><circle cx="5.2" cy="5.2" r="3.4"/><path d="m7.8 7.8 2.6 2.6"/></svg>';
const ICON_ALERT = '<svg width="14" height="14" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" aria-hidden="true"><circle cx="6" cy="6" r="4.6"/><path d="M6 3.6v2.8M6 8.3v.1"/></svg>';
const ICON_EXPAND_ALL = '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="8,1 11,1 11,4"/><polyline points="4,11 1,11 1,8"/><line x1="7" y1="5" x2="11" y2="1"/><line x1="5" y1="7" x2="1" y2="11"/></svg>';
const LOGO = '<svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true"><rect x="1.5" y="3" width="9" height="3" rx="1.5" fill="var(--vscode-terminal-ansiBlue, #61afef)"/><rect x="5" y="7.5" width="11.5" height="3" rx="1.5" fill="var(--vscode-terminal-ansiGreen, #98c379)"/><rect x="3" y="12" width="6" height="3" rx="1.5" fill="var(--vscode-terminal-ansiMagenta, #c678dd)"/></svg>';

/** Renders the per-trace timeline: a column of faint grid lines plus the span bar. */
function buildWaterfallBar(obs: LangfuseObservation, windowStart: number, windowMs: number): string {
  if (!obs.startTime || windowMs <= 0) {
    return '<span class="wf-bar" style="left:0%;width:100%;background:var(--wf-color)"></span>';
  }
  const start = new Date(obs.startTime).getTime();
  const dur = durationMs(obs) ?? 0;
  const left = Math.max(0, Math.min(99, ((start - windowStart) / windowMs) * 100));
  const width = Math.max(0.6, Math.min(100 - left, (dur / windowMs) * 100));
  const ttft = resolveTtftMs(obs);
  let background = 'var(--wf-color)';
  if (isDefined(ttft) && dur > 0 && ttft > 0 && ttft < dur) {
    const split = ((ttft / dur) * 100).toFixed(1);
    background = `linear-gradient(90deg,color-mix(in srgb,var(--wf-color) 40%,transparent) 0 ${split}%,var(--wf-color) ${split}% 100%)`;
  }
  return `<span class="wf-bar" style="left:${left.toFixed(2)}%;width:${width.toFixed(2)}%;background:${background}"></span>`;
}

/** Short tooltip for a timeline bar: offset, duration and first-token delay. */
function waterfallTip(obs: LangfuseObservation, windowStart: number): string {
  const parts = [obs.name ?? obs.id];
  if (obs.startTime) { parts.push(`starts +${fmtMs(Math.max(0, new Date(obs.startTime).getTime() - windowStart))}`); }
  parts.push(fmtMs(durationMs(obs)));
  const ttft = resolveTtftMs(obs);
  if (isDefined(ttft)) { parts.push(`first token after ${fmtMs(ttft)}`); }
  return parts.join(' · ');
}

function renderErrorCallout(message: string): string {
  return `<div class="obs-error" role="alert">${ICON_ALERT}<code>${escHtml(message)}</code></div>`;
}

function renderMoreSection(label: string, value: unknown, fieldId: string): string {
  const count = value !== null && typeof value === 'object' ? Object.keys(value as object).length : 0;
  const hint = count > 0 ? ` <span class="muted">· ${count} key${count === 1 ? '' : 's'}</span>` : '';
  return `<details class="detail-more"><summary>${escHtml(label)}${hint}</summary>${renderFieldWithToggle(value, fieldId)}</details>`;
}

/** Ancestor names for the detail subtitle, e.g. "platform_run › invoke_agent". */
function buildBreadcrumb(
  obs: LangfuseObservation,
  byId: Map<string, LangfuseObservation>,
  parents: Map<string, string | null>,
): string {
  const names: string[] = [];
  const seen = new Set<string>();
  let parentId = parents.get(obs.id) ?? null;
  while (parentId && !seen.has(parentId)) {
    seen.add(parentId);
    const parent = byId.get(parentId);
    if (!parent) { break; }
    names.unshift(parent.name ?? parent.id);
    parentId = parents.get(parentId) ?? null;
  }
  const trimmed = names.length > 3 ? ['…', ...names.slice(-3)] : names;
  return trimmed.join(' › ');
}

interface ObsRenderContext {
  trace: LangfuseTrace;
  traceIndex: number;
  minStart: number;
  windowMs: number;
  ticks: number[];
  byId: Map<string, LangfuseObservation>;
  parents: Map<string, string | null>;
}

function renderObservationRow(
  obs: LangfuseObservation,
  oi: number,
  ctx: ObsRenderContext,
  guideCells: TreeGuideCell[],
  childCount: number,
  depth: number,
): string {
  const { trace, traceIndex: ti, minStart, windowMs, ticks } = ctx;
  const hasChildren = childCount > 0;
  const isError = isErrorObservation(obs);
  const dur = durationMs(obs);
  const typeColor = observationTypeColor(obs.type);
  const rowColor = isError ? 'var(--danger)' : typeColor;
  const obsId = `obs-${ti}-${oi}`;
  const detailId = `det-${ti}-${oi}`;
  const parentId = ctx.parents.get(obs.id) ?? '';
  const name = obs.name ?? obs.id;

  const level = obs.level ? String(obs.level).toUpperCase() : '';
  const levelInfo = level && level !== 'DEFAULT'
    ? `<span class="obs-level obs-level-${escHtml(level.toLowerCase())}">${escHtml(level)}</span>`
    : '';
  const modelInfo = obs.model
    ? `<span class="obs-model" title="${escHtml(obs.model)}">${escHtml(obs.model.split('/').pop() ?? obs.model)}</span>`
    : '';

  const usage = computeUsageBreakdown(obs);
  const tokensHtml = hasUsageDetail(usage)
    ? `<span class="obs-tok" title="${escHtml(summarizeUsage(usage))}">${usage.inputParts.some(p => p.key === 'cached') ? '<span class="cache-dot"></span>' : ''}${fmtTokens(usage.input)} → ${fmtTokens(usage.output)}</span>`
    : '<span class="obs-tok"></span>';
  const costLabel = fmtCost(resolveObservationCost(obs));
  const costHtml = `<span class="obs-cost-badge">${costLabel ? escHtml(costLabel) : ''}</span>`;

  const hasDetail = isDefined(obs.input) || isDefined(obs.output) || isDefined(obs.metadata)
    || isDefined(obs.modelParameters) || !!obs.statusMessage || hasUsageDetail(usage) || isError;
  const fldPfx = `fld-${ti}-${oi}`;
  const usageHtml = renderUsageSection(obs);
  const breadcrumb = buildBreadcrumb(obs, ctx.byId, ctx.parents);
  const subtitle = [String(obs.type ?? 'SPAN').toLowerCase(), breadcrumb].filter(Boolean).join(' · ');

  const ioParts: string[] = [];
  if (isDefined(obs.input)) { ioParts.push(renderIoSection(obs.input, `${fldPfx}-input`, 'input')); }
  if (isDefined(obs.output)) {
    ioParts.push(renderIoSection(obs.output, `${fldPfx}-output`, 'output'));
  } else if (isError && isDefined(obs.input)) {
    ioParts.push('<div class="io-empty">No output recorded — span ended with an error.</div>');
  }

  const detailHtml = `
    <div class="obs-detail" id="${detailId}">
      <div class="detail-head">
        <span class="detail-title">${escHtml(name)}</span>
        <span class="detail-sub">${escHtml(subtitle)}</span>
        <div class="detail-actions">
          <button class="text-btn primary detail-export-btn" type="button" data-trace-id="${escHtml(trace.id)}" data-observation-id="${escHtml(obs.id)}">${ICON_CHAT}<span class="btn-label">Send span to chat</span></button>
        </div>
      </div>
      ${renderSpanDetailMeta(obs, trace.scores, { traceStart: minStart, traceMs: windowMs, usageSection: Boolean(usageHtml) })}
      ${obs.statusMessage ? (isError ? renderErrorCallout(obs.statusMessage) : `<div class="detail-section"><div class="detail-label">Status</div><pre class="json-block">${escHtml(obs.statusMessage)}</pre></div>`) : ''}
      ${usageHtml}
      ${ioParts.length ? `<div class="io-grid">${ioParts.join('')}</div>` : ''}
      ${isDefined(obs.metadata) ? renderMoreSection('Metadata', obs.metadata, `${fldPfx}-metadata`) : ''}
      ${isDefined(obs.modelParameters) ? renderMoreSection('Model parameters', obs.modelParameters, `${fldPfx}-params`) : ''}
      ${!hasDetail ? '<div class="dim no-detail-msg">No input / output recorded for this span.</div>' : ''}
    </div>`;

  const grid = ticks.map(t => `<span class="wf-grid" style="left:${((t / windowMs) * 100).toFixed(2)}%"></span>`).join('');

  return `
    <div class="obs-row${hasChildren ? ' has-children' : ''}${isError ? ' is-error' : ''}" style="--wf-color:${rowColor}" id="${obsId}" role="treeitem" aria-level="${depth + 1}"${hasChildren ? ' aria-expanded="true"' : ''} data-trace-id="${escHtml(trace.id)}" data-observation-id="${escHtml(obs.id)}" data-parent-id="${escHtml(parentId)}" data-depth="${depth}" data-group="${observationGroup(obs.type)}" data-error="${isError ? '1' : '0'}" data-search="${escHtml(buildSearchText(obs))}">
      <div class="obs-header${hasDetail ? '' : ' no-detail'}" tabindex="-1">
        <div class="obs-main">
          ${renderTreeGuides(guideCells)}
          ${renderTreeToggle(hasChildren)}
          ${renderObsTypeIcon(obs.type, typeColor)}
          <span class="obs-name" title="${escHtml(name)}"><span class="obs-name-text" data-name="${escHtml(name)}">${escHtml(name)}</span></span>
          ${levelInfo}
          ${modelInfo}
        </div>
        ${tokensHtml}
        ${costHtml}
        <span class="obs-time">${fmtMs(dur)}</span>
        <div class="wf-track" title="${escHtml(waterfallTip(obs, minStart))}">${grid}${buildWaterfallBar(obs, minStart, windowMs)}</div>
        <button class="icon-btn obs-export-btn" type="button" title="Send span context to chat" aria-label="Send span context to chat" data-trace-id="${escHtml(trace.id)}" data-observation-id="${escHtml(obs.id)}">${ICON_CHAT}</button>
      </div>
      ${detailHtml}
    </div>`;
}

function renderTraceSection(
  s: TraceSummary,
  ti: number,
  total: number,
  maxTraceMs: number,
  langfuseHost: string,
): string {
  const { trace, observations: traceObs, minStart, totalMs, tokenInput, tokenOutput } = s;
  const windowMs = totalMs || 1;
  const treeGuides = computeTreeGuides(traceObs);
  const childrenByParent = computeChildrenByParent(traceObs);
  const parents = resolveDisplayParents(traceObs);
  const depths = computeDepths(traceObs);
  const ticks = computeTimeTicks(windowMs);
  const ctx: ObsRenderContext = {
    trace,
    traceIndex: ti,
    minStart,
    windowMs,
    ticks,
    byId: new Map(traceObs.map(o => [o.id, o])),
    parents,
  };

  const rowsHtml = traceObs.map((obs, oi) => renderObservationRow(
    obs,
    oi,
    ctx,
    treeGuides.get(obs.id) ?? [],
    (childrenByParent.get(obs.id) ?? []).length,
    depths.get(obs.id) ?? 0,
  )).join('');

  const errors = countErrorObservations(traceObs);
  const cost = fmtCost(computeTraceCost(trace, traceObs));
  const preview = extractPreviewText(trace.input, 140) ?? extractPreviewText(trace.output, 140);
  const aggregate = aggregateUsage(traceObs);
  const usageTitle = aggregate ? summarizeUsage(aggregate) : 'Input → output tokens';
  const traceUrl = langfuseHost ? `${escHtml(langfuseHost.replace(/\/$/, ''))}/trace/${escHtml(trace.id)}` : '';

  const ioFldPfx = `tio-${ti}`;
  const traceIoHtml = (isDefined(trace.input) || isDefined(trace.output)) ? `
      <div class="trace-io">
        ${isDefined(trace.input) ? renderIoSection(trace.input, `${ioFldPfx}-input`, 'user') : ''}
        ${isDefined(trace.output) ? renderIoSection(trace.output, `${ioFldPfx}-output`, 'assistant') : ''}
      </div>` : '';

  const tickLabels = ticks.map(t =>
    `<span class="tick-label" style="left:${((t / windowMs) * 100).toFixed(2)}%">${escHtml(fmtTick(t))}</span>`
  ).join('');

  const share = Math.max(2, Math.min(100, (totalMs / maxTraceMs) * 100));

  return `
    <section class="trace-section${ti > 0 ? ' collapsed' : ''}" data-trace-id="${escHtml(trace.id)}" data-trace-index="${ti}">
      <div class="trace-header" role="button" tabindex="${ti === 0 ? '0' : '-1'}" aria-expanded="${ti > 0 ? 'false' : 'true'}">
        <span class="trace-chevron">${CHEVRON_DOWN}</span>
        <span class="trace-idx">#${total - ti}</span>
        <span class="trace-name">${escHtml(trace.name ?? 'agentic_run')}</span>
        <span class="trace-preview" title="${escHtml(preview ?? '')}">${preview ? `“${escHtml(preview)}”` : ''}</span>
        ${errors > 0 ? `<span class="err-pill" title="${errors} span${errors === 1 ? '' : 's'} with level ERROR">${errors} error${errors === 1 ? '' : 's'}</span>` : ''}
        <span class="trace-ts">${escHtml(fmtDate(trace.timestamp))}</span>
        ${(tokenInput + tokenOutput) > 0 ? `<span class="trace-usage" title="${escHtml(usageTitle)}">${fmtTokens(tokenInput)} → ${fmtTokens(tokenOutput)}</span>` : ''}
        ${cost ? `<span class="trace-cost">${escHtml(cost)}</span>` : ''}
        <span class="trace-share" aria-hidden="true" title="Duration relative to the longest trace"><i style="width:${share.toFixed(1)}%"></i></span>
        <span class="trace-dur">${fmtMs(totalMs)}</span>
        <div class="trace-actions">
          <button class="icon-btn trace-chat-btn" type="button" title="Send trace to chat (via MCP)" aria-label="Send trace to chat" data-trace-id="${escHtml(trace.id)}">${ICON_CHAT}</button>
          <button class="icon-btn trace-ctrl-btn" type="button" data-expanded="false" title="Expand all spans in this trace" aria-label="Expand all spans in this trace">${ICON_EXPAND_ALL}</button>
          ${langfuseHost ? `<a class="icon-btn ext-link" href="${traceUrl}" data-href="${traceUrl}" title="Open trace in Langfuse" aria-label="Open trace in Langfuse">${ICON_EXTERNAL}</a>` : ''}
        </div>
      </div>
      <div class="trace-body" id="trace-body-${ti}">
        ${renderTraceMetaBar(trace)}
        ${traceIoHtml}
        ${traceObs.length === 0
    ? '<div class="dim" style="padding:10px 16px;font-size:0.85em">No observations recorded for this trace.</div>'
    : `<div class="col-head" aria-hidden="true">
          <span class="col-name">Span</span>
          <span class="col-tok">Tokens</span>
          <span class="col-cost">Cost</span>
          <span class="col-dur">Duration</span>
          <div class="col-tl">${tickLabels}</div>
          <span class="col-act"></span>
        </div>
        <div role="tree" aria-label="Spans of trace ${total - ti}">${rowsHtml}</div>`}
      </div>
    </section>`;
}

function renderSegButton(group: string, label: string, count: number | undefined, dotColor?: string): string {
  const n = count === undefined ? '' : `<span class="n">${count}</span>`;
  const dot = dotColor ? `<span class="dot" style="background:${dotColor}"></span>` : '';
  const empty = count === 0 ? ' class="is-empty"' : '';
  return `<button type="button" data-group="${group}" aria-pressed="${group === 'all' ? 'true' : 'false'}"${empty}>${dot}${label}${n}</button>`;
}

/** Builds the complete HTML document for a session's trace viewer webview. */
export function buildTracePanelHtml(
  sessionId: string,
  traces: LangfuseTrace[],
  observations: LangfuseObservation[],
  langfuseHost = '',
  now: number = Date.now(),
): string {
  const nonce = randomBytes(16).toString('base64');
  const sortedTraces = sortTracesNewestFirst(traces);
  const summaries = buildTraceSummaries(sortedTraces, observations);
  const allObs = summaries.flatMap(s => s.observations);
  const sessionStart = summaries.length ? Math.min(...summaries.map(s => s.minStart)) : 0;
  const sessionEnd = summaries.length ? Math.max(...summaries.map(s => s.maxEnd)) : 0;
  const sessionMs = sessionEnd > sessionStart ? sessionEnd - sessionStart : 0;
  const maxTraceMs = Math.max(1, ...summaries.map(s => s.totalMs));

  const processingMs = summaries.reduce((acc, s) => acc + s.totalMs, 0);
  const sessionTkIn = summaries.reduce((acc, s) => acc + s.tokenInput, 0);
  const sessionTkOut = summaries.reduce((acc, s) => acc + s.tokenOutput, 0);
  const sessionCost = summaries.reduce((acc, s) => acc + (computeTraceCost(s.trace, s.observations) ?? 0), 0);
  const errorCount = countErrorObservations(allObs);
  const showSession = sessionMs > 0 && sessionMs > processingMs * 1.5;
  const sessionUsage = aggregateUsage(allObs);
  const sessionUrl = buildSessionUrl(langfuseHost, sessionId, traces);

  const llmCount = allObs.filter(o => observationGroup(o.type) === 'llm').length;
  const toolCount = allObs.filter(o => observationGroup(o.type) === 'tool').length;

  const traceSectionsHtml = summaries
    .map((s, ti) => renderTraceSection(s, ti, summaries.length, maxTraceMs, langfuseHost))
    .join('');

  const costLabel = fmtCost(sessionCost > 0 ? sessionCost : undefined);
  const headerStats = `
    <span><strong>${traces.length}</strong> trace${traces.length !== 1 ? 's' : ''}</span>
    ${observations.length > 0 ? `<span><strong>${observations.length}</strong> span${observations.length !== 1 ? 's' : ''}</span>` : ''}
    ${processingMs > 0 ? `<span title="Sum of individual trace durations"><strong>${fmtMs(processingMs)}</strong> processing</span>` : ''}
    ${(sessionTkIn + sessionTkOut) > 0 ? `<span title="${escHtml(sessionUsage ? summarizeUsage(sessionUsage) : 'Input → output tokens across all traces')}"><strong>${fmtTokens(sessionTkIn)} → ${fmtTokens(sessionTkOut)}</strong> tokens</span>` : ''}
    ${costLabel ? `<span class="stat-cost" title="Estimated cost across all traces"><strong>${escHtml(costLabel)}</strong> cost</span>` : ''}
    ${errorCount > 0 ? `<span class="err-pill">${errorCount} error${errorCount === 1 ? '' : 's'}</span>` : ''}
    ${showSession ? `<span class="dim-stat" title="Wall-clock time from first to last span across all traces"><strong>${fmtMs(sessionMs)}</strong> session</span>` : ''}`;

  const filterRow = observations.length > 0 ? `
    <div class="filter-row">
      <label class="filter-input">${ICON_SEARCH}<input id="filter-input" type="search" aria-label="Filter spans" placeholder="Filter spans by name, model or type…" autocomplete="off"><kbd>/</kbd></label>
      <div class="seg" role="group" aria-label="Span type">
        ${renderSegButton('all', 'All', allObs.length)}
        ${renderSegButton('llm', 'LLM', llmCount, 'var(--vscode-terminal-ansiGreen, #98c379)')}
        ${renderSegButton('tool', 'Tools', toolCount, 'var(--vscode-terminal-ansiCyan, #56b6c2)')}
        ${renderSegButton('error', 'Errors', errorCount, 'var(--danger)')}
      </div>
      <div class="expand-ctrls">
        <button class="link-btn" type="button" id="btn-expand-all">Expand all</button>
        <button class="link-btn" type="button" id="btn-collapse-all">Collapse all</button>
      </div>
    </div>` : '';

  const legend = (['SPAN', 'GENERATION', 'AGENT', 'TOOL'] as const)
    .map(type => `<span><i style="background:${observationTypeColor(type)}"></i>${type.toLowerCase()}</span>`).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'">
<style>${PANEL_STYLES}</style>
</head>
<body>
  <div id="header">
    <div class="hdr-top">
      ${LOGO}
      <span class="hdr-label">Session</span>
      <button class="session-id" type="button" data-copy-session="${escHtml(sessionId)}" title="Copy session ID: ${escHtml(sessionId)}" aria-label="Copy session ID"><span class="sid-text">${escHtml(sessionId)}</span>${ICON_COPY}</button>
      <span class="updated" id="updated-at" data-updated="${now}">Updated just now</span>
      <div class="hdr-actions">
        <button class="text-btn" id="btn-send-session-chat" type="button" title="Send session to chat (via MCP)">${ICON_CHAT}<span class="btn-label">Send to chat</span></button>
        ${sessionUrl ? `<a class="icon-btn ext-link" href="${escHtml(sessionUrl)}" data-href="${escHtml(sessionUrl)}" title="Open session in Langfuse" aria-label="Open session in Langfuse">${ICON_EXTERNAL}</a>` : ''}
        <button class="icon-btn" id="btn-refresh" type="button" title="Refresh traces from Langfuse" aria-label="Refresh traces">${ICON_REFRESH}</button>
      </div>
    </div>
    <div class="stats-row">${headerStats}</div>
    ${filterRow}
  </div>
  <div class="filter-banner" role="status"><span id="filter-summary"></span><button class="link-btn" type="button" id="btn-clear-filter">Clear filters</button></div>

  <div id="content">
    ${traces.length === 0
    ? `<div id="empty-state">
        <div class="icon">⎆</div>
        <div>No traces found for this session.</div>
        <div style="margin-top:6px;font-size:0.85em">Ensure the Langfuse instance is reachable and the trace has been flushed.</div>
      </div>`
    : traceSectionsHtml}
  </div>

  <div id="footer">
    <span class="hints"><span><kbd>↑</kbd> <kbd>↓</kbd> move</span><span><kbd>←</kbd> <kbd>→</kbd> collapse / expand</span><span><kbd>Enter</kbd> details</span><span><kbd>/</kbd> filter</span><span><kbd>c</kbd> send to chat</span></span>
    <span class="legend">${legend}</span>
  </div>

  <script nonce="${nonce}">${PANEL_SCRIPT}</script>
</body>
</html>`;
}

import type { LangfuseObservation } from './langfuse-client.js';
import { isDefined, fmtDate, fmtMs, durationMs } from './trace-utils.js';

/** Escapes a value for safe insertion into HTML text/attributes. */
export function escHtml(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Formats a USD cost for display in the span header/detail. */
export function fmtCost(n?: number): string | undefined {
  if (!isDefined(n) || Number.isNaN(n)) { return undefined; }
  if (n === 0) { return undefined; }

  const abs = Math.abs(n);
  let digits: number;
  if (abs < 1e-6) {
    return `$${n.toExponential(2)}`;
  }
  if (abs < 1e-4) {
    digits = 8;
  } else if (abs < 0.01) {
    digits = 6;
  } else if (abs < 1) {
    digits = 5;
  } else {
    digits = 4;
  }

  const raw = n.toFixed(digits).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
  return `$${raw}`;
}

/**
 * Resolves the best available USD cost for an observation.
 * Prefers `totalCost` / `costDetails.total`, then calculated* fields.
 */
export function resolveObservationCost(obs: LangfuseObservation): number | undefined {
  const fromDetails = obs.costDetails?.['total']
    ?? obs.costDetails?.['Total']
    ?? sumCostDetails(obs.costDetails);
  const candidates = [
    obs.totalCost,
    fromDetails,
    obs.calculatedTotalCost,
    sumDefined(obs.calculatedInputCost, obs.calculatedOutputCost),
  ];
  for (const value of candidates) {
    if (isDefined(value) && !Number.isNaN(value) && value !== 0) {
      return value;
    }
  }
  for (const value of candidates) {
    if (isDefined(value) && !Number.isNaN(value)) {
      return value;
    }
  }
  return undefined;
}

function sumDefined(a?: number, b?: number): number | undefined {
  if (!isDefined(a) && !isDefined(b)) { return undefined; }
  return (a ?? 0) + (b ?? 0);
}

function sumCostDetails(details?: Record<string, number>): number | undefined {
  if (!details) { return undefined; }
  const entries = Object.entries(details).filter(([key]) => key.toLowerCase() !== 'total');
  if (entries.length === 0) { return undefined; }
  return entries.reduce((sum, [, value]) => sum + (typeof value === 'number' ? value : 0), 0);
}

/**
 * Applies lightweight syntax highlighting to raw JSON text.
 * Each token is HTML-escaped before being wrapped in span classes.
 */
export function highlightJson(json: string): string {
  const re = /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g;
  let result = '';
  let lastIndex = 0;
  for (const match of json.matchAll(re)) {
    const full = match[0];
    const idx = match.index ?? 0;
    result += escHtml(json.slice(lastIndex, idx));
    const str = match[1];
    const colon = match[2];
    const keyword = match[3];
    if (str !== undefined) {
      result += colon !== undefined
        ? `<span class="json-key">${escHtml(str)}</span>${escHtml(colon)}`
        : `<span class="json-str">${escHtml(str)}</span>`;
    } else if (keyword !== undefined) {
      result += `<span class="json-kw">${keyword}</span>`;
    } else {
      result += `<span class="json-num">${escHtml(full)}</span>`;
    }
    lastIndex = idx + full.length;
  }
  result += escHtml(json.slice(lastIndex));
  return result;
}

/** Renders a value as a highlighted JSON block. */
export function renderObsJson(value: unknown): string {
  if (!isDefined(value)) { return '<em class="dim">—</em>'; }
  try {
    const json = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
    return `<pre class="json-block">${highlightJson(json)}</pre>`;
  } catch {
    return escHtml(String(value));
  }
}

/**
 * Renders plain text with a small set of markdown constructs after HTML escaping.
 * Supports inline code, bold, italic, and fenced code blocks.
 */
export function renderMarkdownLite(text: string): string {
  if (text.length === 0) { return '<em class="dim">(empty)</em>'; }

  const fences: string[] = [];
  const withFences = text.replace(/```([\s\S]*?)```/g, (_m, code: string) => {
    const idx = fences.length;
    fences.push(`<pre class="fmt-code-block">${escHtml(code.replace(/^\n/, ''))}</pre>`);
    return `\u0000FENCE${idx}\u0000`;
  });

  let html = escHtml(withFences);
  html = html.replace(/`([^`\n]+)`/g, '<code class="fmt-inline-code">$1</code>');
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');
  html = html.replace(/\u0000FENCE(\d+)\u0000/g, (_m, idx: string) => fences[Number(idx)] ?? '');

  return `<div class="fmt-md">${html}</div>`;
}

/** Returns true when an array looks like a chat messages/contents list. */
export function isChatMessages(arr: unknown[]): boolean {
  return arr.length > 0 && arr.every(item => {
    if (!isDefined(item) || typeof item !== 'object' || Array.isArray(item)) { return false; }
    const o = item as Record<string, unknown>;
    return 'role' in o || 'content' in o || 'parts' in o;
  });
}

/** Returns true when a value looks like a single tool/function call object. */
export function isToolCall(value: unknown): value is Record<string, unknown> {
  if (!isDefined(value) || typeof value !== 'object' || Array.isArray(value)) { return false; }
  const o = value as Record<string, unknown>;
  if (o['type'] === 'tool_call' || o['type'] === 'function_call') { return true; }
  if (typeof o['function'] === 'object' && o['function'] !== null) { return true; }
  if (typeof o['name'] === 'string' && ('arguments' in o || 'args' in o || 'input' in o)) { return true; }
  return false;
}

/** Returns true when an array is a list of tool/function calls. */
export function isToolCallList(arr: unknown[]): boolean {
  return arr.length > 0 && arr.every(isToolCall);
}

function formatToolArgs(args: unknown): string {
  if (!isDefined(args)) { return '<em class="dim">—</em>'; }
  if (typeof args === 'string') {
    try {
      const parsed: unknown = JSON.parse(args);
      return renderObsJson(parsed);
    } catch {
      return `<pre class="json-block fmt-nested">${escHtml(args)}</pre>`;
    }
  }
  return renderObsJson(args);
}

/** Renders a tool/function call as a compact card. */
export function renderToolCall(call: Record<string, unknown>): string {
  const fn = (typeof call['function'] === 'object' && call['function'] !== null)
    ? call['function'] as Record<string, unknown>
    : call;
  const name = String(fn['name'] ?? call['name'] ?? call['tool_name'] ?? 'tool');
  const args = fn['arguments'] ?? fn['args'] ?? fn['input'] ?? call['arguments'] ?? call['args'] ?? call['input'];
  const id = call['id'] ?? call['tool_call_id'];
  const idHtml = isDefined(id)
    ? `<span class="fmt-tool-id">${escHtml(String(id))}</span>`
    : '';

  return `<div class="fmt-tool">
    <div class="fmt-tool-head">
      <span class="fmt-tool-badge">tool</span>
      <span class="fmt-tool-name">${escHtml(name)}</span>
      ${idHtml}
    </div>
    <div class="fmt-tool-args">${formatToolArgs(args)}</div>
  </div>`;
}

/** Renders a content part that may be a string, a {text} object, or a nested array. */
function renderContentPart(part: unknown): string {
  if (typeof part === 'string') {
    return renderMarkdownLite(part);
  }
  if (isDefined(part) && typeof part === 'object' && !Array.isArray(part)) {
    const p = part as Record<string, unknown>;
    if (typeof p['text'] === 'string') {
      return renderMarkdownLite(p['text']);
    }
    if (p['type'] === 'tool_use' || p['type'] === 'function_call' || isToolCall(p)) {
      return renderToolCall(p);
    }
  }
  try {
    return `<pre class="json-block fmt-nested">${highlightJson(JSON.stringify(part, null, 2))}</pre>`;
  } catch {
    return escHtml(String(part));
  }
}

/** Renders message content which may be a string, an array of parts, or other objects. */
function renderMessageContent(content: unknown): string {
  if (typeof content === 'string') {
    return renderMarkdownLite(content);
  }
  if (Array.isArray(content)) {
    return (content as unknown[]).map(renderContentPart).join('');
  }
  return renderContentPart(content);
}

/** Renders a single chat-shaped message including optional tool_calls. */
function renderChatMessage(item: Record<string, unknown>): string {
  const role = String(item['role'] ?? '?');
  const content = item['content'] ?? item['parts'] ?? '';
  const safeRole = role.replace(/[^a-z0-9]/gi, '');
  const toolCalls = item['tool_calls'] ?? item['function_call'];
  let toolsHtml = '';
  if (Array.isArray(toolCalls) && isToolCallList(toolCalls)) {
    toolsHtml = `<div class="fmt-tool-list">${toolCalls.map(c => renderToolCall(c as Record<string, unknown>)).join('')}</div>`;
  } else if (isToolCall(toolCalls)) {
    toolsHtml = renderToolCall(toolCalls);
  }

  const body = renderMessageContent(content);
  const hasBody = !(typeof content === 'string' && content.length === 0) && content !== undefined && content !== null;

  return `<div class="fmt-msg fmt-msg-${escHtml(safeRole)}">
    <span class="fmt-msg-role">${escHtml(role)}</span>
    ${hasBody ? `<div class="fmt-msg-body">${body}</div>` : ''}
    ${toolsHtml}
  </div>`;
}

/**
 * Recursively renders a value in a human-friendly way.
 * Chat message arrays become role-labeled bubbles; tool calls become cards;
 * objects become key-value tables; primitives are shown inline.
 */
export function renderFormatted(value: unknown, depth = 0): string {
  if (!isDefined(value)) { return '<em class="dim">null</em>'; }

  if (typeof value === 'string') {
    return renderMarkdownLite(value);
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return `<span class="fmt-primitive">${escHtml(String(value))}</span>`;
  }

  if (Array.isArray(value)) {
    if (isChatMessages(value)) {
      return value.map(item => renderChatMessage(item as Record<string, unknown>)).join('');
    }
    if (isToolCallList(value)) {
      return `<div class="fmt-tool-list">${value.map(c => renderToolCall(c as Record<string, unknown>)).join('')}</div>`;
    }
    if (value.length === 0) { return '<em class="dim">(empty list)</em>'; }
    return `<div class="fmt-list">${(value as unknown[]).map((item, i) =>
      `<div class="fmt-list-item"><span class="fmt-list-idx">[${i}]</span><div class="fmt-list-val">${renderFormatted(item, depth + 1)}</div></div>`
    ).join('')}</div>`;
  }

  if (typeof value === 'object') {
    if (isToolCall(value)) {
      return renderToolCall(value);
    }

    const obj = value as Record<string, unknown>;
    const entries = Object.entries(obj);
    if (entries.length === 0) { return '<em class="dim">{ }</em>'; }

    const chatKey = entries.find(([k]) => k === 'messages' || k === 'contents' || k === 'parts');
    if (chatKey && Array.isArray(chatKey[1]) && isChatMessages(chatKey[1])) {
      const rest = entries.filter(([k]) => k !== chatKey[0]);
      const header = rest.map(([k, v]) => {
        const display = typeof v === 'object' ? JSON.stringify(v) : String(v);
        return `<span class="fmt-meta-kv"><span class="fmt-key">${escHtml(k)}</span>: <span class="fmt-primitive">${escHtml(display)}</span></span>`;
      }).join(' ');
      return (header ? `<div class="fmt-meta-row">${header}</div>` : '') + renderFormatted(chatKey[1], depth);
    }

    const toolCalls = obj['tool_calls'];
    if (Array.isArray(toolCalls) && isToolCallList(toolCalls) && entries.length <= 3) {
      const rest = entries.filter(([k]) => k !== 'tool_calls');
      const header = rest.map(([k, v]) =>
        `<span class="fmt-meta-kv"><span class="fmt-key">${escHtml(k)}</span>: <span class="fmt-primitive">${escHtml(String(v))}</span></span>`
      ).join(' ');
      return (header ? `<div class="fmt-meta-row">${header}</div>` : '')
        + `<div class="fmt-tool-list">${toolCalls.map(c => renderToolCall(c as Record<string, unknown>)).join('')}</div>`;
    }

    if (depth >= 2) {
      try {
        return `<pre class="json-block fmt-nested">${highlightJson(JSON.stringify(value, null, 2))}</pre>`;
      } catch { /**/ }
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
 * Wraps a field's value in a JSON/Formatted toggle with a copy button.
 * Formatted is the default active view. Copy reads the visible view via JS.
 */
export function renderFieldWithToggle(value: unknown, fieldId: string): string {
  const jsonHtml = renderObsJson(value);
  const fmtHtml = renderFormatted(value);

  return `
    <div class="field-toolbar">
      <div class="field-tabs" data-field="${escHtml(fieldId)}">
        <button class="field-tab active" data-view="fmt" type="button">Formatted</button>
        <button class="field-tab" data-view="json" type="button">JSON</button>
      </div>
      <button class="field-copy-btn" type="button" title="Copy field value" data-copy-field="${escHtml(fieldId)}">Copy</button>
    </div>
    <div class="field-view" id="${escHtml(fieldId)}-fmt">${fmtHtml}</div>
    <div class="field-view" id="${escHtml(fieldId)}-json" style="display:none">${jsonHtml}</div>`;
}

/** Renders the inspection header shown above span input/output sections. */
export function renderSpanDetailMeta(obs: LangfuseObservation): string {
  const dur = durationMs(obs);
  const cost = fmtCost(resolveObservationCost(obs));
  const level = obs.level ? String(obs.level).toUpperCase() : '';
  const levelClass = level === 'ERROR' || level === 'WARNING' || level === 'DEFAULT' || level === 'DEBUG'
    ? `obs-level-${level.toLowerCase()}`
    : 'obs-level-default';

  const items: string[] = [
    `<span class="obs-meta-item">
      <span class="obs-meta-k">ID</span>
      <code class="obs-meta-id" title="${escHtml(obs.id)}">${escHtml(obs.id)}</code>
      <button class="field-copy-btn obs-meta-copy" type="button" title="Copy observation ID" data-copy="${escHtml(obs.id)}">Copy</button>
    </span>`,
  ];

  if (obs.startTime) {
    items.push(`<span class="obs-meta-item"><span class="obs-meta-k">Start</span><span class="obs-meta-v">${escHtml(fmtDate(obs.startTime))}</span></span>`);
  }
  if (obs.endTime) {
    items.push(`<span class="obs-meta-item"><span class="obs-meta-k">End</span><span class="obs-meta-v">${escHtml(fmtDate(obs.endTime))}</span></span>`);
  }
  if (isDefined(dur)) {
    items.push(`<span class="obs-meta-item"><span class="obs-meta-k">Duration</span><span class="obs-meta-v">${escHtml(fmtMs(dur))}</span></span>`);
  }
  if (level) {
    items.push(`<span class="obs-meta-item"><span class="obs-meta-k">Level</span><span class="obs-level ${levelClass}">${escHtml(level)}</span></span>`);
  }
  if (obs.model) {
    items.push(`<span class="obs-meta-item"><span class="obs-meta-k">Model</span><span class="obs-meta-v mono">${escHtml(obs.model)}</span></span>`);
  }
  if (obs.usage) {
    items.push(`<span class="obs-meta-item"><span class="obs-meta-k">Tokens</span><span class="obs-meta-v">↑${obs.usage.input ?? '?'} ↓${obs.usage.output ?? '?'}</span></span>`);
  }
  if (cost) {
    items.push(`<span class="obs-meta-item"><span class="obs-meta-k">Cost</span><span class="obs-meta-v obs-cost">${escHtml(cost)}</span></span>`);
  }

  return `<div class="obs-meta">${items.join('')}</div>`;
}

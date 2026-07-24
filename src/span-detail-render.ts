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

/** Returns true when an object looks like an LLM call request wrapper. */
export function isLlmCallPayload(value: unknown): value is Record<string, unknown> {
  if (!isDefined(value) || typeof value !== 'object' || Array.isArray(value)) { return false; }
  const o = value as Record<string, unknown>;
  const messages = o['messages'] ?? o['contents'];
  return Array.isArray(messages) && isChatMessages(messages);
}

const COMPACT_CONFIG_KEYS = new Set([
  'temperature',
  'topP',
  'top_p',
  'topK',
  'top_k',
  'maxOutputTokens',
  'max_output_tokens',
  'max_tokens',
  'maxTokens',
  'candidateCount',
  'candidate_count',
  'frequencyPenalty',
  'presencePenalty',
  'stopSequences',
  'stop_sequences',
  'responseMimeType',
  'response_mime_type',
  'seed',
]);

const SKIP_CONFIG_KEYS = new Set([
  'http_options',
  'httpOptions',
  'labels',
  'tools',
  'toolConfig',
  'tool_config',
  'safetySettings',
  'safety_settings',
  'systemInstruction',
  'system_instruction',
]);

/**
 * Collects compact scalar config chips from nested generation config objects.
 * Skips bulky transport/tool blobs that make call_llm payloads unreadable.
 */
export function collectConfigChips(config: unknown): Array<{ key: string; value: string }> {
  const out: Array<{ key: string; value: string }> = [];
  const seen = new Set<string>();

  function walk(node: unknown): void {
    if (!isDefined(node) || typeof node !== 'object' || Array.isArray(node)) { return; }
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (SKIP_CONFIG_KEYS.has(key)) { continue; }
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        if (!COMPACT_CONFIG_KEYS.has(key) || seen.has(key)) { continue; }
        seen.add(key);
        out.push({ key, value: String(value) });
        continue;
      }
      if (Array.isArray(value) && value.every(v => typeof v === 'string' || typeof v === 'number')) {
        if (!COMPACT_CONFIG_KEYS.has(key) || seen.has(key) || value.length === 0 || value.length > 6) {
          continue;
        }
        seen.add(key);
        out.push({ key, value: value.join(', ') });
        continue;
      }
      if (typeof value === 'object' && value !== null) {
        walk(value);
      }
    }
  }

  walk(config);
  return out;
}

/** Renders compact config chips for LLM generation settings. */
export function renderConfigChips(config: unknown): string {
  const chips = collectConfigChips(config);
  if (chips.length === 0) { return ''; }
  return `<div class="fmt-chips">${chips.map(chip =>
    `<span class="fmt-chip"><span class="fmt-chip-k">${escHtml(chip.key)}</span><span class="fmt-chip-v">${escHtml(chip.value)}</span></span>`
  ).join('')}</div>`;
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
    const functionCall = p['functionCall'] ?? p['function_call'];
    if (isDefined(functionCall) && typeof functionCall === 'object' && !Array.isArray(functionCall)) {
      const fc = functionCall as Record<string, unknown>;
      return renderToolCall({
        name: fc['name'],
        arguments: fc['args'] ?? fc['arguments'],
        id: p['id'] ?? fc['id'],
      });
    }
    const functionResponse = p['functionResponse'] ?? p['function_response'];
    if (isDefined(functionResponse) && typeof functionResponse === 'object' && !Array.isArray(functionResponse)) {
      const fr = functionResponse as Record<string, unknown>;
      const name = String(fr['name'] ?? 'tool');
      const response = fr['response'] ?? fr['result'] ?? fr;
      return `<div class="fmt-tool">
        <div class="fmt-tool-head">
          <span class="fmt-tool-badge">tool result</span>
          <span class="fmt-tool-name">${escHtml(name)}</span>
        </div>
        <div class="fmt-tool-args">${formatToolArgs(response)}</div>
      </div>`;
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

/** Renders an LLM call wrapper (model + config + contents/messages) without dumping blobs. */
export function renderLlmCallPayload(obj: Record<string, unknown>): string {
  const messages = (obj['messages'] ?? obj['contents']) as unknown[];
  const model = obj['model'] ?? obj['model_name'] ?? obj['modelName'];
  const config = obj['config'] ?? obj['generationConfig'] ?? obj['generation_config'] ?? obj['modelParameters'];

  const head = model
    ? `<div class="fmt-llm-head"><span class="fmt-llm-model">${escHtml(String(model))}</span></div>`
    : '';
  const chips = renderConfigChips(config);
  const chat = messages.map(item => renderChatMessage(item as Record<string, unknown>)).join('');
  return `${head}${chips}${chat}`;
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

    if (isLlmCallPayload(value)) {
      return renderLlmCallPayload(value);
    }

    const obj = value as Record<string, unknown>;
    const entries = Object.entries(obj);
    if (entries.length === 0) { return '<em class="dim">{ }</em>'; }

    const toolCalls = obj['tool_calls'];
    if (Array.isArray(toolCalls) && isToolCallList(toolCalls) && entries.length <= 3) {
      const rest = entries.filter(([k]) => k !== 'tool_calls');
      const header = rest
        .filter(([, v]) => typeof v !== 'object' || v === null)
        .map(([k, v]) =>
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

const PRIMARY_TEXT_KEYS = [
  'query',
  'message',
  'text',
  'prompt',
  'question',
  'user_message',
  'input',
  'response',
  'answer',
  'output',
  'content',
  'result',
];

/**
 * Pulls a primary human-readable string out of common agent I/O shapes,
 * leaving scalar leftovers as compact meta chips.
 */
export function extractPrimaryText(value: unknown): {
  primary: string;
  meta: Array<{ key: string; value: string }>;
} | null {
  if (typeof value === 'string') {
    return value.length === 0 ? null : { primary: value, meta: [] };
  }
  if (!isDefined(value) || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const obj = value as Record<string, unknown>;
  const primaryKey = PRIMARY_TEXT_KEYS.find(key => typeof obj[key] === 'string' && String(obj[key]).trim().length > 0);
  if (!primaryKey) { return null; }

  const meta: Array<{ key: string; value: string }> = [];
  for (const [key, entry] of Object.entries(obj)) {
    if (key === primaryKey) { continue; }
    if (typeof entry === 'string' || typeof entry === 'number' || typeof entry === 'boolean') {
      const text = String(entry);
      if (text.length === 0 || text.length > 120) { continue; }
      meta.push({ key, value: text });
      if (meta.length >= 10) { break; }
    }
  }

  return { primary: String(obj[primaryKey]), meta };
}

/** Renders the formatted body for a user/assistant I/O turn. */
export function renderIoBody(value: unknown, role: 'user' | 'assistant'): string {
  const extracted = extractPrimaryText(value);
  if (extracted) {
    const chips = extracted.meta.length === 0
      ? ''
      : `<div class="fmt-chips">${extracted.meta.map(chip =>
        `<span class="fmt-chip"><span class="fmt-chip-k">${escHtml(chip.key)}</span><span class="fmt-chip-v">${escHtml(chip.value)}</span></span>`
      ).join('')}</div>`;
    return `${chips}<div class="io-prose io-prose-${role}">${renderMarkdownLite(extracted.primary)}</div>`;
  }
  return `<div class="io-prose io-prose-${role}">${renderFormatted(value)}</div>`;
}

/**
 * Renders Input/Output or User/Assistant as a conversation turn card
 * with Formatted/JSON toggle.
 */
export function renderIoSection(
  value: unknown,
  fieldId: string,
  kind: 'user' | 'assistant' | 'input' | 'output',
): string {
  const role: 'user' | 'assistant' = (kind === 'user' || kind === 'input') ? 'user' : 'assistant';
  const label = (() => {
    switch (kind) {
      case 'user': return 'User';
      case 'assistant': return 'Assistant';
      case 'input': return 'Input';
      case 'output': return 'Output';
      default: {
        const _exhaustive: never = kind;
        return _exhaustive;
      }
    }
  })();

  const jsonHtml = renderObsJson(value);
  const fmtHtml = renderIoBody(value, role);

  return `
    <div class="io-turn io-turn-${role}">
      <div class="io-turn-bar">
        <span class="io-turn-label">${label}</span>
        <div class="field-toolbar io-turn-tools">
          <div class="field-tabs" data-field="${escHtml(fieldId)}">
            <button class="field-tab active" data-view="fmt" type="button">Formatted</button>
            <button class="field-tab" data-view="json" type="button">JSON</button>
          </div>
          <button class="field-copy-btn" type="button" title="Copy field value" data-copy-field="${escHtml(fieldId)}">Copy</button>
        </div>
      </div>
      <div class="field-view io-turn-body" id="${escHtml(fieldId)}-fmt">${fmtHtml}</div>
      <div class="field-view io-turn-body" id="${escHtml(fieldId)}-json" style="display:none">${jsonHtml}</div>
    </div>`;
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

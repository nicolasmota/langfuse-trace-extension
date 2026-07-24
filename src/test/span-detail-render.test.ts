import { describe, it, expect } from 'vitest';
import type { LangfuseObservation, LangfuseScore, LangfuseTrace } from '../langfuse-client.js';
import {
  escHtml,
  extractPrimaryText,
  fmtCost,
  fmtScoreValue,
  highlightJson,
  isChatMessages,
  isToolCall,
  isToolCallList,
  parseTraceMetadata,
  curateTraceMetadata,
  renderCostBreakdown,
  renderFieldWithToggle,
  renderFormatted,
  renderIoSection,
  renderMarkdownLite,
  renderObsJson,
  renderScores,
  renderSpanDetailMeta,
  renderToolCall,
  renderTraceMetaBar,
  resolveObservationCost,
  resolveTtftMs,
} from '../span-detail-render.js';

describe('escHtml', () => {
  it('escapes markup characters', () => {
    expect(escHtml(`<a href="x">&`)).toBe('&lt;a href=&quot;x&quot;&gt;&amp;');
  });
});

describe('fmtCost', () => {
  it('returns undefined for missing values', () => {
    expect(fmtCost(undefined)).toBeUndefined();
  });

  it('hides exact zero instead of showing $0', () => {
    expect(fmtCost(0)).toBeUndefined();
  });

  it('keeps precision for tiny costs', () => {
    expect(fmtCost(0.0001234)).toBe('$0.000123');
    expect(fmtCost(0.00000042)).toBe('$4.20e-7');
  });

  it('formats larger costs without trailing zeros', () => {
    expect(fmtCost(0.123456)).toBe('$0.12346');
  });
});

describe('resolveObservationCost', () => {
  it('prefers totalCost over calculatedTotalCost', () => {
    expect(resolveObservationCost({
      id: 'o1',
      traceId: 't1',
      totalCost: 0.0012,
      calculatedTotalCost: 0,
    })).toBe(0.0012);
  });

  it('uses costDetails.total when present', () => {
    expect(resolveObservationCost({
      id: 'o1',
      traceId: 't1',
      costDetails: { total: 0.00045, input: 0.0002, output: 0.00025 },
    })).toBe(0.00045);
  });

  it('sums costDetails when total key is absent', () => {
    expect(resolveObservationCost({
      id: 'o1',
      traceId: 't1',
      costDetails: { input: 0.0002, output: 0.0003 },
    })).toBeCloseTo(0.0005);
  });
});

describe('highlightJson', () => {
  it('wraps keys, strings, numbers and keywords', () => {
    const html = highlightJson('{"ok": true, "n": 1, "msg": "hi"}');
    expect(html).toContain('json-key');
    expect(html).toContain('json-str');
    expect(html).toContain('json-kw');
    expect(html).toContain('json-num');
  });
});

describe('renderMarkdownLite', () => {
  it('renders bold, italic, and inline code safely', () => {
    const html = renderMarkdownLite('say **hi** and *bye* with `code` <script>');
    expect(html).toContain('<strong>hi</strong>');
    expect(html).toContain('<em>bye</em>');
    expect(html).toContain('<code class="fmt-inline-code">code</code>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>');
  });

  it('renders fenced code blocks', () => {
    const html = renderMarkdownLite('before\n```\nconst x = 1\n```\nafter');
    expect(html).toContain('fmt-code-block');
    expect(html).toContain('const x = 1');
  });
});

describe('tool call detection', () => {
  it('detects function-style tool calls', () => {
    expect(isToolCall({
      id: 'call_1',
      type: 'function',
      function: { name: 'search', arguments: '{"q":"x"}' },
    })).toBe(true);
  });

  it('detects name/arguments objects', () => {
    expect(isToolCall({ name: 'lookup', arguments: { id: 1 } })).toBe(true);
  });

  it('rejects plain objects', () => {
    expect(isToolCall({ foo: 'bar' })).toBe(false);
  });

  it('detects tool call lists', () => {
    expect(isToolCallList([{ name: 'a', arguments: {} }, { name: 'b', args: {} }])).toBe(true);
  });
});

describe('isChatMessages', () => {
  it('accepts role/content arrays', () => {
    expect(isChatMessages([{ role: 'user', content: 'hi' }])).toBe(true);
  });

  it('rejects mixed arrays', () => {
    expect(isChatMessages([{ role: 'user' }, 'nope'])).toBe(false);
  });
});

describe('renderFormatted', () => {
  it('renders chat bubbles for message arrays', () => {
    const html = renderFormatted([
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: '**world**', tool_calls: [{ name: 'search', arguments: '{"q":"x"}' }] },
    ]);
    expect(html).toContain('fmt-msg-user');
    expect(html).toContain('fmt-msg-assistant');
    expect(html).toContain('<strong>world</strong>');
    expect(html).toContain('fmt-tool');
    expect(html).toContain('search');
  });

  it('renders tool call cards for tool call lists', () => {
    const html = renderFormatted([{ name: 'ping', arguments: { n: 1 } }]);
    expect(html).toContain('fmt-tool-name');
    expect(html).toContain('ping');
    expect(html).toContain('json-key');
  });

  it('renders object key-value tables', () => {
    const html = renderFormatted({ temperature: 0.2, model: 'gpt' });
    expect(html).toContain('fmt-kv-table');
    expect(html).toContain('temperature');
    expect(html).toContain('0.2');
  });

  it('renders call_llm payloads without dumping config JSON', () => {
    const html = renderFormatted({
      model: 'gemini-2.5-flash',
      config: {
        temperature: 0.2,
        maxOutputTokens: 1024,
        http_options: { timeout: 60, headers: { a: 'b' } },
        labels: { env: 'prod' },
      },
      contents: [
        { role: 'user', parts: [{ text: 'ola' }] },
        { role: 'model', parts: [{ text: 'oi' }] },
      ],
    });
    expect(html).toContain('fmt-llm-model');
    expect(html).toContain('gemini-2.5-flash');
    expect(html).toContain('fmt-chip');
    expect(html).toContain('temperature');
    expect(html).toContain('0.2');
    expect(html).toContain('fmt-msg-user');
    expect(html).toContain('ola');
    expect(html).not.toContain('http_options');
    expect(html).not.toContain('timeout');
  });
});

describe('renderToolCall', () => {
  it('parses stringified arguments as JSON', () => {
    const html = renderToolCall({
      id: 'c1',
      function: { name: 'lookup', arguments: '{"city":"SP"}' },
    });
    expect(html).toContain('lookup');
    expect(html).toContain('json-str');
    expect(html).toContain('c1');
  });
});

describe('renderObsJson', () => {
  it('pretty-prints objects with highlighting', () => {
    const html = renderObsJson({ a: 1 });
    expect(html).toContain('json-block');
    expect(html).toContain('json-key');
  });
});

describe('renderFieldWithToggle', () => {
  it('defaults to formatted view and exposes copy hook', () => {
    const html = renderFieldWithToggle({ hello: 'world' }, 'fld-1');
    expect(html).toContain('data-view="fmt"');
    expect(html).toContain('field-tab active');
    expect(html).toContain('id="fld-1-fmt"');
    expect(html).toContain('style="display:none"');
    expect(html).toContain('id="fld-1-json"');
    expect(html).toContain('data-copy-field="fld-1"');
    expect(html.indexOf('Formatted')).toBeLessThan(html.indexOf('>JSON<'));
  });
});

describe('extractPrimaryText / renderIoSection', () => {
  it('promotes query and keeps scalar meta as chips', () => {
    const extracted = extractPrimaryText({
      query: 'manda um oi',
      user_id: '123',
      channel: 'whatsapp',
    });
    expect(extracted?.primary).toBe('manda um oi');
    expect(extracted?.meta).toEqual([
      { key: 'user_id', value: '123' },
      { key: 'channel', value: 'whatsapp' },
    ]);
  });

  it('renders user/assistant turns with prose and role styling', () => {
    const inputHtml = renderIoSection({ query: 'manda um oi', user_id: '42' }, 'fld-in', 'input');
    const outputHtml = renderIoSection('Oi! Tudo bem?', 'fld-out', 'output');
    expect(inputHtml).toContain('io-turn-user');
    expect(inputHtml).toContain('manda um oi');
    expect(inputHtml).toContain('fmt-chip');
    expect(inputHtml).toContain('user_id');
    expect(outputHtml).toContain('io-turn-assistant');
    expect(outputHtml).toContain('Oi! Tudo bem?');
  });
});

describe('fmtScoreValue / renderScores', () => {
  it('prefers stringValue and formats numeric scores', () => {
    expect(fmtScoreValue({ id: '1', name: 'label', stringValue: 'pass' })).toBe('pass');
    expect(fmtScoreValue({ id: '2', name: 'n', value: 1 })).toBe('1');
    expect(fmtScoreValue({ id: '3', name: 'f', value: 0.1234 })).toBe('0.12');
  });

  it('filters observation scores by observationId', () => {
    const scores: LangfuseScore[] = [
      { id: 's1', name: 'trace_score', value: 1 },
      { id: 's2', name: 'span_score', observationId: 'obs-1', value: 0.9 },
      { id: 's3', name: 'other', observationId: 'obs-2', value: 0.1 },
    ];
    const spanHtml = renderScores(scores, 'obs-1');
    expect(spanHtml).toContain('span_score');
    expect(spanHtml).not.toContain('trace_score');
    expect(spanHtml).not.toContain('other');

    const traceHtml = renderScores(scores);
    expect(traceHtml).toContain('trace_score');
    expect(traceHtml).not.toContain('span_score');
  });
});

describe('resolveTtftMs', () => {
  it('uses timeToFirstToken seconds when value is small', () => {
    expect(resolveTtftMs({
      id: 'o1',
      traceId: 't1',
      timeToFirstToken: 0.42,
    })).toBeCloseTo(420);
  });

  it('derives TTFT from completionStartTime', () => {
    expect(resolveTtftMs({
      id: 'o1',
      traceId: 't1',
      startTime: '2026-07-24T12:00:00.000Z',
      completionStartTime: '2026-07-24T12:00:00.250Z',
    })).toBe(250);
  });
});

describe('parseTraceMetadata / curateTraceMetadata / renderTraceMetaBar', () => {
  it('parses JSON-string metadata', () => {
    expect(parseTraceMetadata('{"agent":"bot"}')).toEqual({ agent: 'bot' });
  });

  it('hides OTel resource noise and keeps useful scalars', () => {
    const curated = curateTraceMetadata({
      stream_id: 'e189ebbd-deb2-57fa-8e93-813e8f1b00c5',
      chatbot_id: 'mora_chatbot',
      resourceAttributes: {
        'k8s.namespace.name': 'staging',
        'service.name': 'agentic-chatbot-service',
      },
      attributes: { public_key: 'pk-lf-secret' },
    });
    expect(curated.highlights).toEqual([
      { key: 'stream_id', value: 'e189ebbd-deb2-57fa-8e93-813e8f1b00c5' },
      { key: 'chatbot_id', value: 'mora_chatbot' },
    ]);
    expect(curated.hasHidden).toBe(true);
  });

  it('renders quiet facts and collapses full metadata', () => {
    const trace: LangfuseTrace = {
      id: 'trace-1',
      userId: '7c979619-f1a0-41cb-8db1-a385072e9a37',
      environment: 'production',
      release: '05c0767@cedcefb636778f43d82c7eade3beb622',
      version: 'staging-serving-05c0767',
      tags: ['whatsapp'],
      metadata: {
        stream_id: 'e189ebbd-deb2-57fa-8e93-813e8f1b00c5',
        chatbot_id: 'mora_chatbot',
        resourceAttributes: { 'k8s.namespace.name': 'staging' },
      },
      scores: [{ id: 's1', name: 'quality', value: 0.8 }],
    };
    const html = renderTraceMetaBar(trace);
    expect(html).toContain('trace-facts');
    expect(html).toContain('7c979619…');
    expect(html).toContain('mora_chatbot');
    expect(html).toContain('stream_id');
    expect(html).toContain('quality');
    expect(html).toContain('All metadata');
    expect(html).not.toContain('TRACE METADATA');
    expect(html.indexOf('k8s.namespace.name')).toBeGreaterThan(html.indexOf('All metadata'));
    expect(html).not.toContain('trace-chip');
  });
});

describe('renderSpanDetailMeta', () => {
  it('includes id, timing, level, model, tokens and cost', () => {
    const obs: LangfuseObservation = {
      id: 'obs-abc-123',
      traceId: 't1',
      startTime: '2026-07-24T12:00:00.000Z',
      endTime: '2026-07-24T12:00:01.250Z',
      level: 'ERROR',
      model: 'gpt-4.1',
      usage: { input: 10, output: 20 },
      calculatedTotalCost: 0.0042,
    };
    const html = renderSpanDetailMeta(obs);
    expect(html).toContain('obs-abc-123');
    expect(html).toContain('ERROR');
    expect(html).toContain('gpt-4.1');
    expect(html).toContain('↑10 ↓20');
    expect(html).toContain('$0.0042');
    expect(html).toContain('data-copy="obs-abc-123"');
  });

  it('shows prompt, TTFT, usageDetails, cost split and observation scores', () => {
    const obs: LangfuseObservation = {
      id: 'obs-1',
      traceId: 't1',
      startTime: '2026-07-24T12:00:00.000Z',
      completionStartTime: '2026-07-24T12:00:00.100Z',
      promptName: 'system-prompt',
      promptVersion: 3,
      environment: 'staging',
      usageDetails: { cached_tokens: 12, reasoning_tokens: 4 },
      costDetails: { input: 0.0001, output: 0.0002, total: 0.0003 },
    };
    const scores: LangfuseScore[] = [
      { id: 's1', name: 'relevance', observationId: 'obs-1', value: 0.95 },
      { id: 's2', name: 'global', value: 1 },
    ];
    const html = renderSpanDetailMeta(obs, scores);
    expect(html).toContain('system-prompt@3');
    expect(html).toContain('TTFT');
    expect(html).toContain('staging');
    expect(html).toContain('cached_tokens');
    expect(html).toContain('Cost split');
    expect(html).toContain('relevance');
    expect(html).not.toContain('global');
    expect(renderCostBreakdown(obs)).toContain('in $0.0001');
  });
});

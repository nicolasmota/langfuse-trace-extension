import { describe, it, expect } from 'vitest';
import type { LangfuseObservation } from '../langfuse-client.js';
import {
  escHtml,
  extractPrimaryText,
  fmtCost,
  highlightJson,
  isChatMessages,
  isToolCall,
  isToolCallList,
  renderFieldWithToggle,
  renderFormatted,
  renderIoSection,
  renderMarkdownLite,
  renderObsJson,
  renderSpanDetailMeta,
  renderToolCall,
  resolveObservationCost,
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
});

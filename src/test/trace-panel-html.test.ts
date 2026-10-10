import { describe, it, expect } from 'vitest';
import type { LangfuseObservation, LangfuseTrace } from '../langfuse-client.js';
import { buildTracePanelHtml } from '../trace-panel-html.js';

const NOW = Date.parse('2026-07-24T12:00:05.000Z');

function sample(): { traces: LangfuseTrace[]; observations: LangfuseObservation[] } {
  const traces: LangfuseTrace[] = [
    {
      id: 'trace-new',
      name: 'send_user_message',
      timestamp: '2026-07-24T12:00:02.000Z',
      input: 'can you check my order status?',
      output: { assistant_messages: [{ text: 'Sorry, the order system is down.' }] },
      htmlPath: '/project/proj1/traces/trace-new',
    },
    {
      id: 'trace-old',
      name: 'send_user_message',
      timestamp: '2026-07-24T12:00:00.000Z',
      input: 'hello',
    },
  ];
  const observations: LangfuseObservation[] = [
    { id: 'root', traceId: 'trace-new', name: 'platform_run', type: 'SPAN', startTime: '2026-07-24T12:00:02.000Z', endTime: '2026-07-24T12:00:02.486Z' },
    {
      id: 'gen', traceId: 'trace-new', parentObservationId: 'root', name: 'call_llm', type: 'GENERATION',
      model: 'litellm_proxy/openai/o4-mini',
      startTime: '2026-07-24T12:00:02.070Z', endTime: '2026-07-24T12:00:02.153Z',
      completionStartTime: '2026-07-24T12:00:02.101Z',
      usageDetails: { input: 3156, output: 130, total: 3286, cached_tokens: 2048, reasoning_tokens: 64 },
      costDetails: { input: 0.00032, output: 0.00023, total: 0.00055 },
      input: [{ role: 'user', content: 'can you check my order status?' }],
      output: { content: 'ok' },
    },
    {
      id: 'tool', traceId: 'trace-new', parentObservationId: 'root', name: 'get_order_status', type: 'TOOL',
      level: 'ERROR', statusMessage: 'TimeoutError: orders-api did not respond',
      startTime: '2026-07-24T12:00:02.160Z', endTime: '2026-07-24T12:00:02.340Z',
      input: { order_id: 'A-20931' },
    },
    { id: 'old-root', traceId: 'trace-old', name: 'platform_run', type: 'SPAN', startTime: '2026-07-24T12:00:00.000Z', endTime: '2026-07-24T12:00:00.200Z' },
  ];
  return { traces, observations };
}

describe('buildTracePanelHtml', () => {
  const { traces, observations } = sample();
  const html = buildTracePanelHtml('sess-1', traces, observations, 'https://cloud.langfuse.com', NOW);

  it('renders header stats, error pill and the session link from htmlPath', () => {
    expect(html).toContain('<strong>2</strong> traces');
    expect(html).toContain('1 error');
    expect(html).toContain('https://cloud.langfuse.com/project/proj1/sessions/sess-1');
    expect(html).toContain(`data-updated="${NOW}"`);
  });

  it('shows the user message preview and opens only the newest trace by default', () => {
    expect(html).toContain('“can you check my order status?”');
    expect(html).toContain('“hello”');
    const sections = html.match(/<section class="trace-section[^"]*"/g) ?? [];
    expect(sections).toHaveLength(2);
    expect(sections[0]).not.toContain('collapsed');
    expect(sections[1]).toContain('collapsed');
  });

  it('renders span rows with filter metadata and error styling', () => {
    expect(html).toContain('data-group="llm"');
    expect(html).toContain('data-group="tool"');
    expect(html).toContain('class="obs-row is-error"');
    expect(html).toContain('data-error="1"');
    expect(html).toContain('data-search="call_llm generation litellm_proxy/openai/o4-mini gen"');
  });

  it('renders compact tokens, cache dot, cost and TTFT split', () => {
    expect(html).toContain('3.2k → 130');
    expect(html).toContain('cache-dot');
    expect(html).toContain('$0.00055');
    expect(html).toContain('linear-gradient(90deg');
  });

  it('renders the Usage section, error callout and empty-output hint in the detail', () => {
    expect(html).toContain('class="usage"');
    expect(html).toContain('65% of input');
    expect(html).toContain('class="obs-error"');
    expect(html).toContain('TimeoutError: orders-api did not respond');
    expect(html).toContain('No output recorded');
  });

  it('renders filter counts and a time axis', () => {
    expect(html).toContain('data-group="llm" aria-pressed="false"><span class="dot"');
    expect(html).toMatch(/class="tick-label"[^>]*>0</);
    expect(html).toContain('id="filter-input"');
  });

  it('escapes untrusted text', () => {
    const evil = buildTracePanelHtml('<img src=x>', [{ id: 't', name: '<script>alert(1)</script>' }], [], '', NOW);
    expect(evil).not.toContain('<img src=x>');
    expect(evil).not.toContain('<script>alert(1)</script>');
  });

  it('renders an empty state without traces', () => {
    const empty = buildTracePanelHtml('sess', [], [], '', NOW);
    expect(empty).toContain('No traces found for this session.');
    expect(empty).not.toContain('id="filter-input"');
  });

  it('embeds syntactically valid client script and a nonce-guarded CSP', () => {
    const script = /<script nonce="([^"]+)">([\s\S]*)<\/script>/.exec(html);
    expect(script).not.toBeNull();
    expect(() => new Function(script![2]!)).not.toThrow();
    expect(html).toContain(`script-src 'nonce-${script![1]}'`);
  });
});

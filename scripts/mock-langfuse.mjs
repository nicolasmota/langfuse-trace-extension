#!/usr/bin/env node
/**
 * Tiny stand-in for the Langfuse public API, for trying the extension without a Langfuse instance.
 *
 *   node scripts/mock-langfuse.mjs            # listens on http://127.0.0.1:3000
 *   PORT=3100 node scripts/mock-langfuse.mjs
 *
 * Serves the endpoints the extension uses (sessions list/detail, traces list, single trace) with
 * a few demo sessions: an error in a tool call, cached + reasoning tokens (OpenAI style),
 * additive cache reads (Anthropic style), nested agent/tool/retriever spans and empty I/O.
 * Credentials are not checked.
 */
import http from 'node:http';

const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? '127.0.0.1';
const PROJECT_ID = 'proj-demo';
const NOW = Date.now();
const MIN = 60_000;

const iso = (t) => new Date(t).toISOString();

/** Builds a trace from a compact span spec; `start`/`dur` are ms relative to the trace start. */
function makeTrace({ id, sessionId, name = 'send_user_message', at, input, output, spans, userId, tags, scores, metadata }) {
  const observations = spans.map((s) => {
    const base = {
      id: `${id}-${s.key}`,
      traceId: id,
      parentObservationId: s.parent ? `${id}-${s.parent}` : undefined,
      name: s.name,
      type: s.type ?? 'SPAN',
      startTime: iso(at + s.start),
      endTime: iso(at + s.start + s.dur),
      latency: s.dur / 1000,
      level: s.level ?? 'DEFAULT',
      statusMessage: s.statusMessage,
      input: s.input,
      output: s.output,
      metadata: s.metadata,
      model: s.model,
      modelParameters: s.modelParameters,
      promptName: s.promptName,
      promptVersion: s.promptVersion,
      usageDetails: s.usageDetails,
      costDetails: s.costDetails,
      totalCost: s.costDetails?.total,
      environment: 'production',
    };
    if (s.ttft !== undefined) { base.completionStartTime = iso(at + s.start + s.ttft); }
    if (s.legacyUsage) { base.usage = s.legacyUsage; }
    return base;
  });
  const end = Math.max(...spans.map((s) => s.start + s.dur));
  const totalCost = observations
    .filter((o) => o.type === 'GENERATION')
    .reduce((sum, o) => sum + (o.totalCost ?? 0), 0);
  return {
    id,
    name,
    timestamp: iso(at),
    sessionId,
    userId,
    release: '2.3.1',
    environment: 'production',
    input,
    output,
    metadata,
    tags,
    latency: end / 1000,
    totalCost: totalCost || undefined,
    htmlPath: `/project/${PROJECT_ID}/traces/${id}`,
    scores: (scores ?? []).map((sc, i) => ({ id: `${id}-score-${i}`, traceId: id, observationId: null, dataType: 'NUMERIC', ...sc })),
    observations,
  };
}

const chat = (text) => ({ assistant_messages: [{ text, metadata: null }] });

// ── Session 1: order status — error in a tool call, cached + reasoning tokens ─────────────────
const s1 = 'demo-order-status';
const s1Traces = [
  makeTrace({
    id: 't1-hello', sessionId: s1, at: NOW - 6 * MIN, input: 'hello', output: chat("Hi! I'm Ava, your support assistant. How can I help you today?"),
    userId: 'u_1842', tags: ['support', 'web'],
    spans: [
      { key: 'run', name: 'platform_run', start: 0, dur: 208 },
      { key: 'mod', name: 'chat_moderation', type: 'GENERATION', parent: 'run', start: 4, dur: 55, ttft: 20, model: 'litellm_proxy/openai/gpt-4o-mini',
        usageDetails: { input: 742, output: 23, total: 765 }, costDetails: { input: 0.00011, output: 0.00003, total: 0.00014 },
        input: [{ role: 'user', content: 'hello' }], output: { role: 'assistant', content: 'safe' } },
      { key: 'agent', name: 'invoke_agent support_chatbot_supervisor', type: 'AGENT', parent: 'run', start: 62, dur: 138 },
      { key: 'llm', name: 'call_llm', type: 'GENERATION', parent: 'agent', start: 66, dur: 83, ttft: 31, model: 'litellm_proxy/openai/gpt-4o-mini',
        usageDetails: { input: 3156, output: 130, total: 3286 }, costDetails: { input: 0.00047, output: 0.00008, total: 0.00055 },
        input: [{ role: 'system', content: 'You are Ava, a support assistant.' }, { role: 'user', content: 'hello' }], output: { role: 'assistant', content: "Hi! I'm Ava." } },
      { key: 'send', name: 'send_chatbot_message', parent: 'run', start: 196, dur: 11 },
    ],
  }),
  makeTrace({
    id: 't1-policy', sessionId: s1, at: NOW - 4 * MIN, input: "what's your return policy for opened items?", output: chat('Opened items can be returned within 30 days if unused.'),
    userId: 'u_1842', tags: ['support', 'web'],
    spans: [
      { key: 'run', name: 'platform_run', start: 0, dur: 251 },
      { key: 'agent', name: 'invoke_agent support_chatbot_supervisor', type: 'AGENT', parent: 'run', start: 6, dur: 240 },
      { key: 'search', name: 'search_policies', type: 'RETRIEVER', parent: 'agent', start: 10, dur: 64,
        input: { query: 'return policy opened items' }, output: { documents: [{ title: 'Returns', score: 0.91 }] } },
      { key: 'llm', name: 'generate_response', type: 'GENERATION', parent: 'agent', start: 80, dur: 160, ttft: 44, model: 'litellm_proxy/openai/o4-mini',
        promptName: 'system-prompt', promptVersion: 3, modelParameters: { temperature: 0.2, max_tokens: 1024 },
        usageDetails: { input: 3156, output: 130, total: 3286, cached_tokens: 2048, reasoning_tokens: 64 },
        costDetails: { input: 0.00032, output: 0.00023, total: 0.00055 },
        input: [{ role: 'system', content: 'You are Ava, a support assistant.' }, { role: 'user', content: "what's your return policy for opened items?" }],
        output: { role: 'assistant', content: 'Opened items can be returned within 30 days if unused.' } },
    ],
  }),
  makeTrace({
    id: 't1-order', sessionId: s1, at: NOW - 2 * MIN, input: "can you check my order status? it's A-20931",
    output: chat("Sorry — I couldn't reach our order system just now. Want me to try again in a minute, or connect you with an agent?"),
    userId: 'u_1842', tags: ['support', 'web'], scores: [{ name: 'helpfulness', value: 0.4 }],
    metadata: { channel: 'web', locale: 'en-US', resourceAttributes: { 'service.name': 'chatbot' } },
    spans: [
      { key: 'run', name: 'platform_run', start: 0, dur: 486 },
      { key: 'mod', name: 'chat_moderation', type: 'GENERATION', parent: 'run', start: 4, dur: 55, ttft: 20, model: 'litellm_proxy/openai/gpt-4o-mini',
        usageDetails: { input: 742, output: 23, total: 765 }, costDetails: { total: 0.00014 } },
      { key: 'agent', name: 'invoke_agent support_chatbot_supervisor', type: 'AGENT', parent: 'run', start: 62, dur: 402 },
      { key: 'llm', name: 'call_llm', type: 'GENERATION', parent: 'agent', start: 70, dur: 83, ttft: 31, model: 'litellm_proxy/openai/o4-mini',
        promptName: 'system-prompt', promptVersion: 3,
        usageDetails: { input: 3156, output: 130, total: 3286, cached_tokens: 2048, reasoning_tokens: 64 },
        costDetails: { input: 0.00032, output: 0.00023, total: 0.00055 },
        input: [{ role: 'system', content: 'You are Ava, a support assistant. Use tools before answering.' }, { role: 'user', content: "can you check my order status? it's A-20931" }],
        output: { role: 'assistant', tool_calls: [{ id: 'call_9xk2', type: 'function', function: { name: 'get_order_status', arguments: '{"order_id":"A-20931"}' } }] } },
      { key: 'tool', name: 'get_order_status', type: 'TOOL', parent: 'agent', start: 160, dur: 180, level: 'ERROR',
        statusMessage: 'TimeoutError: orders-api did not respond within 150 ms (attempt 2 of 2)',
        input: { order_id: 'A-20931', include_items: true }, metadata: { retries: 2, endpoint: 'orders-api/v2/status' } },
      { key: 'gen', name: 'generate_response', type: 'GENERATION', parent: 'agent', start: 345, dur: 112, ttft: 40, model: 'litellm_proxy/openai/o4-mini',
        usageDetails: { input: 3512, output: 157, total: 3669 }, costDetails: { total: 0.00062 },
        input: [{ role: 'user', content: 'tool error: timeout' }], output: { role: 'assistant', content: "Sorry — I couldn't reach our order system just now." } },
      { key: 'send', name: 'send_chatbot_message', parent: 'run', start: 468, dur: 14 },
    ],
  }),
];

// ── Session 2: Anthropic-style cache reads (counted on top of input) ─────────────────────────
const s2 = 'demo-password-reset';
const s2Traces = [
  makeTrace({
    id: 't2-reset', sessionId: s2, at: NOW - 70 * MIN, input: [{ role: 'user', content: 'I need to reset my password' }],
    output: { role: 'assistant', content: "I've sent a reset link to your email." }, userId: 'u_77', tags: ['account'],
    spans: [
      { key: 'run', name: 'handle_request', start: 0, dur: 1840 },
      { key: 'llm', name: 'claude_call', type: 'GENERATION', parent: 'run', start: 20, dur: 1700, ttft: 420, model: 'anthropic/claude-sonnet',
        usageDetails: { input: 1108, output: 130, total: 3286, cache_read_input_tokens: 2048 },
        costDetails: { input: 0.0021, output: 0.0019, total: 0.004 },
        input: [{ role: 'user', content: 'I need to reset my password' }], output: { role: 'assistant', content: "I've sent a reset link to your email." } },
      { key: 'mail', name: 'send_reset_email', type: 'TOOL', parent: 'run', start: 1730, dur: 90, input: { to: 'u***@example.com' }, output: { queued: true } },
    ],
  }),
  makeTrace({
    id: 't2-followup', sessionId: s2, at: NOW - 66 * MIN, input: 'thanks, got it', output: 'Anytime!', userId: 'u_77',
    spans: [{ key: 'run', name: 'handle_request', start: 0, dur: 640 }],
  }),
];

// ── Session 3: long UUID id, legacy `usage` only, spans without I/O ──────────────────────────
const s3 = '0f9c2a6d-77b1-4e0a-9c11-5d2b8e3a4f10';
const s3Traces = [
  makeTrace({
    id: 't3-batch', sessionId: s3, name: 'nightly_batch', at: NOW - 3 * 60 * MIN, input: undefined, output: undefined,
    spans: [
      { key: 'run', name: 'nightly_batch', type: 'CHAIN', start: 0, dur: 5200 },
      { key: 'a', name: 'embed_documents', type: 'GENERATION', parent: 'run', start: 100, dur: 2400, model: 'text-embedding-3-small', legacyUsage: { input: 18000, output: 0, total: 18000 } },
      { key: 'b', name: 'summarize', type: 'GENERATION', parent: 'run', start: 2600, dur: 2500, model: 'gpt-4o-mini', legacyUsage: { input: 6400, output: 420, total: 6820 }, level: 'WARNING', statusMessage: 'Output truncated at max_tokens' },
    ],
  }),
];

const sessions = [
  { id: s1, createdAt: iso(NOW - 6 * MIN), projectId: PROJECT_ID, environment: 'production', traces: s1Traces },
  { id: s2, createdAt: iso(NOW - 70 * MIN), projectId: PROJECT_ID, environment: 'production', traces: s2Traces },
  { id: s3, createdAt: iso(NOW - 3 * 60 * MIN), projectId: PROJECT_ID, environment: 'staging', traces: s3Traces },
  { id: 'demo-empty-session', createdAt: iso(NOW - 2 * 24 * 60 * MIN), projectId: PROJECT_ID, environment: 'staging', traces: [] },
];
const allTraces = sessions.flatMap((s) => s.traces);
const withoutObservations = ({ observations, ...rest }) => ({ ...rest, observations: observations.map((o) => o.id) });

function route(url) {
  const { pathname, searchParams } = new URL(url, `http://${HOST}:${PORT}`);
  if (pathname === '/api/public/sessions') {
    const limit = Number(searchParams.get('limit') ?? 10);
    return { data: sessions.slice(0, limit).map(({ traces, ...s }) => s), meta: { page: 1, limit, totalItems: sessions.length } };
  }
  let m = /^\/api\/public\/sessions\/(.+)$/.exec(pathname);
  if (m) {
    const session = sessions.find((s) => s.id === decodeURIComponent(m[1]));
    return session ? { ...session, traces: session.traces.map(withoutObservations) } : null;
  }
  if (pathname === '/api/public/traces') {
    const sid = searchParams.get('sessionId');
    return { data: allTraces.filter((t) => !sid || t.sessionId === sid).map(withoutObservations) };
  }
  m = /^\/api\/public\/traces\/(.+)$/.exec(pathname);
  if (m) { return allTraces.find((t) => t.id === decodeURIComponent(m[1])) ?? null; }
  return null;
}

http.createServer((req, res) => {
  const body = route(req.url ?? '/');
  console.log(`${body ? 200 : 404} ${req.method} ${req.url}`);
  res.writeHead(body ? 200 : 404, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body ?? { message: 'Not found' }));
}).listen(PORT, HOST, () => {
  console.log(`Mock Langfuse API on http://${HOST}:${PORT}  (${sessions.length} demo sessions)`);
  console.log('Set "langfuse.host" to this URL, then open the Langfuse sidebar.');
});

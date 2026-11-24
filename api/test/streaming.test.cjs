require('reflect-metadata');
const assert = require('node:assert/strict');
const { test, before, after } = require('node:test');
const { Module, ValidationPipe } = require('@nestjs/common');
const { ConfigService } = require('@nestjs/config');
const { NestFactory } = require('@nestjs/core');
const { GeminiService } = require('../dist/modules/documents/services/gemini.service');
const { GeminiStreamingService } = require('../dist/modules/documents/services/gemini-streaming.service');
const { DocumentsService } = require('../dist/modules/documents/services/documents.service');
const { DocumentsController } = require('../dist/modules/documents/controllers/documents.controller');

const question = 'How does DNA store information?';
const passage = {
  id: 'b05e2d2f-6ec1-4cc2-b591-44134d6c2c11', document_id: 'a05e2d2f-6ec1-4cc2-b591-44134d6c2c11',
  position: 0, title: 'Biology', edition: null, source_url: null, heading_path: ['Chapter 1', 'DNA'],
  page_start: 12, page_end: 13, content: 'DNA stores information in its sequence of bases.', similarity: 0.9,
};
const config = (overrides = {}) => new ConfigService({
  GEMINI_API_KEY: 'test-key', GEMINI_MODEL: 'gemini-3.5-flash-lite', GEMINI_TIMEOUT_MS: 30000, GEMINI_STREAM_MAX_MS: 120000, ...overrides,
});
const streamService = (configuration = config()) => new GeminiStreamingService(new GeminiService(configuration), configuration);
const frame = (text, finishReason) => `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text }] }, ...(finishReason && { finishReason }) }] })}\r\n\r\n`;
const generated = { answer: 'DNA stores information in its sequence of bases. [1]', answerable: true, citations: [1] };
const encoded = (answer = generated) => {
  const json = JSON.stringify(answer);
  return frame(json.slice(0, 20)) + frame(json.slice(20), 'STOP');
};
function streamResponse(text, bytewise = false, onCancel) {
  const bytes = new TextEncoder().encode(text);
  return new Response(new ReadableStream({
    start(controller) {
      if (bytewise) for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
      else controller.enqueue(bytes);
      controller.close();
    },
    cancel: onCancel,
  }), { headers: { 'Content-Type': 'text/event-stream' } });
}
async function collect(service = streamService(), passages = [passage], signal = new AbortController().signal) {
  const events = [];
  for await (const event of service.stream(question, passages, signal)) events.push(event);
  return events;
}

test('stream returns textbook chunks before making a Gemini request', async (t) => {
  const fetchMock = t.mock.method(globalThis, 'fetch', async (url) => {
    assert.match(url, /:streamGenerateContent\?alt=sse$/);
    return streamResponse(encoded());
  });
  const iterator = streamService().stream(question, [passage], new AbortController().signal);
  const first = await iterator.next();
  assert.equal(first.value.event, 'chunks');
  assert.deepEqual(first.value.data.chunks, [{ citation_id: 1, ...passage }]);
  assert.equal(fetchMock.mock.callCount(), 0);
  const remaining = [];
  for await (const event of iterator) remaining.push(event);
  assert.equal(remaining[0].event, 'delta');
  assert.equal(remaining.filter(e => e.event === 'delta').map(e => e.data.text).join(''), generated.answer);
  assert.equal(remaining.at(-1).event, 'done');
  assert.equal(remaining.at(-1).data.answer, generated.answer);
  assert.deepEqual(remaining.at(-1).data.sources, [{ citation_id: 1, ...passage }]);
});

test('stream handles fragmented SSE, UTF-8, JSON escapes, CRLF, comments, and trailing frames', async (t) => {
  const answer = { ...generated, answer: 'DNA "bases"\nCafé 🧬 \\ [1]' };
  // Force JSON escape sequences and surrogate pairs to cross Gemini frame boundaries.
  const json = JSON.stringify(answer).replace('🧬', '\\ud83e\\uddec');
  let wire = ': ping\r\n\r\n';
  for (let index = 0; index < json.length; index++) wire += frame(json[index], index === json.length - 1 ? 'STOP' : undefined);
  t.mock.method(globalThis, 'fetch', async () => streamResponse(wire.trimEnd(), true));
  const events = await collect();
  assert.equal(events.at(-1).event, 'done');
  assert.equal(events.filter(e => e.event === 'delta').map(e => e.data.text).join(''), answer.answer);
  assert.equal(events.at(-1).data.answer, answer.answer);
});

test('empty retrieval skips Gemini and terminates the stream', async (t) => {
  const requests = t.mock.method(globalThis, 'fetch', async () => { throw new Error('must not call'); });
  const events = await collect(streamService(), []);
  assert.deepEqual(events.map(e => e.event), ['chunks', 'done']);
  assert.equal(events.at(-1).data.answerable, false);
  assert.equal(requests.mock.callCount(), 0);
});

test('invalid or incomplete streamed answers preserve chunks and never send a successful final answer', async (t) => {
  const cases = [
    encoded({ ...generated, answer: 'Invented citation [2]', citations: [2] }),
    frame('{"answer":"unfinished'),
    frame(JSON.stringify(generated), 'MAX_TOKENS'),
    'data: not JSON\n\n',
    `data: ${JSON.stringify({ promptFeedback: { blockReason: 'SAFETY' } })}\n\n`,
  ];
  for (const [index, wire] of cases.entries()) {
    await t.test(`failed stream ${index + 1}`, async (st) => {
      st.mock.method(globalThis, 'fetch', async () => streamResponse(wire));
      const events = await collect();
      const result = events.at(-1);
      assert.equal(result.event, 'fallback');
      assert.match(result.data.answer, /DNA stores information/);
      assert.equal(result.data.answer_type, 'extractive');
      assert.equal(result.data.answerable, null);
      assert.deepEqual(result.data.chunks, [{ citation_id: 1, ...passage }]);
      assert.ok(!events.some(e => e.event === 'done'));
    });
  }
});

test('upstream quota failure returns chunks and one fallback without retrying', async (t) => {
  const requests = t.mock.method(globalThis, 'fetch', async () => new Response('SECRET-UPSTREAM-BODY', { status: 429 }));
  const events = await collect();
  assert.deepEqual(events.map(e => e.event), ['chunks', 'fallback']);
  assert.equal(events[1].data.generation_error.statusCode, 429);
  assert.doesNotMatch(JSON.stringify(events), /SECRET-UPSTREAM-BODY|test-key/);
  assert.equal(requests.mock.callCount(), 1);
});

test('idle timeouts preserve chunks while client cancellation stops without a fallback', async (t) => {
  t.mock.method(globalThis, 'fetch', async (_url, { signal }) => new Promise((_resolve, reject) => {
    if (signal.aborted) reject(signal.reason);
    else signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  }));
  const events = await collect(streamService(config({ GEMINI_TIMEOUT_MS: 30 })));
  assert.equal(events.at(-1).event, 'fallback');
  assert.equal(events.at(-1).data.generation_error.statusCode, 504);
  const client = new AbortController();
  const iterator = streamService().stream(question, [passage], client.signal);
  assert.equal((await iterator.next()).value.event, 'chunks');
  const next = iterator.next();
  client.abort();
  assert.equal((await next).done, true);
});

test('active streams reset idle timeout but still respect the total deadline', async (t) => {
  const json = JSON.stringify(generated);
  t.mock.method(globalThis, 'fetch', async (_url, { signal }) => new Response(new ReadableStream({
    start(controller) {
      let index = 0;
      const timer = setInterval(() => {
        const end = Math.min(index + 10, json.length);
        controller.enqueue(new TextEncoder().encode(frame(json.slice(index, end), end === json.length ? 'STOP' : undefined)));
        index = end;
        if (index === json.length) { clearInterval(timer); controller.close(); }
      }, 10);
      signal.addEventListener('abort', () => { clearInterval(timer); try { controller.error(signal.reason); } catch {} }, { once: true });
    },
  })));
  const complete = await collect(streamService(config({ GEMINI_TIMEOUT_MS: 100, GEMINI_STREAM_MAX_MS: 1000 })));
  assert.equal(complete.at(-1).event, 'done');
  const stopped = await collect(streamService(config({ GEMINI_TIMEOUT_MS: 100, GEMINI_STREAM_MAX_MS: 35 })));
  assert.equal(stopped.at(-1).event, 'fallback');
  assert.equal(stopped.at(-1).data.generation_error.statusCode, 504);
});

let app;
let base;
before(async () => {
  const configuration = config();
  const gemini = new GeminiService(configuration);
  const service = new DocumentsService({
    find: async id => id === passage.document_id ? { id } : undefined,
    search: async () => [passage],
  }, {}, {}, { tokenCounter: async () => text => text.split(/\s+/).length, embed: async () => [Array(384).fill(0.1)] }, {},
  gemini, new GeminiStreamingService(gemini, configuration));
  class StreamingTestModule {}
  Module({ controllers: [DocumentsController], providers: [{ provide: DocumentsService, useValue: service }] })(StreamingTestModule);
  app = await NestFactory.create(StreamingTestModule, { logger: false });
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
  await app.listen(0, '127.0.0.1');
  base = await app.getUrl();
});
after(async () => { if (app) await app.close(); });
const postStream = (body, options = {}) => fetch(`${base}/documents/ask/stream`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), ...options,
});

test('HTTP streaming flushes chunks before Gemini responds and streams a validated final answer', async (t) => {
  const original = globalThis.fetch;
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  t.mock.method(globalThis, 'fetch', (url, options) => String(url).startsWith('https://generativelanguage.googleapis.com/')
    ? gate.then(() => streamResponse(encoded())) : original(url, options));
  const response = await postStream({ question });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /text\/event-stream/);
  const reader = response.body.getReader();
  const first = new TextDecoder().decode((await reader.read()).value);
  assert.match(first, /^event: chunks/);
  assert.match(first, /"page_start":12/);
  assert.doesNotMatch(first, /event: delta|event: done/);
  release();
  let rest = '';
  for (;;) {
    const next = await reader.read();
    if (next.done) break;
    rest += new TextDecoder().decode(next.value);
  }
  assert.match(rest, /event: delta/);
  assert.match(rest, /event: done/);
  assert.doesNotMatch(rest, /event: fallback/);
});

test('HTTP streaming validates input and unknown documents before sending event-stream headers', async () => {
  for (const body of [{ question: ' ' }, { question, limit: 11 }, { question, unexpected: true }]) {
    const response = await postStream(body);
    assert.equal(response.status, 400);
    assert.match(response.headers.get('content-type'), /application\/json/);
  }
  assert.equal((await postStream({ question, document_id: passage.id })).status, 404);
});

test('HTTP disconnect aborts the Gemini request', async (t) => {
  const original = globalThis.fetch;
  let upstreamAborted;
  const aborted = new Promise(resolve => { upstreamAborted = resolve; });
  t.mock.method(globalThis, 'fetch', (url, options) => {
    if (!String(url).startsWith('https://generativelanguage.googleapis.com/')) return original(url, options);
    return new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => {
      upstreamAborted(); reject(options.signal.reason);
    }, { once: true }));
  });
  const controller = new AbortController();
  const response = await postStream({ question }, { signal: controller.signal });
  await response.body.getReader().read();
  controller.abort();
  await aborted;
});

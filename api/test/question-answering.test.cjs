require('reflect-metadata');
const assert = require('node:assert/strict');
const { test, before, after } = require('node:test');
const { Module, ValidationPipe } = require('@nestjs/common');
const { ConfigService } = require('@nestjs/config');
const { NestFactory } = require('@nestjs/core');
const { GeminiService } = require('../dist/modules/documents/services/gemini.service');
const { DocumentsService } = require('../dist/modules/documents/services/documents.service');
const { DocumentsController } = require('../dist/modules/documents/controllers/documents.controller');
const { validateEnvironment } = require('../dist/shared/config/environment');
const timers = require('node:timers/promises');

const model = 'gemini-3.1-flash-lite';
const question = 'How does DNA store genetic information?';
const passage = {
  id: 'b05e2d2f-6ec1-4cc2-b591-44134d6c2c11',
  document_id: 'a05e2d2f-6ec1-4cc2-b591-44134d6c2c11',
  position: 0, heading_path: ['Chapter 1', '1.1 DNA'], page_start: 12, page_end: 13,
  content: 'DNA stores genetic information in its sequence of nucleotide bases.',
  title: 'Biology', edition: '2nd', source_url: 'https://books.example/biology.pdf', similarity: 0.91,
};
const generated = { answer: 'DNA stores genetic information in the sequence of its nucleotide bases. [1]', answerable: true, citations: [1] };
const config = (overrides = {}) => new ConfigService({ GEMINI_API_KEY: 'test-key', GEMINI_MODEL: model, GEMINI_TIMEOUT_MS: 30000, ...overrides });
const completion = (answer = generated, finishReason = 'STOP') => ({
  candidates: [{ finishReason, content: { parts: [{ text: JSON.stringify(answer) }] } }],
});
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

test('Gemini receives only retrieved text and provenance, with the API key in a header', async (t) => {
  const fetchMock = t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`);
    assert.equal(options.method, 'POST');
    assert.equal(options.headers['x-goog-api-key'], 'test-key');
    assert.ok(options.signal instanceof AbortSignal);
    const body = JSON.parse(options.body);
    assert.match(body.systemInstruction.parts[0].text, /using only the provided textbook passages/);
    assert.match(body.systemInstruction.parts[0].text, /untrusted data/);
    assert.deepEqual(JSON.parse(body.contents[0].parts[0].text), { question, passages: [{
      citation_id: 1, title: passage.title, edition: passage.edition, heading_path: passage.heading_path,
      page_start: 12, page_end: 13, content: passage.content,
    }] });
    assert.equal(body.generationConfig.responseMimeType, 'application/json');
    assert.deepEqual(body.generationConfig.responseJsonSchema.properties.citations.items.enum, [1]);
    return json(completion());
  });
  const result = await new GeminiService(config()).answer(question, [passage]);
  assert.equal(fetchMock.mock.callCount(), 1);
  assert.deepEqual(result, { question, answer: generated.answer, answerable: true, model, sources: [{ citation_id: 1, ...passage }] });
});

test('citations retain their retrieval IDs and only cited passages are returned', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => json(completion({ ...generated, answer: 'DNA stores information in its bases. [2]', citations: [2] })));
  const second = { ...passage, id: 'c05e2d2f-6ec1-4cc2-b591-44134d6c2c11', page_start: 20, page_end: 20 };
  const result = await new GeminiService(config()).answer(question, [passage, second]);
  assert.deepEqual(result.sources, [{ citation_id: 2, ...second }]);
});

test('empty retrieval and insufficient context return no answer or invented sources', async (t) => {
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => json(completion({
    answer: 'Unsupported text must not be returned.', answerable: false, citations: [],
  })));
  const service = new GeminiService(config());
  const empty = await service.answer(question, []);
  assert.equal(empty.answerable, false);
  assert.deepEqual(empty.sources, []);
  assert.equal(fetchMock.mock.callCount(), 0);
  const insufficient = await service.answer('What is the capital of France?', [passage]);
  assert.equal(insufficient.answerable, false);
  assert.deepEqual(insufficient.sources, []);
  assert.match(insufficient.answer, /do not contain enough information/);
  assert.doesNotMatch(insufficient.answer, /Unsupported/);
});

test('missing configuration fails clearly before a Gemini request', async (t) => {
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => { throw new Error('must not call'); });
  await assert.rejects(new GeminiService(config({ GEMINI_API_KEY: '' })).answer(question, [passage]),
    (error) => error.getStatus() === 503 && /GEMINI_API_KEY/.test(error.message));
  assert.equal(fetchMock.mock.callCount(), 0);
});

test('invalid citations, malformed, blocked, empty, and truncated Gemini responses are rejected', async (t) => {
  const cases = [
    completion({ ...generated, citations: [2], answer: 'Invented source. [2]' }),
    completion({ ...generated, citations: [], answer: 'No citations.' }),
    completion({ ...generated, answer: 'Missing inline citation.' }),
    completion({ ...generated, answer: 'Extra invented citation. [1][2]' }),
    completion({ ...generated, citations: [1.5] }),
    completion({ ...generated, answer: '' }),
    completion(generated, 'MAX_TOKENS'),
    completion(generated, 'SAFETY'),
    { promptFeedback: { blockReason: 'SAFETY' } },
    { candidates: [] },
    { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'not JSON' }] } }] },
    null,
  ];
  for (const [index, body] of cases.entries()) {
    await t.test(`invalid response ${index + 1}`, async (st) => {
      st.mock.method(globalThis, 'fetch', async () => json(body));
      await assert.rejects(new GeminiService(config()).answer(question, [passage]), (error) => error.getStatus() === 502);
    });
  }
});

test('thought parts are excluded from the answer', async (t) => {
  const body = completion();
  body.candidates[0].content.parts.unshift({ thought: true, text: 'Private reasoning.' });
  t.mock.method(globalThis, 'fetch', async () => json(body));
  assert.equal((await new GeminiService(config()).answer(question, [passage])).answer, generated.answer);
});

test('upstream failures expose useful statuses without upstream bodies or secrets', async (t) => {
  for (const [status, expected] of [[400, 502], [401, 502], [403, 502], [404, 502], [429, 429], [500, 503], [503, 503]]) {
    await t.test(`Gemini HTTP ${status}`, async (st) => {
      st.mock.method(timers, 'setTimeout', async () => {});
      const fetchMock = st.mock.method(globalThis, 'fetch', async () => json({ error: 'test-key PRIVATE-PASSAGE' }, status));
      await assert.rejects(new GeminiService(config()).answer(question, [passage]), (error) => {
        assert.equal(error.getStatus(), expected);
        assert.doesNotMatch(error.message, /test-key|PRIVATE-PASSAGE/);
        if (status === 429) {
          assert.equal(error.getResponse().upstream_status, 429);
          assert.match(error.getResponse().message, /quota or rate limit exceeded/);
        }
        if (status === 503) {
          assert.equal(error.getResponse().upstream_status, 503);
          assert.equal(error.getResponse().model, model);
          assert.match(error.getResponse().message, /high demand/);
        }
        return true;
      });
      assert.equal(fetchMock.mock.callCount(), status >= 500 ? 3 : 1);
    });
  }
});

test('temporary Gemini server errors retry with backoff and then return the cited answer', async (t) => {
  const sleeps = t.mock.method(timers, 'setTimeout', async () => {});
  let attempts = 0;
  const requests = t.mock.method(globalThis, 'fetch', async () => {
    if (++attempts <= 2) return json({ error: 'overloaded' }, 503);
    return json(completion());
  });
  const result = await new GeminiService(config()).answer(question, [passage]);
  assert.equal(result.answer, generated.answer);
  assert.equal(requests.mock.callCount(), 3);
  assert.equal(sleeps.mock.callCount(), 2);
  const [first, second] = sleeps.mock.calls;
  assert.ok(first.arguments[0] >= 500 && first.arguments[0] < 750);
  assert.ok(second.arguments[0] >= 1000 && second.arguments[0] < 1250);
  assert.strictEqual(first.arguments[2].signal, second.arguments[2].signal);
  assert.strictEqual(first.arguments[2].signal, requests.mock.calls[0].arguments[1].signal);
});

test('the shared timeout also bounds retry waits', async (t) => {
  const requests = t.mock.method(globalThis, 'fetch', async () => json({}, 503));
  t.mock.method(AbortSignal, 'timeout', () => AbortSignal.abort());
  await assert.rejects(new GeminiService(config()).answer(question, [passage]), (error) => error.getStatus() === 504);
  assert.equal(requests.mock.callCount(), 1);
});

test('network errors, unreadable JSON, and timeouts return gateway errors', async (t) => {
  await t.test('network error', async (st) => {
    st.mock.method(globalThis, 'fetch', async () => { throw new TypeError('network failed test-key'); });
    await assert.rejects(new GeminiService(config()).answer(question, [passage]), (error) => error.getStatus() === 502 && !error.message.includes('test-key'));
  });
  await t.test('unreadable JSON', async (st) => {
    st.mock.method(globalThis, 'fetch', async () => new Response('not JSON'));
    await assert.rejects(new GeminiService(config()).answer(question, [passage]), (error) => error.getStatus() === 502);
  });
  await t.test('timeout while reading response', async (st) => {
    st.mock.method(AbortSignal, 'timeout', () => AbortSignal.abort());
    st.mock.method(globalThis, 'fetch', async () => ({ ok: true, json: async () => { throw new Error('aborted'); } }));
    await assert.rejects(new GeminiService(config()).answer(question, [passage]), (error) => error.getStatus() === 504);
  });
});

test('Gemini environment settings have defaults and reject invalid models and timeouts', () => {
  const env = { DATABASE_URL: 'postgresql://localhost/rag' };
  assert.equal(validateEnvironment(env).GEMINI_MODEL, model);
  assert.equal(validateEnvironment(env).GEMINI_TIMEOUT_MS, 30000);
  assert.equal(validateEnvironment({ ...env, GEMINI_TIMEOUT_MS: '60000' }).GEMINI_TIMEOUT_MS, 60000);
  assert.throws(() => validateEnvironment({ ...env, GEMINI_TIMEOUT_MS: '0' }));
  assert.throws(() => validateEnvironment({ ...env, GEMINI_TIMEOUT_MS: '120001' }));
  assert.throws(() => validateEnvironment({ ...env, GEMINI_MODEL: '../other' }));
});

let app;
let base;
let retrievals = [];
let embedded = [];
let availablePassages = [passage];
const serviceConfig = config();
before(async () => {
  const repository = {
    find: async (id) => id === passage.document_id ? { id } : undefined,
    search: async (vector, input) => { retrievals.push({ vector, input }); return availablePassages; },
  };
  const embeddings = {
    tokenCounter: async () => (text) => text.split(/\s+/).length,
    embed: async (texts) => { embedded.push(texts); return [Array(384).fill(0.1)]; },
  };
  const service = new DocumentsService(repository, {}, {}, embeddings, {}, new GeminiService(serviceConfig));
  class HttpQuestionModule {}
  Module({ controllers: [DocumentsController], providers: [{ provide: DocumentsService, useValue: service }] })(HttpQuestionModule);
  app = await NestFactory.create(HttpQuestionModule, { logger: false });
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
  await app.listen(0, '127.0.0.1');
  base = await app.getUrl();
});
after(async () => { if (app) await app.close(); });
const ask = (input) => fetch(`${base}/documents/ask`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
});
function mockGemini(t) {
  const original = globalThis.fetch;
  return t.mock.method(globalThis, 'fetch', (url, options) => String(url).startsWith('https://generativelanguage.googleapis.com/')
    ? Promise.resolve(json(completion())) : original(url, options));
}

test('HTTP ask embeds the trimmed question, retrieves scoped pgvector passages, and returns a cited answer', async (t) => {
  mockGemini(t);
  embedded = [];
  retrievals = [];
  const response = await ask({ question: ` ${question} `, document_id: passage.document_id, limit: 3 });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.deepEqual(embedded, [[question]]);
  assert.deepEqual(retrievals, [{ vector: Array(384).fill(0.1), input: { query: question, document_id: passage.document_id, limit: 3 } }]);
  assert.equal(result.answer, generated.answer);
  assert.equal(result.answerable, true);
  assert.deepEqual(result.sources, [{ citation_id: 1, ...passage }]);
});

test('HTTP ask defaults to five passages across books and skips Gemini when retrieval is empty', async (t) => {
  const original = globalThis.fetch;
  t.mock.method(globalThis, 'fetch', (url, options) => {
    assert.ok(!String(url).startsWith('https://generativelanguage.googleapis.com/'));
    return original(url, options);
  });
  availablePassages = [];
  try {
    const response = await ask({ question });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.answerable, false);
    assert.deepEqual(result.sources, []);
    assert.deepEqual(retrievals.at(-1).input, { query: question, limit: 5, document_id: undefined });
  } finally {
    availablePassages = [passage];
  }
});

test('HTTP ask rejects invalid DTOs, oversized MiniLM queries, and unknown books before generation', async (t) => {
  const original = globalThis.fetch;
  t.mock.method(globalThis, 'fetch', (url, options) => {
    assert.ok(!String(url).startsWith('https://generativelanguage.googleapis.com/'));
    return original(url, options);
  });
  for (const input of [{}, { question: ' ' }, { question, limit: null }, { question, limit: 0 }, { question, limit: 11 },
    { question, limit: 1.5 }, { question, document_id: 'bad-id' }, { question, unexpected: true },
    { question: 'x'.repeat(2001) }, { question: 'long '.repeat(255) }]) {
    const response = await ask(input);
    assert.equal(response.status, 400, JSON.stringify(input));
  }
  assert.equal((await ask({ question, document_id: passage.id })).status, 404);
});

test('HTTP ask with no API key returns 503 before embedding the question', async () => {
  const previous = embedded.length;
  serviceConfig.set('GEMINI_API_KEY', '');
  try {
    assert.equal((await ask({ question })).status, 503);
    assert.equal(embedded.length, previous);
  } finally {
    serviceConfig.set('GEMINI_API_KEY', 'test-key');
  }
});

test('HTTP ask returns retrieved chunks when Gemini is unavailable', async (t) => {
  const original = globalThis.fetch;
  t.mock.method(timers, 'setTimeout', async () => {});
  t.mock.method(globalThis, 'fetch', (url, options) => String(url).startsWith('https://generativelanguage.googleapis.com/')
    ? Promise.resolve(json({ error: 'PRIVATE-UPSTREAM-BODY' }, 503)) : original(url, options));
  const response = await ask({ question });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.status, 'extractive_fallback');
  assert.equal(result.answer_type, 'extractive');
  assert.match(result.answer, /DNA stores genetic information/);
  assert.equal(result.answerable, null);
  assert.deepEqual(result.sources, [{ citation_id: 1, ...passage }]);
  assert.deepEqual(result.chunks, [{ citation_id: 1, ...passage }]);
  assert.equal(result.generation_error.statusCode, 503);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE-UPSTREAM-BODY|test-key/);
});

test('HTTP ask preserves chunks on a Gemini timeout', async (t) => {
  const original = globalThis.fetch;
  t.mock.method(AbortSignal, 'timeout', () => AbortSignal.abort());
  t.mock.method(globalThis, 'fetch', (url, options) => String(url).startsWith('https://generativelanguage.googleapis.com/')
    ? Promise.reject(new Error('aborted')) : original(url, options));
  const response = await ask({ question });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.generation_error.statusCode, 504);
  assert.deepEqual(result.chunks, [{ citation_id: 1, ...passage }]);
  assert.match(result.answer, /DNA stores genetic information/);
  assert.equal(result.answer_type, 'extractive');
});

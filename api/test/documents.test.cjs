require('reflect-metadata');
const assert = require('node:assert/strict');
const { test, before, after } = require('node:test');
const { Module, ValidationPipe } = require('@nestjs/common');
const { NestFactory } = require('@nestjs/core');
const { plainToInstance } = require('class-transformer');
const { validate } = require('class-validator');
const { ChunkingService } = require('../dist/modules/documents/services/chunking.service');
const { PdfExtractionService } = require('../dist/modules/documents/services/pdf-extraction.service');
const { PdfDownloadService, isPublicAddress } = require('../dist/modules/documents/services/pdf-download.service');
const { DocumentsService } = require('../dist/modules/documents/services/documents.service');
const { DocumentsController } = require('../dist/modules/documents/controllers/documents.controller');
const { ImportUrlDto, PaginationDto } = require('../dist/modules/documents/dtos/document.dto');
const { textbookPdf } = require('./helpers.cjs');

const countWords = (text) => text.trim().split(/\s+/).filter(Boolean).length;

test('chunk windows preserve every word, overlap, page provenance, and section boundaries', () => {
  const split = new ChunkingService();
  const words = Array.from({ length: 500 }, (_, index) => `word${index}`);
  const chunks = split.split([
    { content: words.slice(0, 210).join(' '), page: 1, heading_path: ['Chapter 1'] },
    { content: words.slice(210).join(' '), page: 2, heading_path: ['Chapter 1'] },
    { content: 'A different section.', page: 3, heading_path: ['Chapter 2'] },
  ], countWords);
  assert.deepEqual(chunks.map((chunk) => chunk.position), [0, 1, 2, 3]);
  assert.equal(chunks[0].page_start, 1);
  assert.equal(chunks[0].page_end, 2);
  assert.equal(chunks[1].page_start, 1);
  assert.equal(chunks[2].page_start, 2);
  assert.equal(chunks[3].content, 'A different section.');
  assert.deepEqual(chunks[3].heading_path, ['Chapter 2']);
  assert.ok(chunks.every((chunk) => countWords(chunk.content) <= 220));
  const resultWords = chunks.slice(0, 3).map((chunk) => chunk.content.split(/\s+/));
  assert.deepEqual(resultWords[0].slice(-32), resultWords[1].slice(0, 32));
  const restored = [...resultWords[0], ...resultWords[1].slice(32), ...resultWords[2].slice(32)];
  assert.deepEqual(restored, words);
});

test('chunking respects subword token counts rather than assuming one word is one token', () => {
  const chunks = new ChunkingService().split([
    { content: 'technical '.repeat(100), page: 7, heading_path: [] },
  ], (text) => countWords(text) * 4);
  assert.equal(chunks.length, 2);
  assert.ok(chunks.every((chunk) => countWords(chunk.content) * 4 <= 220));
  assert.equal(chunks[0].page_start, 7);
  assert.equal(chunks[1].page_end, 7);
  assert.deepEqual(new ChunkingService().split([], countWords), []);
});

test('PDF extraction preserves physical pages and nested headings without relabeling the preface', async () => {
  const passages = await new PdfExtractionService().extract(textbookPdf());
  assert.equal(passages.length, 3);
  assert.match(passages[0].content, /Text before the chapter/);
  assert.deepEqual(passages[0].heading_path, []);
  assert.deepEqual(passages[1].heading_path, ['Chapter 1']);
  assert.equal(passages[1].page, 1);
  assert.deepEqual(passages[2].heading_path, ['Chapter 1', '1.1 DNA']);
  assert.equal(passages[2].page, 2);
  assert.match(passages[2].content, /DNA stores genetic information/);
});

test('non-PDF, corrupt PDFs, and PDFs without extractable text produce useful errors', async () => {
  const extraction = new PdfExtractionService();
  await assert.rejects(extraction.extract(Buffer.from('<html>not a PDF</html>')), (error) => error.getStatus() === 400);
  await assert.rejects(extraction.extract(Buffer.from('%PDF-1.4\ncorrupt')), (error) => error.getStatus() === 422);
  await assert.rejects(extraction.extract(textbookPdf({ blank: true })), /require OCR/);
});

test('URL imports reject private, loopback, metadata, mapped IPv6, and unsupported protocols', async () => {
  for (const address of ['127.0.0.1', '10.0.0.1', '172.16.0.1', '192.168.1.1', '169.254.169.254',
    '100.64.0.1', '0.0.0.0', '224.0.0.1', '::1', 'fe80::1', 'fc00::1', '::ffff:127.0.0.1']) {
    assert.equal(isPublicAddress(address), false, address);
  }
  assert.equal(isPublicAddress('8.8.8.8'), true);
  assert.equal(isPublicAddress('2606:4700:4700::1111'), true);
  const downloader = new PdfDownloadService();
  for (const url of ['http://127.0.0.1/book.pdf', 'http://[::1]/book.pdf', 'http://169.254.169.254/latest',
    'file:///etc/passwd', 'https://user:password@example.com/book.pdf']) {
    await assert.rejects(downloader.download(url), (error) => error.getStatus() === 400);
  }
});

test('URL import pins validated DNS and rechecks redirect destinations', async () => {
  const dns = require('node:dns/promises');
  const originalLookup = dns.lookup;
  dns.lookup = async () => [{ address: '8.8.8.8', family: 4 }];
  try {
    const downloader = new PdfDownloadService();
    let requests = 0;
    downloader.fetch = async (_url, address) => {
      requests++;
      assert.deepEqual(address, { address: '8.8.8.8', family: 4 });
      return { redirect: 'http://127.0.0.1/private.pdf' };
    };
    await assert.rejects(downloader.download('https://books.example/book.pdf'), (error) => error.getStatus() === 400);
    assert.equal(requests, 1);
  } finally {
    dns.lookup = originalLookup;
  }
});

test('DTOs validate pagination and required metadata', async () => {
  assert.ok((await validate(plainToInstance(ImportUrlDto, { title: ' ', source_url: 'ftp://example.com/book' }))).length >= 2);
  assert.ok((await validate(plainToInstance(PaginationDto, { limit: '1.5' }))).length);
  assert.equal((await validate(plainToInstance(PaginationDto, { limit: '10', offset: '0' }))).length, 0);
});

test('failed embeddings do not save a document and release the import slot', async () => {
  let persisted = 0;
  const repository = { create: async () => { persisted++; } };
  const extraction = { extract: async () => [{ content: 'book', page: 1, heading_path: [] }] };
  let shouldFail = true;
  const embeddings = { tokenCounter: async () => countWords, embed: async () => {
    if (shouldFail) throw new Error('model offline');
    return [Array(384).fill(0.1)];
  } };
  const service = new DocumentsService(repository, extraction, new ChunkingService(), embeddings, {});
  await assert.rejects(service.upload({ buffer: Buffer.from('book') }, { title: 'Book' }), /model offline/);
  assert.equal(persisted, 0);
  shouldFail = false;
  await service.upload({ buffer: Buffer.from('book') }, { title: 'Book' });
  assert.equal(persisted, 1);
});

let app;
let base;
let saved;
let savedChunks;
before(async () => {
  const repository = {
    create: async (document, chunks) => {
      saved = { ...document, id: 'a05e2d2f-6ec1-4cc2-b591-44134d6c2c11', created_at: new Date().toISOString() };
      savedChunks = chunks;
      return { ...saved, chunk_count: chunks.length };
    },
    list: async () => saved ? [saved] : [],
    find: async (id) => saved?.id === id ? saved : undefined,
    chunks: async () => savedChunks.map(({ embedding, ...chunk }) => chunk),
    search: async () => [{ content: 'DNA stores genetic information.', similarity: 0.9 }],
  };
  const embeddings = { tokenCounter: async () => countWords, embed: async (texts) => texts.map(() => Array(384).fill(0.1)) };
  const service = new DocumentsService(repository, new PdfExtractionService(), new ChunkingService(), embeddings,
    { download: async () => textbookPdf() });
  class HttpTestModule {}
  Module({ controllers: [DocumentsController], providers: [{ provide: DocumentsService, useValue: service }] })(HttpTestModule);
  app = await NestFactory.create(HttpTestModule, { logger: false });
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
  await app.listen(0, '127.0.0.1');
  base = await app.getUrl();
});
after(async () => { if (app) await app.close(); });

test('HTTP upload imports a PDF without authentication, with null source and 384-dimensional embeddings', async () => {
  const form = new FormData();
  form.append('title', ' Biology ');
  form.append('edition', '2nd');
  form.append('file', new Blob([textbookPdf()], { type: 'application/pdf' }), 'biology.pdf');
  const response = await fetch(`${base}/documents/upload`, { method: 'POST', body: form });
  assert.equal(response.status, 201);
  const book = await response.json();
  assert.equal(book.title, 'Biology');
  assert.equal(book.source_url, null);
  assert.equal(book.chunk_count, 3);
  assert.ok(savedChunks.every((chunk) => chunk.embedding.length === 384));
  const chunksResponse = await fetch(`${base}/documents/${book.id}/chunks?limit=10`);
  assert.equal(chunksResponse.status, 200);
  const chunks = await chunksResponse.json();
  assert.equal(chunks.length, 3);
  assert.equal(chunks[0].embedding, undefined);
});

test('HTTP URL import stores the original source URL and supports semantic search', async () => {
  const response = await fetch(`${base}/documents/import-url`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'Biology', source_url: 'https://books.example/biology.pdf' }) });
  assert.equal(response.status, 201);
  assert.equal((await response.json()).source_url, 'https://books.example/biology.pdf');
  const search = await fetch(`${base}/documents/search`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: 'What stores genetic information?' }) });
  assert.equal(search.status, 200);
  assert.match((await search.json())[0].content, /DNA/);
});

test('HTTP validation rejects missing files, invalid IDs, invalid pagination, unknown fields, and empty queries', async () => {
  const missing = new FormData();
  missing.append('title', 'Book');
  assert.equal((await fetch(`${base}/documents/upload`, { method: 'POST', body: missing })).status, 400);
  assert.equal((await fetch(`${base}/documents/not-a-uuid`)).status, 400);
  assert.equal((await fetch(`${base}/documents?limit=-1`)).status, 400);
  assert.equal((await fetch(`${base}/documents/b05e2d2f-6ec1-4cc2-b591-44134d6c2c11`)).status, 404);
  for (const input of [{ query: ' ' }, { query: 'DNA', unexpected: true }, { query: 'long '.repeat(300) }]) {
    const response = await fetch(`${base}/documents/search`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
    assert.equal(response.status, 400);
  }
});

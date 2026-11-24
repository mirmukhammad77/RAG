require('reflect-metadata');
require('dotenv').config({ quiet: true });
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { ConfigService } = require('@nestjs/config');
const { EmbeddingsService } = require('../dist/modules/documents/services/embeddings.service');
const { ChunkingService } = require('../dist/modules/documents/services/chunking.service');
const { GeminiService } = require('../dist/modules/documents/services/gemini.service');

test('real Gemini answers from a textbook passage with a valid source reference', {
  skip: process.env.RUN_GEMINI_TESTS !== '1', timeout: 130_000,
}, async () => {
  assert.ok(process.env.GEMINI_API_KEY, 'Set GEMINI_API_KEY before enabling RUN_GEMINI_TESTS');
  const gemini = new GeminiService(new ConfigService({
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    GEMINI_MODEL: process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite',
    GEMINI_TIMEOUT_MS: Number(process.env.GEMINI_TIMEOUT_MS || 30000),
  }));
  const result = await gemini.answer('How does DNA store genetic information?', [{
    id: 'b05e2d2f-6ec1-4cc2-b591-44134d6c2c11', document_id: 'a05e2d2f-6ec1-4cc2-b591-44134d6c2c11',
    position: 0, title: 'Biology', edition: null, source_url: null, heading_path: ['DNA'],
    page_start: 12, page_end: 12, content: 'DNA stores genetic information in its sequence of nucleotide bases.', similarity: 1,
  }]);
  assert.equal(result.answerable, true);
  assert.match(result.answer, /\[1\]/);
  assert.equal(result.sources.length, 1);
  assert.deepEqual(result.sources[0].heading_path, ['DNA']);
  assert.equal(result.sources[0].page_start, 12);
});

test('real MiniLM produces normalized 384-dimensional vectors and tokenizer-safe chunks', {
  skip: process.env.RUN_MODEL_TESTS !== '1', timeout: 240_000,
}, async () => {
  const embeddings = new EmbeddingsService(new ConfigService({ MODEL_CACHE_DIR: '.cache/models' }));
  const counter = await embeddings.tokenCounter();
  const chunks = new ChunkingService().split([
    { content: 'Deoxyribonucleic acid stores genetic information. '.repeat(50), page: 1, heading_path: ['DNA'] },
  ], counter);
  assert.ok(chunks.length > 1);
  assert.ok(chunks.every((chunk) => counter(chunk.content) <= 220));
  const vectors = await embeddings.embed([chunks[0].content, 'DNA stores the genetic instructions of cells.']);
  for (const vector of vectors) {
    assert.equal(vector.length, 384);
    assert.ok(vector.every(Number.isFinite));
    assert.ok(Math.abs(Math.hypot(...vector) - 1) < 0.001);
  }
  assert.ok(vectors[0].reduce((sum, value, index) => sum + value * vectors[1][index], 0) > 0.5);
});

test('PostgreSQL persists books, rolls back failed chunk inserts, and ranks pgvector matches', {
  skip: process.env.RUN_DATABASE_TESTS !== '1', timeout: 30_000,
}, async () => {
  const { Pool } = require('pg');
  const { drizzle } = require('drizzle-orm/node-postgres');
  const { eq } = require('drizzle-orm');
  const { DocumentsRepository } = require('../dist/modules/documents/repositories/documents.repository');
  const { documents, documentChunks } = require('../dist/modules/documents/entities/documents');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5000 });
  const db = drizzle(pool);
  const rollback = new Error('rollback successful integration fixture');
  try {
    await assert.rejects(db.transaction(async (transaction) => {
      const repository = new DocumentsRepository(transaction);
      const vector = (index) => Array.from({ length: 384 }, (_, position) => position === index ? 1 : 0);
      const chunk = { position: 0, heading_path: ['Chapter 1'], page_start: 1, page_end: 2, content: 'DNA stores genetic information.', embedding: vector(0) };
      const book = await repository.create({ title: 'Integration textbook' }, [chunk, { ...chunk, position: 1, embedding: vector(1), content: 'Other material.' }]);
      assert.equal(book.chunk_count, 2);
      assert.equal(book.source_url, null);
      const matches = await repository.search(vector(0), { query: 'DNA', document_id: book.id, limit: 2 });
      assert.equal(matches[0].content, chunk.content);
      assert.equal(matches[0].similarity, 1);
      assert.equal(matches[1].similarity, 0);
      const chunks = await repository.chunks(book.id, { limit: 20, offset: 0 });
      assert.equal(chunks.length, 2);
      assert.deepEqual(chunks[0].heading_path, ['Chapter 1']);
      assert.equal(chunks[0].embedding, undefined);
      await assert.rejects(repository.create({ title: 'Must roll back' }, [chunk, chunk]));
      const failed = await transaction.select().from(documents).where(eq(documents.title, 'Must roll back'));
      assert.equal(failed.length, 0);
      await transaction.delete(documents).where(eq(documents.id, book.id));
      assert.equal((await transaction.select().from(documentChunks).where(eq(documentChunks.document_id, book.id))).length, 0);
      throw rollback;
    }), (error) => error === rollback);
  } finally {
    await pool.end();
  }
});

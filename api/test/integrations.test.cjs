require('reflect-metadata');
require('dotenv').config({ quiet: true });
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { ConfigService } = require('@nestjs/config');
const { EmbeddingsService } = require('../dist/modules/documents/services/embeddings.service');
const { ChunkingService } = require('../dist/modules/documents/services/chunking.service');

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

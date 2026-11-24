import { sql } from 'drizzle-orm';
import { check, index, integer, pgTable, text, timestamp, unique, uuid, vector } from 'drizzle-orm/pg-core';

export const documents = pgTable('documents', {
  id: uuid('id').primaryKey().defaultRandom(),
  title: text('title').notNull(),
  edition: text('edition'),
  source_url: text('source_url'),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  check('documents_title_check', sql`length(btrim(${table.title})) > 0`),
  index('documents_created_at_idx').on(table.created_at.desc(), table.id.desc()),
]);

export const documentChunks = pgTable('document_chunks', {
  id: uuid('id').primaryKey().defaultRandom(),
  document_id: uuid('document_id').notNull().references(() => documents.id, { onDelete: 'cascade' }),
  position: integer('position').notNull(),
  heading_path: text('heading_path').array().notNull().default(sql`'{}'::text[]`),
  page_start: integer('page_start').notNull(),
  page_end: integer('page_end').notNull(),
  content: text('content').notNull(),
  embedding: vector('embedding', { dimensions: 384 }).notNull(),
}, (table) => [
  unique('document_chunks_document_position_unique').on(table.document_id, table.position),
  check('document_chunks_position_check', sql`${table.position} >= 0`),
  check('document_chunks_page_start_check', sql`${table.page_start} >= 1`),
  check('document_chunks_page_end_check', sql`${table.page_end} >= ${table.page_start}`),
  check('document_chunks_content_check', sql`length(btrim(${table.content})) > 0`),
  index('document_chunks_embedding_idx').using('hnsw', table.embedding.op('vector_cosine_ops')),
]);

export type NewDocument = typeof documents.$inferInsert;
export type NewChunk = Omit<typeof documentChunks.$inferInsert, 'id' | 'document_id'>;

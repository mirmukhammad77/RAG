import { Inject, Injectable } from '@nestjs/common';
import { cosineDistance, desc, eq, getTableColumns, sql } from 'drizzle-orm';
import { DATABASE } from '../../database/database.constants';
import type { Database } from '../../database/services/database.service';
import { documentChunks, documents, NewChunk, NewDocument } from '../entities/documents';
import { PaginationDto, SearchChunksDto } from '../dtos/document.dto';

const { embedding: _embedding, ...chunkColumns } = getTableColumns(documentChunks);

@Injectable()
export class DocumentsRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async create(document: NewDocument, chunks: NewChunk[]) {
    return this.db.transaction(async (transaction) => {
      const [saved] = await transaction.insert(documents).values(document).returning();
      for (let offset = 0; offset < chunks.length; offset += 100) {
        await transaction.insert(documentChunks).values(chunks.slice(offset, offset + 100).map((chunk) => ({
          ...chunk,
          document_id: saved.id,
        })));
      }
      return { ...saved, chunk_count: chunks.length };
    });
  }

  list(pagination: PaginationDto) {
    return this.db.select().from(documents).orderBy(desc(documents.created_at), desc(documents.id))
      .limit(pagination.limit).offset(pagination.offset);
  }

  async find(id: string) {
    const [document] = await this.db.select().from(documents).where(eq(documents.id, id));
    return document;
  }

  chunks(id: string, pagination: PaginationDto) {
    return this.db.select(chunkColumns).from(documentChunks).where(eq(documentChunks.document_id, id))
      .orderBy(documentChunks.position).limit(pagination.limit).offset(pagination.offset);
  }

  search(embedding: number[], input: SearchChunksDto) {
    const distance = cosineDistance(documentChunks.embedding, embedding);
    return this.db.select({
      ...chunkColumns,
      title: documents.title,
      edition: documents.edition,
      source_url: documents.source_url,
      similarity: sql<number>`1 - (${distance})`,
    }).from(documentChunks).innerJoin(documents, eq(documents.id, documentChunks.document_id))
      .where(input.document_id ? eq(documentChunks.document_id, input.document_id) : undefined)
      .orderBy(distance).limit(input.limit);
  }
}

import { BadRequestException, HttpException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import type {} from 'multer';
import { MAX_CHUNKS } from '../documents.constants';
import { AskDocumentDto, ImportDocumentDto, ImportUrlDto, PaginationDto, SearchChunksDto } from '../dtos/document.dto';
import { DocumentsRepository } from '../repositories/documents.repository';
import { ChunkingService } from './chunking.service';
import { EmbeddingsService } from './embeddings.service';
import { GeminiService } from './gemini.service';
import type { RetrievedPassage } from './gemini.service';
import { GeminiStreamingService } from './gemini-streaming.service';
import { retrievalFallback } from './answer-fallback';
import { PdfDownloadService } from './pdf-download.service';
import { PdfExtractionService } from './pdf-extraction.service';

@Injectable()
export class DocumentsService {
  private importing = false;

  constructor(
    private readonly repository: DocumentsRepository,
    private readonly extraction: PdfExtractionService,
    private readonly chunking: ChunkingService,
    private readonly embeddings: EmbeddingsService,
    private readonly download: PdfDownloadService,
    private readonly gemini: GeminiService,
    private readonly streaming: GeminiStreamingService,
  ) {}

  async upload(file: Express.Multer.File | undefined, input: ImportDocumentDto) {
    if (!file?.buffer.length) throw new BadRequestException('Provide a non-empty PDF in the file field.');
    return this.importBook(input, null, async () => file.buffer);
  }

  importUrl(input: ImportUrlDto) {
    return this.importBook(input, input.source_url, () => this.download.download(input.source_url));
  }

  private async importBook(input: ImportDocumentDto, sourceUrl: string | null, read: () => Promise<Buffer>) {
    // Keep heavyweight imports bounded without adding a jobs table to the initial schema.
    if (this.importing) throw new ServiceUnavailableException('Another book is being imported. Please retry when it finishes.');
    this.importing = true;
    try {
      const passages = await this.extraction.extract(await read());
      const countTokens = await this.embeddings.tokenCounter();
      const chunks = this.chunking.split(passages, countTokens);
      if (!chunks.length || chunks.length > MAX_CHUNKS) throw new BadRequestException('The PDF has no importable passages.');
      const embeddings = await this.embeddings.embed(chunks.map((chunk) => chunk.content));
      return await this.repository.create({ title: input.title, edition: input.edition ?? null, source_url: sourceUrl },
        chunks.map((chunk, index) => ({ ...chunk, embedding: embeddings[index] })));
    } finally {
      this.importing = false;
    }
  }

  list(pagination: PaginationDto) {
    return this.repository.list(pagination);
  }

  async find(id: string) {
    const document = await this.repository.find(id);
    if (!document) throw new NotFoundException('Book not found.');
    return document;
  }

  async chunks(id: string, pagination: PaginationDto) {
    await this.find(id);
    return this.repository.chunks(id, pagination);
  }

  async search(input: SearchChunksDto) {
    if (input.document_id) await this.find(input.document_id);
    const countTokens = await this.embeddings.tokenCounter();
    if (countTokens(input.query) > 254) throw new BadRequestException('Search query must fit within 254 MiniLM tokens.');
    const [embedding] = await this.embeddings.embed([input.query]);
    return this.repository.search(embedding, input);
  }

  async ask(input: AskDocumentDto) {
    const passages = await this.prepareQuestion(input);
    try {
      return await this.gemini.answer(input.question, passages);
    } catch (error) {
      if (!(error instanceof HttpException) || ![429, 502, 503, 504].includes(error.getStatus())) throw error;
      return retrievalFallback(input.question, this.gemini.model, passages, error);
    }
  }

  async prepareQuestion(input: AskDocumentDto) {
    this.gemini.assertConfigured();
    return this.search({ query: input.question, document_id: input.document_id, limit: input.limit });
  }

  streamAnswer(question: string, passages: RetrievedPassage[], signal: AbortSignal) {
    return this.streaming.stream(question, passages, signal);
  }
}

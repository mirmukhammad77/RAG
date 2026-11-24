import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { DocumentsController } from './controllers/documents.controller';
import { DocumentsRepository } from './repositories/documents.repository';
import { ChunkingService } from './services/chunking.service';
import { DocumentsService } from './services/documents.service';
import { EmbeddingsService } from './services/embeddings.service';
import { PdfDownloadService } from './services/pdf-download.service';
import { PdfExtractionService } from './services/pdf-extraction.service';

@Module({
  imports: [DatabaseModule],
  controllers: [DocumentsController],
  providers: [DocumentsRepository, DocumentsService, PdfExtractionService, PdfDownloadService, ChunkingService, EmbeddingsService],
})
export class DocumentsModule {}

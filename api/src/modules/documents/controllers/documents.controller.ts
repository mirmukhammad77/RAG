import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { once } from 'node:events';
import type { Response } from 'express';
import type {} from 'multer';
import { MAX_PDF_BYTES } from '../documents.constants';
import { AskDocumentDto, ImportDocumentDto, ImportUrlDto, PaginationDto, SearchChunksDto } from '../dtos/document.dto';
import { DocumentsService } from '../services/documents.service';

@Controller('documents')
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  @Post('upload')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_PDF_BYTES, files: 1, fields: 2, fieldSize: 4096, parts: 3 } }))
  upload(@UploadedFile() file: Express.Multer.File | undefined, @Body() input: ImportDocumentDto) {
    return this.documents.upload(file, input);
  }

  @Post('import-url')
  importUrl(@Body() input: ImportUrlDto) {
    return this.documents.importUrl(input);
  }

  @Post('search')
  @HttpCode(200)
  search(@Body() input: SearchChunksDto) {
    return this.documents.search(input);
  }

  @Post('ask')
  @HttpCode(200)
  ask(@Body() input: AskDocumentDto) {
    return this.documents.ask(input);
  }

  @Post('ask/stream')
  @HttpCode(200)
  async stream(@Body() input: AskDocumentDto, @Res() response: Response) {
    const cancelled = new AbortController();
    const onClose = () => cancelled.abort();
    response.once('close', onClose);
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    try {
      const passages = await this.documents.prepareQuestion(input);
      if (cancelled.signal.aborted) return;
      response.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
      response.setHeader('Cache-Control', 'no-cache');
      response.setHeader('X-Accel-Buffering', 'no');
      response.flushHeaders();
      heartbeat = setInterval(() => response.write(': keep-alive\n\n'), 15_000);
      heartbeat.unref();
      for await (const event of this.documents.streamAnswer(input.question, passages, cancelled.signal)) {
        if (cancelled.signal.aborted) break;
        if (!response.write(`event: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`)) {
          await once(response, 'drain', { signal: cancelled.signal });
        }
      }
    } catch (error) {
      if (!response.headersSent) throw error;
      if (!cancelled.signal.aborted) response.write('event: error\ndata: {"message":"The answer stream ended unexpectedly."}\n\n');
    } finally {
      clearInterval(heartbeat);
      response.off('close', onClose);
      cancelled.abort();
      if (response.headersSent && !response.destroyed) response.end();
    }
  }

  @Get()
  list(@Query() pagination: PaginationDto) {
    return this.documents.list(pagination);
  }

  @Get(':id')
  find(@Param('id', ParseUUIDPipe) id: string) {
    return this.documents.find(id);
  }

  @Get(':id/chunks')
  chunks(@Param('id', ParseUUIDPipe) id: string, @Query() pagination: PaginationDto) {
    return this.documents.chunks(id, pagination);
  }
}

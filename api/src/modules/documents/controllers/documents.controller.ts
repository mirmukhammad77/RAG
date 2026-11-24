import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { MAX_PDF_BYTES } from '../documents.constants';
import { ImportDocumentDto, ImportUrlDto, PaginationDto, SearchChunksDto } from '../dtos/document.dto';
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

import { BadRequestException, Injectable, PayloadTooLargeException, UnprocessableEntityException } from '@nestjs/common';
import type { PDFDocumentProxy } from 'pdfjs-dist/types/src/display/api';
import { MAX_PDF_BYTES, MAX_PDF_PAGES, Passage } from '../documents.constants';

interface Heading { page: number; path: string[] }
type Outline = NonNullable<Awaited<ReturnType<PDFDocumentProxy['getOutline']>>>;

@Injectable()
export class PdfExtractionService {
  async extract(buffer: Buffer): Promise<Passage[]> {
    if (buffer.length > MAX_PDF_BYTES) throw new PayloadTooLargeException('PDF must be 50 MiB or smaller.');
    if (!buffer.subarray(0, 1024).includes(Buffer.from('%PDF-'))) {
      throw new BadRequestException('The supplied file must be a PDF.');
    }

    const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const task = getDocument({ data: new Uint8Array(buffer), useSystemFonts: true });
    try {
      const pdf = await task.promise;
      if (pdf.numPages > MAX_PDF_PAGES) {
        throw new UnprocessableEntityException(`PDFs may contain at most ${MAX_PDF_PAGES} pages.`);
      }
      const headings = await this.headings(pdf);
      const passages: Passage[] = [];
      let path: string[] = [];

      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
        const page = await pdf.getPage(pageNumber);
        try {
          const text = await page.getTextContent();
          const lines: string[] = [];
          let line = '';
          for (const item of text.items) {
            if (!('str' in item)) continue;
            // PDF text can contain NULs, which PostgreSQL text does not accept.
            line += item.str.replace(/\0/g, '') + ' ';
            if (item.hasEOL) { lines.push(line.trim()); line = ''; }
          }
          if (line.trim()) lines.push(line.trim());

          let remaining = lines.join('\n').trim();
          for (const heading of headings.filter((item) => item.page === pageNumber)) {
            // Bookmark titles are only assigned when they can be located in the page text.
            // This avoids labeling text above a mid-page heading as belonging to it.
            const title = heading.path[heading.path.length - 1];
            const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
            const match = new RegExp(escaped, 'iu').exec(remaining);
            if (!match) continue;
            const before = remaining.slice(0, match.index).trim();
            if (before) passages.push({ content: before, page: pageNumber, heading_path: [...path] });
            path = heading.path;
            remaining = remaining.slice(match.index);
          }
          if (remaining) passages.push({ content: remaining, page: pageNumber, heading_path: [...path] });
        } finally {
          page.cleanup();
        }
      }
      if (!passages.length) {
        throw new UnprocessableEntityException('No text could be extracted. Scanned PDFs require OCR, which is not supported yet.');
      }
      return passages;
    } catch (error) {
      if (error instanceof UnprocessableEntityException) throw error;
      throw new UnprocessableEntityException('Could not read this PDF. It may be damaged or password-protected.');
    } finally {
      await task.destroy();
    }
  }

  private async headings(pdf: PDFDocumentProxy): Promise<Heading[]> {
    const headings: Heading[] = [];
    const visit = async (items: Outline, parents: string[]): Promise<void> => {
      for (const item of items) {
        const title = item.title.replace(/\0/g, '').trim();
        const path = title ? [...parents, title] : parents;
        try {
          const destination = typeof item.dest === 'string' ? await pdf.getDestination(item.dest) : item.dest;
          if (destination?.[0] !== undefined && title) {
            const page = typeof destination[0] === 'number' ? destination[0] : await pdf.getPageIndex(destination[0]);
            headings.push({ page: page + 1, path });
          }
        } catch {
          // A broken bookmark must not discard otherwise readable textbook text.
        }
        await visit(item.items, path);
      }
    };
    try { await visit((await pdf.getOutline()) ?? [], []); } catch { return []; }
    return headings.sort((left, right) => left.page - right.page);
  }
}

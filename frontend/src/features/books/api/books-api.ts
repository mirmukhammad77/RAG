import { apiRequest } from '@/shared/api/client';
import type { Book, BookImportInput, BookPage, BookPassage, ImportedBook } from '../types';

export const BOOKS_PAGE_SIZE = 20;
export const MAX_BOOKS_PAGE = 50_000;

export async function getBooks(page: number, signal?: AbortSignal): Promise<BookPage<Book>> {
  const books = await apiRequest<Book[]>(
    `/documents?limit=${BOOKS_PAGE_SIZE + 1}&offset=${page * BOOKS_PAGE_SIZE}`,
    { signal },
  );

  return {
    items: books.slice(0, BOOKS_PAGE_SIZE),
    hasMore: books.length > BOOKS_PAGE_SIZE && page < MAX_BOOKS_PAGE,
  };
}

export function getBook(id: string, signal?: AbortSignal): Promise<Book> {
  return apiRequest<Book>(`/documents/${encodeURIComponent(id)}`, { signal });
}

export async function getBookPassages(
  id: string,
  page: number,
  signal?: AbortSignal,
): Promise<BookPage<BookPassage>> {
  const passages = await apiRequest<BookPassage[]>(
    `/documents/${encodeURIComponent(id)}/chunks?limit=${BOOKS_PAGE_SIZE + 1}&offset=${page * BOOKS_PAGE_SIZE}`,
    { signal },
  );

  return {
    // The API returns passages in their original reading order (position).
    items: passages.slice(0, BOOKS_PAGE_SIZE),
    hasMore: passages.length > BOOKS_PAGE_SIZE && page < MAX_BOOKS_PAGE,
  };
}

export function importBook(input: BookImportInput): Promise<ImportedBook> {
  if (input.method === 'upload') {
    const body = new FormData();
    body.set('file', input.file);
    body.set('title', input.title);
    if (input.edition) body.set('edition', input.edition);

    return apiRequest<ImportedBook>('/documents/upload', { method: 'POST', body });
  }

  return apiRequest<ImportedBook>('/documents/import-url', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: input.title,
      edition: input.edition,
      source_url: input.sourceUrl,
    }),
  });
}

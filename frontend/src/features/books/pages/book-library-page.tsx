import { useState } from 'react';
import { Link } from 'react-router';
import { Button } from '@/shared/components/ui/button';
import { BookCard } from '../components/book-card';
import { ImportBookDialog } from '../components/import-book-dialog';
import { PageControls } from '../components/page-controls';
import { useBookPage } from '../hooks/use-book-page';
import { useBooks } from '../hooks/use-books';
import type { ImportedBook } from '../types';

export function BookLibraryPage() {
  const { page, setPage } = useBookPage();
  const books = useBooks(page);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [importedBook, setImportedBook] = useState<ImportedBook | null>(null);

  function handleImported(book: ImportedBook) {
    setImportedBook(book);
    setDialogOpen(false);
    setPage(0);
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-5">
        <div className="space-y-2">
          <h1 className="text-3xl font-semibold tracking-tight">Book library</h1>
          <p className="text-base text-muted-foreground">Your books, ready to explore. Newest additions first.</p>
        </div>
        <Button type="button" onClick={() => setDialogOpen(true)}>Add book</Button>
      </div>

      {importedBook && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card px-5 py-4">
          <p role="status" className="min-w-0 break-words text-sm">
            <span className="font-medium">{importedBook.title}</span> was added to your library.
          </p>
          <div className="flex shrink-0 items-center gap-2">
            <Button asChild variant="outline" size="sm">
              <Link to={`/books/${importedBook.id}`}>View book</Link>
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setImportedBook(null)}>Dismiss</Button>
          </div>
        </div>
      )}

      {books.isPending && (
        <p role="status" className="rounded-xl border p-8 text-base text-muted-foreground">Loading your library…</p>
      )}

      {books.isError && (
        <div role="alert" className="space-y-3 rounded-xl border border-destructive/40 p-6">
          <h2 className="text-lg font-semibold">Could not load the library</h2>
          <p className="text-base text-muted-foreground">{books.error.message}</p>
          <Button type="button" variant="outline" disabled={books.isFetching} onClick={() => { void books.refetch(); }}>
            {books.isFetching ? 'Retrying…' : 'Try again'}
          </Button>
        </div>
      )}

      {books.data && (
        <section aria-label="Books" aria-busy={books.isFetching} className="space-y-6">
          {books.isFetching && <p role="status" className="text-sm text-muted-foreground">Refreshing library…</p>}
          {books.data.items.length > 0 ? (
            <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {books.data.items.map((book) => <BookCard key={book.id} book={book} />)}
            </ul>
          ) : (
            <div className="rounded-xl border border-dashed px-6 py-16 text-center">
              <h2 className="text-xl font-semibold">{page === 0 ? 'Your library is empty' : 'No books on this page'}</h2>
              <p className="mx-auto mt-3 max-w-md text-base leading-relaxed text-muted-foreground">
                {page === 0 ? 'Add your first PDF to start building your library.' : 'Return to the previous page to browse your books.'}
              </p>
              {page === 0 && <Button type="button" className="mt-6" onClick={() => setDialogOpen(true)}>Add your first book</Button>}
            </div>
          )}
        </section>
      )}

      {(page > 0 || books.data?.hasMore) && (
        <PageControls page={page} hasMore={books.data?.hasMore ?? false} busy={books.isFetching} onPageChange={setPage} label="Library pages" />
      )}

      <ImportBookDialog open={dialogOpen} onClose={() => setDialogOpen(false)} onImported={handleImported} />
    </div>
  );
}

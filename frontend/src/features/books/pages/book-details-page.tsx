import { useEffect, useRef } from 'react';
import { Link, useParams } from 'react-router';
import { ApiError } from '@/shared/api/client';
import { Button } from '@/shared/components/ui/button';
import { BOOKS_PAGE_SIZE } from '../api/books-api';
import { PageControls } from '../components/page-controls';
import { useBookPage } from '../hooks/use-book-page';
import { useBook, useBookPassages } from '../hooks/use-books';
import { formatImportDate, getSourceLink } from '../lib/format';

export function BookDetailsPage() {
  const { bookId = '' } = useParams();
  const { page, setPage } = useBookPage();
  const book = useBook(bookId);
  const passages = useBookPassages(bookId, page, book.isSuccess);
  const passageHeading = useRef<HTMLHeadingElement>(null);
  const focusPassages = useRef(false);

  useEffect(() => {
    if (focusPassages.current && passages.isSuccess && !passages.isFetching) {
      passageHeading.current?.focus();
      focusPassages.current = false;
    }
  }, [passages.isSuccess, passages.isFetching, page]);

  function changePassagePage(next: number) {
    focusPassages.current = true;
    setPage(next);
  }

  const sourceLink = getSourceLink(book.data?.source_url ?? null);
  const notFound = book.error instanceof ApiError && book.error.status === 404;

  return (
    <div className="space-y-8">
      <Link to="/" className="inline-block rounded text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        Back to library
      </Link>

      {book.isPending && <p role="status" className="text-base text-muted-foreground">Loading book…</p>}

      {book.isError && (
        <div role="alert" className="space-y-3 rounded-xl border p-6">
          <h1 className="text-xl font-semibold">{notFound ? 'Book not found' : 'Could not load this book'}</h1>
          <p className="text-base text-muted-foreground">{book.error.message}</p>
          {!notFound && (
            <Button type="button" variant="outline" disabled={book.isFetching} onClick={() => { void book.refetch(); }}>
              {book.isFetching ? 'Retrying…' : 'Try again'}
            </Button>
          )}
        </div>
      )}

      {book.data && (
        <>
          <header className="space-y-5 border-b pb-8">
            <h1 className="max-w-4xl break-words text-3xl font-semibold tracking-tight [overflow-wrap:anywhere] sm:text-4xl">{book.data.title}</h1>
            <dl className="flex flex-wrap gap-x-10 gap-y-4 text-sm">
              {book.data.edition && (
                <div className="min-w-0 space-y-1">
                  <dt className="text-muted-foreground">Edition</dt>
                  <dd className="break-words">{book.data.edition}</dd>
                </div>
              )}
              <div className="space-y-1">
                <dt className="text-muted-foreground">Added to library</dt>
                <dd><time dateTime={book.data.created_at}>{formatImportDate(book.data.created_at)}</time></dd>
              </div>
              <div className="space-y-1">
                <dt className="text-muted-foreground">Source</dt>
                <dd>
                  {sourceLink ? (
                    <a href={sourceLink} target="_blank" rel="noopener noreferrer" className="rounded underline underline-offset-4 hover:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                      Open source PDF<span className="sr-only"> (opens in a new tab)</span>
                    </a>
                  ) : 'Uploaded PDF'}
                </dd>
              </div>
            </dl>
          </header>

          <section aria-labelledby="extracted-text-heading" aria-busy={passages.isFetching} className="max-w-4xl space-y-6">
            <div className="space-y-2">
              <h2 ref={passageHeading} tabIndex={-1} id="extracted-text-heading" className="rounded text-xl font-semibold tracking-tight focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                Extracted text
              </h2>
              <p className="text-base leading-relaxed text-muted-foreground">
                In reading order, with original PDF page numbers. Adjacent passages may overlap.
              </p>
            </div>

            {passages.isPending && <p role="status" className="text-base text-muted-foreground">Loading extracted text…</p>}

            {passages.isError && (
              <div role="alert" className="space-y-3 rounded-xl border border-destructive/40 p-6">
                <h3 className="text-lg font-semibold">Could not load the extracted text</h3>
                <p className="text-base text-muted-foreground">{passages.error.message}</p>
                <Button type="button" variant="outline" disabled={passages.isFetching} onClick={() => { void passages.refetch(); }}>
                  {passages.isFetching ? 'Retrying…' : 'Try again'}
                </Button>
              </div>
            )}

            {passages.data && (
              <>
                {passages.isFetching && <p role="status" className="text-sm text-muted-foreground">Refreshing extracted text…</p>}
                {passages.data.items.length > 0 ? (
                  <>
                    <p className="text-sm text-muted-foreground">
                      Passages {page * BOOKS_PAGE_SIZE + 1}–{page * BOOKS_PAGE_SIZE + passages.data.items.length}
                    </p>
                    <ol start={page * BOOKS_PAGE_SIZE + 1} className="space-y-5">
                      {passages.data.items.map((passage) => (
                        <li key={passage.id}>
                          <article aria-labelledby={`passage-${passage.id}`} className="space-y-4 rounded-xl border bg-card p-5 sm:p-7">
                            <div className="space-y-2">
                              <h3 id={`passage-${passage.id}`} className="text-sm font-medium">
                                {passage.page_start === passage.page_end
                                  ? `PDF page ${passage.page_start}`
                                  : `PDF pages ${passage.page_start}–${passage.page_end}`}
                              </h3>
                              {passage.heading_path.length > 0 && (
                                <p className="break-words text-sm leading-relaxed text-muted-foreground">{passage.heading_path.join(' / ')}</p>
                              )}
                            </div>
                            <p className="whitespace-pre-wrap break-words text-base leading-8 [overflow-wrap:anywhere]">{passage.content}</p>
                          </article>
                        </li>
                      ))}
                    </ol>
                  </>
                ) : (
                  <p className="rounded-xl border border-dashed p-8 text-base text-muted-foreground">
                    {page === 0 ? 'There is no extracted text available for this book.' : 'There are no more passages on this page. Return to the previous page to keep reading.'}
                  </p>
                )}
              </>
            )}
            {(page > 0 || passages.data?.hasMore) && (
              <PageControls page={page} hasMore={passages.data?.hasMore ?? false} busy={passages.isFetching} onPageChange={changePassagePage} label="Extracted text pages" />
            )}
          </section>
        </>
      )}
    </div>
  );
}

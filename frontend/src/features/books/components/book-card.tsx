import { Link } from 'react-router';
import { formatImportDate } from '../lib/format';
import type { Book } from '../types';

export function BookCard({ book }: { book: Book }) {
  return (
    <li className="min-w-0">
      <Link
        to={`/books/${book.id}`}
        className="group flex h-full flex-col rounded-xl border bg-card p-6 shadow-sm transition-colors hover:border-ring/60 hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        <div className="mb-8 flex items-center justify-between gap-3">
          <span className="rounded-md border px-2 py-1 text-sm font-medium text-muted-foreground">PDF</span>
          <span className="text-sm text-muted-foreground">
            {book.source_url ? 'Link import' : 'Uploaded'}
          </span>
        </div>
        <h2 className="break-words text-lg font-semibold leading-snug [overflow-wrap:anywhere]">
          {book.title}
        </h2>
        {book.edition && <p className="mt-2 break-words text-sm text-muted-foreground">{book.edition}</p>}
        <div className="mt-auto pt-6 text-sm text-muted-foreground">
          Added <time dateTime={book.created_at}>{formatImportDate(book.created_at)}</time>
        </div>
      </Link>
    </li>
  );
}

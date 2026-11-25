import { useState, type FormEvent } from 'react';
import { Button } from '@/shared/components/ui/button';
import { Input } from '@/shared/components/ui/input';
import { useBookPassageSearch } from '../hooks/use-books';

export function BookPassageSearch({ bookId }: { bookId: string }) {
  const [input, setInput] = useState('');
  const [query, setQuery] = useState('');
  const search = useBookPassageSearch(bookId, query);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next = input.trim();
    if (!next) return;
    if (next === query) void search.refetch();
    else setQuery(next);
  }

  function clear() {
    setInput('');
    setQuery('');
  }

  return (
    <section aria-labelledby="passage-search-heading" className="max-w-4xl space-y-5 border-b pb-8">
      <div className="space-y-2">
        <h2 id="passage-search-heading" className="text-xl font-semibold tracking-tight">Search this book</h2>
        <p className="text-base text-muted-foreground">Find passages by meaning within this book.</p>
      </div>
      <form onSubmit={submit} className="space-y-2">
        <label htmlFor="passage-query" className="text-sm font-medium">Search for a topic or phrase</label>
        <div className="flex flex-wrap gap-3">
          <Input id="passage-query" type="search" value={input} onChange={(event) => setInput(event.target.value)} maxLength={2000} required className="min-w-0 flex-1 basis-64" />
          <Button type="submit" disabled={!input.trim() || search.isFetching}>Search passages</Button>
          {query && <Button type="button" variant="outline" onClick={clear}>Clear search</Button>}
        </div>
      </form>

      {query && (
        <div aria-busy={search.isFetching} className="space-y-4">
          {search.isFetching && <p role="status" className="text-base text-muted-foreground">Searching this book…</p>}
          {search.isError && (
            <div role="alert" className="space-y-3 rounded-xl border border-destructive/40 p-5">
              <p>{search.error.message}</p>
              <Button type="button" variant="outline" disabled={search.isFetching} onClick={() => { void search.refetch(); }}>Try again</Button>
            </div>
          )}
          {search.data && !search.isFetching && !search.isError && (
            <>
              <p role="status" className="break-words text-sm text-muted-foreground">
                {search.data.length ? `${search.data.length} passages for “${query}”, closest matches first.` : `No passages found for “${query}”.`}
              </p>
              <ul className="space-y-4">
                {search.data.map((passage) => (
                  <li key={passage.id}>
                    <article className="space-y-3 rounded-xl border bg-card p-5 sm:p-7">
                      <h3 className="text-sm font-medium">
                        {passage.page_start === passage.page_end ? `PDF page ${passage.page_start}` : `PDF pages ${passage.page_start}–${passage.page_end}`}
                      </h3>
                      {passage.heading_path.length > 0 && <p className="break-words text-sm text-muted-foreground">{passage.heading_path.join(' / ')}</p>}
                      <p className="whitespace-pre-wrap break-words text-base leading-8 [overflow-wrap:anywhere]">{passage.content}</p>
                    </article>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </section>
  );
}

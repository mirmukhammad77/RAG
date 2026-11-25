import { Link } from 'react-router';
import type { AnswerResult, AnswerSource, FallbackResult } from '../types';

interface QuestionResultProps {
  status: 'idle' | 'retrieving' | 'streaming' | 'done' | 'fallback' | 'stopped' | 'error';
  question: string;
  text: string;
  result: AnswerResult | FallbackResult | null;
  error: string | null;
}

function citedText(text: string, sources: AnswerSource[]) {
  const ids = new Set(sources.map((source) => source.citation_id));
  return text.split(/(\[\d+\])/g).map((part, index) => {
    const id = /^\[(\d+)\]$/.exec(part)?.[1];
    if (!id || !ids.has(Number(id))) return part;
    return <a key={index} href={`#qa-source-${id}`} aria-label={`Source ${id}`} className="rounded font-medium underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{part}</a>;
  });
}

export function QuestionResult({ status, question, text, result, error }: QuestionResultProps) {
  if (status === 'idle') return null;
  const fallback = result && 'answer_type' in result ? result : null;
  const label = status === 'retrieving' ? 'Finding relevant passages…'
    : status === 'streaming' ? 'Writing answer…'
      : status === 'stopped' ? 'Stopped. Any answer text below is incomplete.'
        : status === 'error' ? 'The answer could not be completed. Any answer text below is incomplete.'
          : fallback ? fallback.answer_type === 'extractive' ? 'Showing textbook excerpts.' : 'An answer is unavailable.'
            : result?.answerable === false ? 'The passages do not contain enough information to answer.' : 'Answer complete.';

  return (
    <div className="space-y-8 border-t pt-8">
      <section aria-labelledby="answer-heading" className="space-y-4">
        <h2 id="answer-heading" className="break-words text-xl font-semibold [overflow-wrap:anywhere]">{question}</h2>
        <p role="status" className="text-sm text-muted-foreground">{label}</p>
        {error && <p role="alert" className="rounded-lg border border-destructive/40 p-4 text-base">{error}</p>}
        {fallback && <p className="text-sm text-muted-foreground">{fallback.generation_error.message}</p>}
        {text && (
          <div className="space-y-3 rounded-xl border bg-card p-5 sm:p-7">
            <h3 className="text-sm font-medium">{fallback?.answer_type === 'extractive' ? 'Textbook excerpts' : fallback ? 'Answer unavailable' : 'Answer'}</h3>
            <p className="whitespace-pre-wrap break-words text-base leading-8 [overflow-wrap:anywhere]">{citedText(text, result?.sources ?? [])}</p>
          </div>
        )}
      </section>

      {result && result.sources.length > 0 && (
        <section aria-labelledby="answer-sources-heading" className="space-y-3">
          <h2 id="answer-sources-heading" className="text-base font-semibold">Sources</h2>
          <ul className="space-y-3">
            {result.sources.map((source) => (
              <li key={source.id} id={`qa-source-${source.citation_id}`} tabIndex={-1} className="scroll-mt-6 space-y-1 rounded-lg border px-4 py-3 focus:outline-none focus:ring-2 focus:ring-ring">
                <h3 className="break-words text-base font-medium">
                  <span className="mr-2 text-muted-foreground">[{source.citation_id}]</span>
                  <Link to={`/books/${source.document_id}`} className="rounded underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{source.title}</Link>
                  {source.edition && <span className="ml-2 text-muted-foreground">({source.edition})</span>}
                </h3>
                <p className="text-sm text-muted-foreground">
                  {source.page_start === source.page_end ? `PDF page ${source.page_start}` : `PDF pages ${source.page_start}–${source.page_end}`}
                </p>
                {source.heading_path.length > 0 && <p className="break-words text-sm text-muted-foreground">{source.heading_path.join(' / ')}</p>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

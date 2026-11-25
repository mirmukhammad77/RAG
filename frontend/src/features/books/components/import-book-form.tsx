import { useEffect, useId, useState, type FormEvent } from 'react';
import { Button } from '@/shared/components/ui/button';
import { Input } from '@/shared/components/ui/input';
import { useImportBook } from '../hooks/use-books';
import type { BookImportInput, ImportedBook } from '../types';

const MAX_PDF_BYTES = 50 * 1024 * 1024;
type FieldErrors = Partial<Record<'title' | 'edition' | 'file' | 'sourceUrl', string>>;

interface ImportBookFormProps {
  onImported: (book: ImportedBook) => void;
  onPendingChange?: (pending: boolean) => void;
}

export function ImportBookForm({ onImported, onPendingChange }: ImportBookFormProps) {
  const id = useId();
  const [method, setMethod] = useState<'upload' | 'link'>('upload');
  const [title, setTitle] = useState('');
  const [edition, setEdition] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [sourceUrl, setSourceUrl] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const mutation = useImportBook();

  useEffect(() => {
    onPendingChange?.(mutation.isPending);
  }, [mutation.isPending, onPendingChange]);

  useEffect(() => {
    if (!mutation.isPending) return;

    function beforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = '';
    }

    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [mutation.isPending]);

  function clearError(field: keyof FieldErrors) {
    setErrors((current) => ({ ...current, [field]: undefined }));
    if (mutation.isError) mutation.reset();
  }

  function changeMethod(next: 'upload' | 'link') {
    setMethod(next);
    setFile(null);
    setErrors({});
    mutation.reset();
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (mutation.isPending) return;

    const nextErrors: FieldErrors = {};
    const trimmedTitle = title.trim();
    const trimmedEdition = edition.trim();
    const trimmedUrl = sourceUrl.trim();

    if (!trimmedTitle) nextErrors.title = 'Enter a book title.';
    else if (trimmedTitle.length > 500) nextErrors.title = 'Use 500 characters or fewer.';
    if (trimmedEdition.length > 200) nextErrors.edition = 'Use 200 characters or fewer.';

    if (method === 'upload') {
      if (!file) nextErrors.file = 'Choose a PDF to upload.';
      else if (file.size === 0) nextErrors.file = 'This file is empty. Choose another PDF.';
      else if (file.size > MAX_PDF_BYTES) nextErrors.file = 'Choose a PDF of 50 MiB or smaller.';
      else if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
        nextErrors.file = 'Choose a PDF file.';
      }
    } else {
      try {
        const url = new URL(trimmedUrl);
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
          nextErrors.sourceUrl = 'Enter a public HTTP or HTTPS link without sign-in details.';
        } else if (trimmedUrl.length > 4096) {
          nextErrors.sourceUrl = 'Use a link of 4,096 characters or fewer.';
        }
      } catch {
        nextErrors.sourceUrl = 'Enter a complete HTTP or HTTPS link to a PDF.';
      }
    }

    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      const firstField = Object.keys(nextErrors)[0];
      if (firstField) document.getElementById(`${id}-${firstField}`)?.focus();
      return;
    }

    const metadata = { title: trimmedTitle, edition: trimmedEdition || undefined };
    let input: BookImportInput;
    if (method === 'upload') {
      if (!file) return;
      input = { ...metadata, method, file };
    } else {
      input = { ...metadata, method, sourceUrl: trimmedUrl };
    }

    mutation.mutate(input, { onSuccess: onImported });
  }

  return (
    <form noValidate onSubmit={submit} className="space-y-6" aria-busy={mutation.isPending}>
      <fieldset disabled={mutation.isPending} className="space-y-6 disabled:opacity-70">
        <legend className="sr-only">Book import details</legend>
        <fieldset className="space-y-3">
          <legend className="text-sm font-medium">Import method</legend>
          <div className="flex flex-wrap gap-x-6 gap-y-3">
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="radio"
                name={`${id}-method`}
                value="upload"
                checked={method === 'upload'}
                onChange={() => changeMethod('upload')}
                className="size-4 accent-primary"
              />
              Upload a PDF
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="radio"
                name={`${id}-method`}
                value="link"
                checked={method === 'link'}
                onChange={() => changeMethod('link')}
                className="size-4 accent-primary"
              />
              Import from a link
            </label>
          </div>
        </fieldset>

        <div className="space-y-2">
          <label htmlFor={`${id}-title`} className="text-sm font-medium">Book title</label>
          <Input
            id={`${id}-title`}
            name="title"
            value={title}
            onChange={(event) => { setTitle(event.target.value); clearError('title'); }}
            maxLength={500}
            autoFocus
            required
            aria-invalid={Boolean(errors.title)}
            aria-describedby={errors.title ? `${id}-title-error` : undefined}
          />
          {errors.title && <p id={`${id}-title-error`} className="text-sm text-destructive">{errors.title}</p>}
        </div>

        <div className="space-y-2">
          <label htmlFor={`${id}-edition`} className="text-sm font-medium">
            Edition <span className="font-normal text-muted-foreground">(optional)</span>
          </label>
          <Input
            id={`${id}-edition`}
            name="edition"
            value={edition}
            onChange={(event) => { setEdition(event.target.value); clearError('edition'); }}
            maxLength={200}
            aria-invalid={Boolean(errors.edition)}
            aria-describedby={errors.edition ? `${id}-edition-error` : undefined}
          />
          {errors.edition && <p id={`${id}-edition-error`} className="text-sm text-destructive">{errors.edition}</p>}
        </div>

        {method === 'upload' ? (
          <div className="space-y-2">
            <label htmlFor={`${id}-file`} className="text-sm font-medium">PDF file</label>
            <Input
              id={`${id}-file`}
              name="file"
              type="file"
              accept=".pdf,application/pdf"
              required
              onChange={(event) => { setFile(event.target.files?.[0] ?? null); clearError('file'); }}
              aria-invalid={Boolean(errors.file)}
              aria-describedby={`${id}-file-help${errors.file ? ` ${id}-file-error` : ''}`}
            />
            <p id={`${id}-file-help`} className="text-sm leading-relaxed text-muted-foreground">
              One text-based PDF, up to 50 MiB and 2,000 pages. Scanned PDFs need OCR first.
            </p>
            {errors.file && <p id={`${id}-file-error`} className="text-sm text-destructive">{errors.file}</p>}
          </div>
        ) : (
          <div className="space-y-2">
            <label htmlFor={`${id}-sourceUrl`} className="text-sm font-medium">PDF link</label>
            <Input
              id={`${id}-sourceUrl`}
              name="source_url"
              type="url"
              inputMode="url"
              value={sourceUrl}
              onChange={(event) => { setSourceUrl(event.target.value); clearError('sourceUrl'); }}
              maxLength={4096}
              placeholder="https://example.com/book.pdf"
              required
              aria-invalid={Boolean(errors.sourceUrl)}
              aria-describedby={`${id}-link-help${errors.sourceUrl ? ` ${id}-link-error` : ''}`}
            />
            <p id={`${id}-link-help`} className="text-sm leading-relaxed text-muted-foreground">
              Use a public link directly to a text-based PDF, up to 50 MiB and 2,000 pages.
              A book&apos;s web page or a link requiring sign-in will not work.
            </p>
            {errors.sourceUrl && <p id={`${id}-link-error`} className="text-sm text-destructive">{errors.sourceUrl}</p>}
          </div>
        )}
      </fieldset>

      {mutation.isError && (
        <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm leading-relaxed">
          <p className="font-medium">Book import was not confirmed</p>
          <p className="mt-1 text-muted-foreground">{mutation.error.message}</p>
          <p className="mt-2 text-muted-foreground">
            If the connection was interrupted, check the library before trying again to avoid a duplicate.
          </p>
        </div>
      )}

      <div role="status" aria-live="polite" className="text-sm leading-relaxed text-muted-foreground">
        {mutation.isPending
          ? 'Importing your book. Keep this page open while the text is processed. Large books and the first import may take several minutes.'
          : 'Your book will appear in the library when its text is ready.'}
      </div>

      <Button type="submit" disabled={mutation.isPending} className="w-full sm:w-auto">
        {mutation.isPending ? 'Importing book…' : 'Import book'}
      </Button>
    </form>
  );
}

import { useEffect, useId, useRef, useState } from 'react';
import { Button } from '@/shared/components/ui/button';
import type { ImportedBook } from '../types';
import { ImportBookForm } from './import-book-form';

interface ImportBookDialogProps {
  open: boolean;
  onClose: () => void;
  onImported: (book: ImportedBook) => void;
}

export function ImportBookDialog({ open, onClose, onImported }: ImportBookDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  const [pending, setPending] = useState(false);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;

    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();

    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previousOverflow; };
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-description`}
      onCancel={(event) => {
        event.preventDefault();
        if (!pending) onClose();
      }}
      onClose={onClose}
      className="fixed inset-0 m-auto max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-xl overflow-y-auto rounded-xl border bg-card p-0 text-card-foreground shadow-xl backdrop:bg-black/75 backdrop:backdrop-blur-sm"
    >
      <div className="p-6 sm:p-8">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div className="space-y-2">
            <h2 id={`${id}-title`} className="text-xl font-semibold tracking-tight">Add a book</h2>
            <p id={`${id}-description`} className="text-base leading-relaxed text-muted-foreground">
              Upload a PDF or import one from a public link.
            </p>
          </div>
          <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={onClose}>
            Close
          </Button>
        </div>
        {open && (
          <ImportBookForm onImported={onImported} onPendingChange={setPending} />
        )}
      </div>
    </dialog>
  );
}

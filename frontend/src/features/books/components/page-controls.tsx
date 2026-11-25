import { Button } from '@/shared/components/ui/button';

interface PageControlsProps {
  page: number;
  hasMore: boolean;
  busy: boolean;
  onPageChange: (page: number) => void;
  label: string;
}

export function PageControls({ page, hasMore, busy, onPageChange, label }: PageControlsProps) {
  return (
    <nav aria-label={label} className="flex flex-wrap items-center justify-between gap-4 border-t pt-5">
      <p className="text-sm text-muted-foreground">Page {page + 1}</p>
      <div className="flex gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={page === 0 || busy}
          onClick={() => onPageChange(page - 1)}
        >
          Previous
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={!hasMore || busy}
          onClick={() => onPageChange(page + 1)}
        >
          Next
        </Button>
      </div>
    </nav>
  );
}

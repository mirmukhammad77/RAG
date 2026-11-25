import { Link } from 'react-router';
import { Button } from '@/shared/components/ui/button';

export function NotFoundPage() {
  return (
    <main className="flex min-h-svh items-center justify-center px-6 py-16">
      <div className="max-w-md space-y-6 text-center">
        <div className="space-y-3">
          <h1 className="text-3xl font-semibold tracking-tight">Page not found</h1>
          <p className="text-base text-muted-foreground">
            The page you are looking for does not exist.
          </p>
        </div>
        <Button asChild>
          <Link to="/">Back to home</Link>
        </Button>
      </div>
    </main>
  );
}

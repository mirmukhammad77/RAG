import { useEffect } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router';

export function AppLayout() {
  const { pathname } = useLocation();

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  return (
    <div className="min-h-svh">
      <a href="#main-content" className="sr-only z-50 rounded-md bg-primary px-4 py-2 text-primary-foreground focus:not-sr-only focus:fixed focus:left-4 focus:top-4">Skip to content</a>
      <header className="border-b">
        <nav aria-label="Main navigation" className="mx-auto flex h-16 max-w-6xl items-center gap-8 px-6">
          <Link to="/" className="rounded text-lg font-semibold tracking-tight focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">RAG</Link>
          <NavLink to="/" end className="rounded text-sm font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-[current=page]:text-foreground">Library</NavLink>
        </nav>
      </header>
      <main id="main-content" className="mx-auto max-w-6xl px-6 py-10 sm:py-12">
        <Outlet />
      </main>
    </div>
  );
}

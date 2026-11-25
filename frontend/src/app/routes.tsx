import { Route, Routes } from 'react-router';
import { AppLayout } from '@/app/layout';
import { NotFoundPage } from '@/app/pages/not-found-page';
import { BookLibraryPage } from '@/features/books/pages/book-library-page';
import { BookDetailsPage } from '@/features/books/pages/book-details-page';

export function AppRoutes() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<BookLibraryPage />} />
        <Route path="books/:bookId" element={<BookDetailsPage />} />
      </Route>
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}

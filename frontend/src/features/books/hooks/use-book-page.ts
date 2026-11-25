import { useSearchParams } from 'react-router';
import { MAX_BOOKS_PAGE } from '../api/books-api';

export function useBookPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const value = Number(searchParams.get('page') || '1');
  const page = Number.isInteger(value) && value >= 1 && value <= MAX_BOOKS_PAGE + 1
    ? value - 1
    : 0;

  function setPage(next: number) {
    setSearchParams((current) => {
      const params = new URLSearchParams(current);
      if (next === 0) params.delete('page');
      else params.set('page', String(next + 1));
      return params;
    });
  }

  return { page, setPage };
}

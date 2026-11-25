import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getBook, getBookPassages, getBooks, importBook } from '../api/books-api';

export const bookKeys = {
  all: ['books'] as const,
  lists: () => [...bookKeys.all, 'list'] as const,
  list: (page: number) => [...bookKeys.lists(), page] as const,
  detail: (id: string) => [...bookKeys.all, 'detail', id] as const,
  passages: (id: string, page: number) => [...bookKeys.detail(id), 'passages', page] as const,
};

export function useBooks(page: number) {
  return useQuery({
    queryKey: bookKeys.list(page),
    queryFn: ({ signal }) => getBooks(page, signal),
    retry: false,
  });
}

export function useBook(id: string) {
  return useQuery({
    queryKey: bookKeys.detail(id),
    queryFn: ({ signal }) => getBook(id, signal),
    enabled: Boolean(id),
    retry: false,
  });
}

export function useBookPassages(id: string, page: number, enabled: boolean) {
  return useQuery({
    queryKey: bookKeys.passages(id, page),
    queryFn: ({ signal }) => getBookPassages(id, page, signal),
    enabled: Boolean(id) && enabled,
    retry: false,
  });
}

export function useImportBook() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: importBook,
    // Retrying an import can create a duplicate book.
    retry: false,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: bookKeys.lists() });
    },
  });
}

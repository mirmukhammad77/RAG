export interface Book {
  id: string;
  title: string;
  edition: string | null;
  source_url: string | null;
  created_at: string;
}

export interface BookPassage {
  id: string;
  document_id: string;
  position: number;
  heading_path: string[];
  page_start: number;
  page_end: number;
  content: string;
}

export interface ImportedBook extends Book {
  chunk_count: number;
}

export interface SearchPassage extends BookPassage {
  title: string;
  edition: string | null;
  source_url: string | null;
  similarity: number;
}

export type BookImportInput = {
  title: string;
  edition?: string;
} & (
  | { method: 'upload'; file: File }
  | { method: 'link'; sourceUrl: string }
);

export interface BookPage<T> {
  items: T[];
  hasMore: boolean;
}

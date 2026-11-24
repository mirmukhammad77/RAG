export const MAX_PDF_BYTES = 50 * 1024 * 1024;
export const MAX_PDF_PAGES = 2000;
export const MAX_CHUNKS = 20_000;
export const EMBEDDING_MODEL = 'Xenova/all-MiniLM-L6-v2';
export const EMBEDDING_DIMENSIONS = 384;
export const CHUNK_TOKENS = 220;
export const OVERLAP_TOKENS = 32;

export interface Passage {
  content: string;
  page: number;
  heading_path: string[];
}

export interface Chunk {
  position: number;
  heading_path: string[];
  page_start: number;
  page_end: number;
  content: string;
}

import type { SearchPassage } from '@/features/books/types';

export interface AnswerSource extends SearchPassage {
  citation_id: number;
}

export interface QuestionInput {
  question: string;
  document_id?: string;
}

export interface AnswerResult {
  question: string;
  answer: string;
  answerable: boolean;
  model: string;
  sources: AnswerSource[];
}

export interface FallbackResult extends Omit<AnswerResult, 'answerable'> {
  answerable: null;
  status: 'extractive_fallback' | 'retrieval_only';
  answer_type: 'extractive' | 'unavailable';
  chunks: AnswerSource[];
  excerpts: { text: string; citation_id: number }[];
  generation_error: { statusCode: number; message: string };
}

export type QuestionEvent =
  | { event: 'chunks'; data: { question: string; model: string; chunks: AnswerSource[] } }
  | { event: 'delta'; data: { text: string } }
  | { event: 'done'; data: AnswerResult }
  | { event: 'fallback'; data: FallbackResult };

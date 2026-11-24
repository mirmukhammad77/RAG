import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { CHUNK_TOKENS, Chunk, MAX_CHUNKS, OVERLAP_TOKENS, Passage } from '../documents.constants';

interface Word { text: string; page: number }

@Injectable()
export class ChunkingService {
  split(passages: Passage[], countTokens: (text: string) => number): Chunk[] {
    const chunks: Chunk[] = [];
    let words: Word[] = [];
    let headingPath: string[] = [];

    const flush = (): void => {
      let start = 0;
      const text = (from: number, to: number): string => words.slice(from, to).map((word) => word.text).join('').trim();
      while (start < words.length) {
        // Find the largest prefix within the actual model tokenizer's budget.
        let low = start + 1;
        let high = Math.min(words.length, start + CHUNK_TOKENS);
        let end = start;
        while (low <= high) {
          const middle = Math.floor((low + high) / 2);
          if (countTokens(text(start, middle)) <= CHUNK_TOKENS) {
            end = middle;
            low = middle + 1;
          } else {
            high = middle - 1;
          }
        }
        if (end === start) {
          throw new UnprocessableEntityException('A passage cannot fit within the embedding model token limit.');
        }
        chunks.push({
          position: chunks.length,
          heading_path: [...headingPath],
          page_start: words[start].page,
          page_end: words[end - 1].page,
          content: text(start, end),
        });
        if (chunks.length > MAX_CHUNKS) {
          throw new UnprocessableEntityException(`A book may contain at most ${MAX_CHUNKS} chunks.`);
        }
        if (end === words.length) break;

        let next = end;
        // Keep overlap without ever repeating a window or crossing section boundaries.
        for (let candidate = end - 1; candidate > start; candidate--) {
          if (countTokens(text(candidate, end)) > OVERLAP_TOKENS) break;
          next = candidate;
        }
        start = next;
      }
      words = [];
    };

    for (const passage of passages) {
      if (JSON.stringify(passage.heading_path) !== JSON.stringify(headingPath)) flush();
      headingPath = passage.heading_path;
      const tokens = passage.content.match(/\S+\s*/gu) ?? [];
      for (const token of tokens) words.push({ text: token, page: passage.page });
      // Ensure the next page or text block cannot merge with the last word.
      if (words.length && !/\s$/u.test(words[words.length - 1].text)) words[words.length - 1].text += '\n';
    }
    flush();
    return chunks;
  }
}

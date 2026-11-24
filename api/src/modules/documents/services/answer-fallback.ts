import type { HttpException } from '@nestjs/common';
import { answerSources } from './gemini.service';
import type { RetrievedPassage } from './gemini.service';

const STOP_WORDS = new Set(`a an and are as at be been being between but by can could describe did differ different
difference differences do does doing explain for from had has have how i in into is it its may me of on or our should
that the their them there these they this those to us was we were what when where which who why will with would you your`.split(/\s+/));

function terms(text: string): Set<string> {
  return new Set((text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])
    .filter((word) => word.length >= 2 && !STOP_WORDS.has(word))
    .map((word) => word.endsWith('ies') && word.length > 4 ? `${word.slice(0, -3)}y`
      : word.endsWith('s') && !word.endsWith('ss') && word.length > 4 ? word.slice(0, -1) : word));
}

export function retrievalFallback(question: string, model: string, passages: RetrievedPassage[], error: HttpException) {
  const chunks = answerSources(passages);
  const queryTerms = terms(question);
  const segmenter = new Intl.Segmenter('en', { granularity: 'sentence' });
  const seen = new Set<string>();
  const candidates = chunks.flatMap((chunk) => {
    // Whitespace normalization only: extracted sentences preserve the textbook's wording.
    const content = chunk.content.replace(/\s+/g, ' ').trim();
    return [...segmenter.segment(content)].flatMap(({ segment }) => {
      const text = segment.trim();
      const key = text.toLowerCase();
      if (seen.has(key) || text.length < 25 || text.length > 1000 || !/[.!?]["')\]]?$/.test(text)) return [];
      const sentenceTerms = terms(text);
      const matches = [...queryTerms].filter((term) => sentenceTerms.has(term));
      if (!matches.length) return [];
      seen.add(key);
      return [{ text, citation_id: chunk.citation_id, matches, similarity: chunk.similarity }];
    });
  });
  const covered = new Set<string>();
  const excerpts: { text: string; citation_id: number }[] = [];
  while (candidates.length && excerpts.length < 4) {
    const score = (candidate: typeof candidates[number]) =>
      candidate.matches.filter((term) => !covered.has(term)).length * 3 + candidate.matches.length
      + candidate.similarity * 0.1 - candidate.text.length / 10_000;
    candidates.sort((left, right) => score(right) - score(left));
    const best = candidates.shift()!;
    excerpts.push({ text: best.text, citation_id: best.citation_id });
    best.matches.forEach((term) => covered.add(term));
  }
  const citations = new Set(excerpts.map((excerpt) => excerpt.citation_id));
  return {
    question,
    status: excerpts.length ? 'extractive_fallback' : 'retrieval_only',
    answer_type: excerpts.length ? 'extractive' : 'unavailable',
    answer: excerpts.length
      ? `Gemini is unavailable. Relevant textbook excerpts:\n\n${excerpts.map((excerpt) => `> ${excerpt.text} [${excerpt.citation_id}]`).join('\n\n')}`
      : 'Gemini could not generate an answer, and no complete matching textbook sentences were found. Inspect the retrieved chunks or retry later.',
    // Lexical matching finds excerpts; it cannot establish whether they fully answer the question.
    answerable: null,
    model,
    sources: chunks.filter((chunk) => citations.has(chunk.citation_id)),
    chunks,
    excerpts,
    generation_error: { statusCode: error.getStatus(), message: error.message },
  };
}

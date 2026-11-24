require('reflect-metadata');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { ServiceUnavailableException } = require('@nestjs/common');
const { retrievalFallback } = require('../dist/modules/documents/services/answer-fallback');

const question = 'How do arteries, veins, and capillaries differ in what they do?';
const failure = new ServiceUnavailableException('Gemini is experiencing high demand. Please try again later.');
const passage = (id, content, similarity = 0.7) => ({
  id: `chunk-${id}`, document_id: 'book-id', position: id, title: 'AnatomyPhysiology', edition: null, source_url: null,
  heading_path: ['Preface'], page_start: 852 + id, page_end: 852 + id, content, similarity,
});
const arteries = 'An artery is a blood vessel that carries blood away from the heart, where it branches into ever-smaller vessels.';
const circulation = 'Eventually, the smallest arteries, vessels called arterioles, further branch into tiny capillaries, where nutrients and wastes are exchanged, and then combine with other vessels that exit capillaries to form venules, small blood vessels that carry blood to a vein, a larger blood vessel that returns blood to the heart.';

test('the reported blood-vessel question gets cited textbook excerpts when Gemini returns 503', () => {
  const passages = [
    passage(0, 'Arteries and veins have different wall thicknesses.'),
    passage(1, `Blood is carried through the body via blood vessels.\n${arteries}\n${circulation}`),
    passage(2, 'Liver sinusoids allow specialized exchange.'),
  ];
  const result = retrievalFallback(question, 'gemini-3.5-flash-lite', passages, failure);
  assert.equal(result.status, 'extractive_fallback');
  assert.equal(result.answer_type, 'extractive');
  assert.equal(result.answerable, null);
  assert.match(result.answer, /carries blood away from the heart/);
  assert.match(result.answer, /nutrients and wastes are exchanged/);
  assert.match(result.answer, /returns blood to the heart/);
  assert.match(result.answer, /\[2\]/);
  assert.equal(result.generation_error.statusCode, 503);
  assert.deepEqual(result.chunks.map(p => p.id), passages.map(p => p.id));
  assert.ok(result.sources.some(source => source.id === 'chunk-1' && source.citation_id === 2 && source.page_start === 853));
  assert.ok(!result.sources.some(source => source.id === 'chunk-2'));
  for (const excerpt of result.excerpts) {
    assert.ok(passages[excerpt.citation_id - 1].content.replace(/\s+/g, ' ').includes(excerpt.text));
  }
});

test('overlapping passages do not produce duplicate sentences or invent missing headings', () => {
  const result = retrievalFallback(question, 'gemini-3.5-flash-lite', [
    passage(0, `${arteries} ${circulation}`), passage(1, arteries),
  ].map(p => ({ ...p, heading_path: [] })), failure);
  assert.equal(result.excerpts.length, 2);
  assert.equal(new Set(result.excerpts.map(e => e.text)).size, 2);
  assert.ok(result.sources.every(source => source.heading_path.length === 0));
});

test('unrelated retrieval and cut-off sentences do not become fabricated answers', () => {
  const result = retrievalFallback(question, 'gemini-3.5-flash-lite', [
    passage(0, 'DNA stores genetic information in nucleotide bases.'),
    passage(1, 'An artery is a blood vessel that'),
  ], failure);
  assert.equal(result.status, 'retrieval_only');
  assert.equal(result.answer_type, 'unavailable');
  assert.equal(result.answerable, null);
  assert.equal(typeof result.answer, 'string');
  assert.deepEqual(result.sources, []);
  assert.deepEqual(result.excerpts, []);
  assert.equal(result.chunks.length, 2);
});

test('empty questions and no passages return an explanation without selecting arbitrary text', () => {
  const stopwords = retrievalFallback('How do they do that?', 'model', [passage(0, arteries)], failure);
  assert.equal(stopwords.answer_type, 'unavailable');
  assert.deepEqual(stopwords.excerpts, []);
  const empty = retrievalFallback(question, 'model', [], failure);
  assert.equal(empty.answer_type, 'unavailable');
  assert.deepEqual(empty.chunks, []);
});

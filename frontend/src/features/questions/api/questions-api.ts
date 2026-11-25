import { apiFetch } from '@/shared/api/client';
import { readEventStream } from '@/shared/api/event-stream';
import type { QuestionEvent, QuestionInput } from '../types';

export async function streamQuestion(
  input: QuestionInput,
  signal: AbortSignal,
  onEvent: (event: QuestionEvent) => void,
): Promise<void> {
  const response = await apiFetch('/documents/ask/stream', {
    method: 'POST',
    headers: { Accept: 'text/event-stream', 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
    signal,
  });

  for await (const frame of readEventStream(response)) {
    if (!['chunks', 'delta', 'done', 'fallback', 'error'].includes(frame.event)) continue;
    let data: unknown;
    try { data = JSON.parse(frame.data); }
    catch { throw new Error('The server returned an invalid answer event. Please try again.'); }
    if (typeof data !== 'object' || data === null) throw new Error('The server returned an invalid answer event.');
    if (frame.event === 'error') {
      throw new Error('message' in data && typeof data.message === 'string' ? data.message : 'The answer stream ended unexpectedly.');
    }
    if (frame.event === 'chunks' && (!('chunks' in data) || !Array.isArray(data.chunks))) {
      throw new Error('The server returned invalid passages.');
    }
    if (frame.event === 'delta' && (!('text' in data) || typeof data.text !== 'string')) {
      throw new Error('The server returned invalid answer text.');
    }
    if (frame.event === 'done' || frame.event === 'fallback') {
      if (!('answer' in data) || typeof data.answer !== 'string' || !('sources' in data) || !Array.isArray(data.sources)) {
        throw new Error('The server returned an invalid final answer.');
      }
    }
    onEvent({ event: frame.event, data } as QuestionEvent);
    if (frame.event === 'done' || frame.event === 'fallback') return;
  }
  throw new Error('The answer stream ended before a final answer arrived. Please try again.');
}

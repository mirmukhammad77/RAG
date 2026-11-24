import { BadGatewayException, GatewayTimeoutException, HttpException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { z } from 'zod';
import { answerSources, GeminiService } from './gemini.service';
import type { RetrievedPassage } from './gemini.service';
import { retrievalFallback } from './answer-fallback';

export type AnswerStreamEvent = { event: 'chunks' | 'delta' | 'done' | 'fallback'; data: unknown };

const frameSchema = z.object({
  promptFeedback: z.object({ blockReason: z.string().optional() }).optional(),
  candidates: z.array(z.object({
    finishReason: z.string().optional(),
    content: z.object({ parts: z.array(z.object({ text: z.string().optional(), thought: z.boolean().optional() })) }).optional(),
  })).optional(),
});

// Decode the answer string from a JSON prefix; incomplete escape sequences wait for the next frame.
function partialAnswer(json: string): string {
  const start = /"answer"\s*:\s*"/.exec(json);
  if (!start) return '';
  let text = '';
  for (let index = start.index + start[0].length; index < json.length; index++) {
    const char = json[index];
    if (char === '"') break;
    if (char !== '\\') { text += char; continue; }
    if (index + 1 >= json.length) break;
    const length = json[index + 1] === 'u' ? 6 : 2;
    if (index + length > json.length) break;
    text += JSON.parse(`"${json.slice(index, index + length)}"`) as string;
    index += length - 1;
  }
  // Do not send half a UTF-16 surrogate pair to the client.
  const last = text.charCodeAt(text.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? text.slice(0, -1) : text;
}

@Injectable()
export class GeminiStreamingService {
  constructor(private readonly gemini: GeminiService, private readonly config: ConfigService) {}

  async *stream(question: string, passages: RetrievedPassage[], clientSignal: AbortSignal): AsyncGenerator<AnswerStreamEvent> {
    if (clientSignal.aborted) return;
    yield { event: 'chunks', data: { question, model: this.gemini.model, chunks: answerSources(passages) } };
    if (!passages.length) {
      yield { event: 'done', data: this.gemini.insufficientAnswer(question) };
      return;
    }

    const timeout = new AbortController();
    const total = AbortSignal.timeout(this.config.getOrThrow<number>('GEMINI_STREAM_MAX_MS'));
    const signal = AbortSignal.any([clientSignal, timeout.signal, total]);
    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    const resetIdle = () => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => timeout.abort(), this.config.getOrThrow<number>('GEMINI_TIMEOUT_MS'));
      idleTimer.unref();
    };
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      resetIdle();
      const response = await this.gemini.request(question, passages, signal, true);
      if (!response.body) throw new BadGatewayException('Gemini returned an empty stream.');
      reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let json = '';
      let emitted = '';
      let finishReason: string | undefined;
      let finished = false;
      while (!finished) {
        const result = await reader.read();
        resetIdle();
        buffer += decoder.decode(result.value, { stream: !result.done });
        if (buffer.length > 1_000_000) throw new BadGatewayException('Gemini stream frame is too large.');
        if (result.done && buffer.trim()) buffer += '\n\n';
        let separator: RegExpExecArray | null;
        while ((separator = /\r?\n\r?\n/.exec(buffer))) {
          const frame = buffer.slice(0, separator.index);
          buffer = buffer.slice(separator.index + separator[0].length);
          const data = frame.split(/\r?\n/).filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart()).join('\n');
          if (!data || data === '[DONE]') continue;
          const parsed = frameSchema.parse(JSON.parse(data));
          if (parsed.promptFeedback?.blockReason) throw new BadGatewayException('Gemini blocked the answer.');
          const candidate = parsed.candidates?.[0];
          if (candidate?.finishReason) finishReason = candidate.finishReason;
          json += candidate?.content?.parts.filter((part) => !part.thought).map((part) => part.text ?? '').join('') ?? '';
          if (json.length > 100_000) throw new BadGatewayException('Gemini answer is too large.');
          const text = partialAnswer(json);
          if (text.length > emitted.length) {
            yield { event: 'delta', data: { text: text.slice(emitted.length) } };
            emitted = text;
          }
          if (finishReason) { finished = true; break; }
        }
        if (result.done) break;
      }
      const answer = this.gemini.parseAnswer(question, passages, {
        candidates: [{ finishReason, content: { parts: [{ text: json }] } }],
      });
      yield { event: 'done', data: answer };
    } catch (error) {
      if (clientSignal.aborted) return;
      const failure = signal.aborted
        ? new GatewayTimeoutException('Gemini took too long to answer. Retrieved textbook chunks are available.')
        : error instanceof HttpException ? error : new BadGatewayException('Gemini did not return a valid answer stream.');
      yield { event: 'fallback', data: retrievalFallback(question, this.gemini.model, passages, failure) };
    } finally {
      clearTimeout(idleTimer);
      timeout.abort();
      await reader?.cancel().catch(() => {});
      reader?.releaseLock();
    }
  }
}

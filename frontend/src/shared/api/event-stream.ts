export interface ServerEvent {
  event: string;
  data: string;
}

// The API emits LF-separated SSE frames. Also accept CRLF and fragmented UTF-8.
export async function* readEventStream(response: Response): AsyncGenerator<ServerEvent> {
  if (!response.headers.get('content-type')?.includes('text/event-stream') || !response.body) {
    throw new Error('The server did not return an answer stream. Please try again.');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      if (buffer.length > 1_000_000) throw new Error('The answer stream returned too much data.');
      // EOF without a frame delimiter is a truncated event, not a completed event.
      let separator: RegExpExecArray | null;
      while ((separator = /\r?\n\r?\n/.exec(buffer))) {
        const frame = buffer.slice(0, separator.index);
        buffer = buffer.slice(separator.index + separator[0].length);
        let event = 'message';
        const data: string[] = [];
        for (const line of frame.split(/\r?\n/)) {
          if (line.startsWith('event:')) event = line.slice(6).replace(/^ /, '');
          if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
        }
        if (data.length) yield { event, data: data.join('\n') };
      }
      if (done) return;
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

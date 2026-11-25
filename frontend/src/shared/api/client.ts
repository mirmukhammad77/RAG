const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL || '/api').replace(/\/+$/, '');

export class ApiError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = 'ApiError';
  }
}

function errorMessage(payload: unknown, fallback: string): string {
  if (typeof payload !== 'object' || payload === null || !('message' in payload)) {
    return fallback;
  }

  const message = payload.message;
  if (typeof message === 'string' && message.trim()) return message;
  if (Array.isArray(message)) {
    const messages = message.filter((item): item is string => typeof item === 'string');
    if (messages.length) return messages.join(' ');
  }

  return fallback;
}

export async function apiFetch(path: string, options: RequestInit = {}): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl}${path}`, options);
  } catch (error) {
    if (options.signal?.aborted) throw error;
    throw new Error('Unable to reach the server. Check your connection and try again.');
  }

  const isJson = response.headers.get('content-type')?.includes('application/json');
  if (!response.ok) {
    const payload: unknown = isJson ? await response.json().catch(() => null) : null;
    const fallback = response.status === 413
      ? 'This file is too large. Choose a PDF smaller than 50 MiB.'
      : 'The request could not be completed. Please try again.';
    throw new ApiError(errorMessage(payload, fallback), response.status);
  }

  return response;
}

export async function apiRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set('Accept', 'application/json');
  const response = await apiFetch(path, { ...options, headers });
  const isJson = response.headers.get('content-type')?.includes('application/json');

  if (!isJson) throw new Error('The server returned an unexpected response. Please try again.');
  return response.json() as Promise<T>;
}

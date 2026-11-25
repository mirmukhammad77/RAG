import { useEffect, useRef, useState } from 'react';
import { streamQuestion } from '../api/questions-api';
import type { AnswerResult, FallbackResult, QuestionInput } from '../types';

interface QuestionState {
  status: 'idle' | 'retrieving' | 'streaming' | 'done' | 'fallback' | 'stopped' | 'error';
  question: string;
  text: string;
  result: AnswerResult | FallbackResult | null;
  error: string | null;
}

const initialState: QuestionState = { status: 'idle', question: '', text: '', result: null, error: null };

export function useQuestion() {
  const [state, setState] = useState<QuestionState>(initialState);
  const active = useRef<AbortController | null>(null);

  useEffect(() => () => { active.current?.abort(); }, []);

  async function ask(input: QuestionInput) {
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    setState({ ...initialState, status: 'retrieving', question: input.question });
    try {
      await streamQuestion(input, controller.signal, (event) => {
        if (controller.signal.aborted || active.current !== controller) return;
        switch (event.event) {
          case 'chunks':
            setState((current) => ({ ...current, status: 'streaming' }));
            break;
          case 'delta':
            setState((current) => ({ ...current, text: current.text + event.data.text }));
            break;
          case 'done':
          case 'fallback':
            setState((current) => ({
              ...current, status: event.event, text: event.data.answer, result: event.data,
            }));
        }
      });
    } catch (error) {
      if (controller.signal.aborted || active.current !== controller) return;
      setState((current) => ({ ...current, status: 'error', error: error instanceof Error ? error.message : 'Could not answer the question.' }));
    } finally {
      if (active.current === controller) active.current = null;
    }
  }

  function stop() {
    active.current?.abort();
    active.current = null;
    setState((current) => ({ ...current, status: 'stopped' }));
  }

  return { ...state, busy: state.status === 'retrieving' || state.status === 'streaming', ask, stop };
}

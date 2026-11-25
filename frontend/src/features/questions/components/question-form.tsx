import { useState, type FormEvent } from 'react';
import { Button } from '@/shared/components/ui/button';

interface QuestionFormProps {
  busy: boolean;
  onAsk: (question: string) => void;
  onStop: () => void;
}

export function QuestionForm({ busy, onAsk, onStop }: QuestionFormProps) {
  const [question, setQuestion] = useState('');

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!busy && question.trim()) onAsk(question.trim());
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <label htmlFor="question" className="text-sm font-medium">Your question</label>
      <textarea
        id="question"
        value={question}
        onChange={(event) => setQuestion(event.target.value)}
        required
        maxLength={2000}
        rows={3}
        disabled={busy}
        className="block w-full resize-y rounded-md border border-input bg-transparent px-3 py-3 text-base shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
      />
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={busy || !question.trim()}>Ask question</Button>
        {busy && <Button type="button" variant="outline" onClick={onStop}>Stop</Button>}
      </div>
    </form>
  );
}

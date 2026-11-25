import { QuestionForm } from '../components/question-form';
import { QuestionResult } from '../components/question-result';
import { useQuestion } from '../hooks/use-question';

export function QuestionsPage() {
  const answer = useQuestion();

  return (
    <div className="max-w-4xl space-y-8">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">Q&A</h1>
        <p className="text-base leading-relaxed text-muted-foreground">Ask questions across all books in your library. Answers include references to the passages they use.</p>
        <p className="text-sm text-muted-foreground">Each question is answered independently.</p>
      </header>

      <QuestionForm
        busy={answer.busy}
        onAsk={(question) => { void answer.ask({ question }); }}
        onStop={answer.stop}
      />
      <QuestionResult {...answer} />
    </div>
  );
}

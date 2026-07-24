import { HelpCircle, Send } from 'lucide-react';
import { useState } from 'react';
import type { AskUserQuestionRequest } from '../types';

interface Props {
  question: AskUserQuestionRequest;
  onAnswer: (answer: string, selectedOption?: string) => void;
}

export default function AskUserQuestionCard({ question, onAnswer }: Props) {
  const [answer, setAnswer] = useState('');
  const [selectedOption, setSelectedOption] = useState<string | null>(null);

  const handleSubmit = () => {
    if (selectedOption) {
      onAnswer(selectedOption, selectedOption);
    } else if (answer.trim()) {
      onAnswer(answer.trim());
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="ask-question-card">
      <div className="ask-question-header">
        <HelpCircle size={16} className="ask-icon" />
        <span className="ask-title">需要您的输入</span>
      </div>
      <div className="ask-question-body">
        <p className="ask-question-text">{question.question}</p>
        {question.context && (
          <p className="ask-context">{question.context}</p>
        )}
        {question.options && question.options.length > 0 && (
          <div className="ask-options">
            {question.options.map((opt, i) => (
              <button
                key={i}
                className={`ask-option ${selectedOption === opt ? 'selected' : ''}`}
                onClick={() => setSelectedOption(opt)}
              >
                {opt}
              </button>
            ))}
          </div>
        )}
        <div className="ask-input-row">
          <textarea
            value={answer}
            onChange={e => { setAnswer(e.target.value); setSelectedOption(null); }}
            onKeyDown={handleKeyDown}
            placeholder="输入您的回答..."
            className="ask-input"
            rows={2}
          />
          <button
            className="ask-submit-btn"
            onClick={handleSubmit}
            disabled={!answer.trim() && !selectedOption}
          >
            <Send size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}

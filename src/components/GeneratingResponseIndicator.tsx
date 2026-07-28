import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';

interface Props {
  isStreaming: boolean;
}

function useElapsedStreamingSeconds(isStreaming: boolean): number {
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  useEffect(() => {
    if (!isStreaming) {
      setStartedAt(null);
      setElapsedSeconds(0);
      return;
    }

    const nextStartedAt = Date.now();
    setStartedAt(nextStartedAt);
    setElapsedSeconds(0);
  }, [isStreaming]);

  useEffect(() => {
    if (!isStreaming || startedAt === null) return;

    const timer = window.setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);

    return () => window.clearInterval(timer);
  }, [isStreaming, startedAt]);

  return elapsedSeconds;
}

function formatElapsedTime(seconds: number): string {
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes} 分 ${remainingSeconds} 秒`;
}

export default function GeneratingResponseIndicator({ isStreaming }: Props) {
  const elapsedSeconds = useElapsedStreamingSeconds(isStreaming);

  if (!isStreaming) return null;

  return (
    <div className="generating-response-indicator" role="status" aria-live="polite">
      <Loader2 size={16} className="generating-response-spinner" />
      <span className="generating-response-text">正在生成响应...</span>
      <span className="generating-response-time">（已用 {formatElapsedTime(elapsedSeconds)}）</span>
    </div>
  );
}

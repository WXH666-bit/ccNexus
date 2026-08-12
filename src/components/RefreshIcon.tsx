import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { RefreshCcw, RefreshCw, type LucideProps } from 'lucide-react';

interface RefreshIconProps extends LucideProps {
  spinning?: boolean;
  counterClockwise?: boolean;
}

export default function RefreshIcon({
  spinning = false,
  counterClockwise = false,
  className,
  onPointerDown,
  ...props
}: RefreshIconProps) {
  const [clicked, setClicked] = useState(false);
  const timeoutRef = useRef<number | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  useEffect(() => () => {
    if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
    if (animationFrameRef.current !== null) window.cancelAnimationFrame(animationFrameRef.current);
  }, []);

  const handlePointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
    if (animationFrameRef.current !== null) window.cancelAnimationFrame(animationFrameRef.current);

    setClicked(false);
    animationFrameRef.current = window.requestAnimationFrame(() => {
      setClicked(true);
      animationFrameRef.current = null;
    });
    timeoutRef.current = window.setTimeout(() => {
      setClicked(false);
      timeoutRef.current = null;
    }, 1000);

    onPointerDown?.(event);
  };

  const Icon = counterClockwise ? RefreshCcw : RefreshCw;
  const classes = [
    'refresh-icon',
    spinning ? 'refresh-icon--spinning' : '',
    clicked ? 'refresh-icon--clicked' : '',
    className || '',
  ].filter(Boolean).join(' ');

  return <Icon {...props} onPointerDown={handlePointerDown} className={classes} />;
}

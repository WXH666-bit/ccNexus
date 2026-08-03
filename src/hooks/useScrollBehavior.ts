import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

const BOTTOM_THRESHOLD_PX = 100;

interface UseScrollBehaviorOptions {
  contentVersion: unknown;
  streamingActive: boolean;
}

interface UseScrollBehaviorReturn {
  containerRef: React.RefObject<HTMLDivElement | null>;
  bottomRef: React.RefObject<HTMLDivElement | null>;
  autoScroll: boolean;
  scrollToBottom: (behavior?: ScrollBehavior) => void;
}

function distanceFromBottom(container: HTMLDivElement) {
  return container.scrollHeight - container.scrollTop - container.clientHeight;
}

/**
 * ccgui keeps scroll intent separate from content updates. In particular,
 * wheel-up pauses streaming follow immediately and a later scroll event is
 * not allowed to turn it back on until the user reaches the bottom again.
 */
export function useScrollBehavior({
  contentVersion,
  streamingActive,
}: UseScrollBehaviorOptions): UseScrollBehaviorReturn {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const userPausedRef = useRef(false);
  const atBottomRef = useRef(true);
  const autoScrollingRef = useRef(false);
  const [autoScroll, setAutoScroll] = useState(true);

  const syncAtBottom = useCallback((container: HTMLDivElement) => {
    const atBottom = distanceFromBottom(container) < BOTTOM_THRESHOLD_PX;
    atBottomRef.current = atBottom;
    if (!userPausedRef.current) setAutoScroll(atBottom);
  }, []);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'auto') => {
    const container = containerRef.current;
    const end = bottomRef.current;
    if (!container && !end) return;

    userPausedRef.current = false;
    atBottomRef.current = true;
    autoScrollingRef.current = true;
    setAutoScroll(true);

    if (container) {
      try {
        container.scrollTo({ top: container.scrollHeight, behavior });
      } catch {
        container.scrollTop = container.scrollHeight;
      }
    }
    if (end) {
      try {
        end.scrollIntoView({ block: 'end', behavior });
      } catch {
        try { end.scrollIntoView(false); } catch { /* older Electron */ }
      }
    }

    const release = () => { autoScrollingRef.current = false; };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(release);
    else window.setTimeout(release, 0);
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let scrollFrame: number | null = null;
    const handleScroll = () => {
      if (scrollFrame !== null) return;
      const update = () => {
        scrollFrame = null;
        if (autoScrollingRef.current || userPausedRef.current) return;
        syncAtBottom(container);
      };
      scrollFrame = typeof requestAnimationFrame === 'function'
        ? requestAnimationFrame(update)
        : window.setTimeout(update, 0);
    };

    let wheelFrame: number | null = null;
    const handleWheel = (event: WheelEvent) => {
      if (event.deltaY < 0) {
        userPausedRef.current = true;
        atBottomRef.current = false;
        setAutoScroll(false);
        return;
      }
      if (event.deltaY <= 0) return;
      if (wheelFrame !== null) {
        if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(wheelFrame);
        else window.clearTimeout(wheelFrame);
      }
      const update = () => {
        wheelFrame = null;
        if (distanceFromBottom(container) < BOTTOM_THRESHOLD_PX) {
          userPausedRef.current = false;
          syncAtBottom(container);
        }
      };
      wheelFrame = typeof requestAnimationFrame === 'function'
        ? requestAnimationFrame(update)
        : window.setTimeout(update, 0);
    };

    container.addEventListener('scroll', handleScroll, { passive: true });
    container.addEventListener('wheel', handleWheel, { passive: true });
    syncAtBottom(container);
    return () => {
      container.removeEventListener('scroll', handleScroll);
      container.removeEventListener('wheel', handleWheel);
      if (scrollFrame !== null) {
        if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(scrollFrame);
        else window.clearTimeout(scrollFrame);
      }
      if (wheelFrame !== null) {
        if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(wheelFrame);
        else window.clearTimeout(wheelFrame);
      }
    };
  }, [syncAtBottom]);

  useLayoutEffect(() => {
    if (userPausedRef.current || !atBottomRef.current) return;
    scrollToBottom('auto');
  }, [contentVersion, streamingActive, scrollToBottom]);

  useEffect(() => {
    const container = containerRef.current;
    const content = container?.firstElementChild;
    if (!container || !content || typeof ResizeObserver === 'undefined') return;

    const observer = new ResizeObserver(() => {
      if (!userPausedRef.current && atBottomRef.current) scrollToBottom('auto');
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, [scrollToBottom]);

  return { containerRef, bottomRef, autoScroll, scrollToBottom };
}


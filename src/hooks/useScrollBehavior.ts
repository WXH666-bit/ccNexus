import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  createFrameScheduler,
  createScrollController,
  startSmoothScrollMonitor,
} from '../utils/scrollFollowPolicy.js';

const SCROLL_ANCHOR_ENABLED_CLASS = 'scroll-anchor-enabled';

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

function distanceFromBottom(container: HTMLDivElement): number {
  return container.scrollHeight - container.scrollTop - container.clientHeight;
}

function scheduleFrame(callback: () => void): number {
  if (typeof requestAnimationFrame === 'function') {
    return requestAnimationFrame(callback);
  }
  return window.setTimeout(callback, 0);
}

function cancelFrame(frame: number): void {
  if (typeof cancelAnimationFrame === 'function') {
    cancelAnimationFrame(frame);
  } else {
    window.clearTimeout(frame);
  }
}

export function useScrollBehavior({
  contentVersion,
  streamingActive,
}: UseScrollBehaviorOptions): UseScrollBehaviorReturn {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const userPausedRef = useRef(false);
  const atBottomRef = useRef(true);
  const scrollSchedulerRef = useRef<ReturnType<typeof createFrameScheduler> | null>(null);
  const scrollControllerRef = useRef<ReturnType<typeof createScrollController> | null>(null);
  const smoothScrollCleanupRef = useRef<(() => void) | null>(null);
  const programmaticReleaseRef = useRef<number | null>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  if (scrollSchedulerRef.current === null) {
    scrollSchedulerRef.current = createFrameScheduler({
      requestFrame: (callback) => scheduleFrame(callback),
      cancelFrame,
    });
  }

  if (scrollControllerRef.current === null && scrollSchedulerRef.current) {
    scrollControllerRef.current = createScrollController({
      scheduler: scrollSchedulerRef.current,
    });
  }

  const syncScrollAnchoring = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    const shouldEnableAnchoring = userPausedRef.current || !atBottomRef.current;
    container.classList.toggle(SCROLL_ANCHOR_ENABLED_CLASS, shouldEnableAnchoring);
  }, []);

  const syncControllerState = useCallback(
    (state?: { userPaused: boolean; atBottom: boolean; autoScrolling: boolean }) => {
      const nextState = state ?? scrollControllerRef.current?.state;
      if (!nextState) return;

      userPausedRef.current = nextState.userPaused;
      atBottomRef.current = nextState.atBottom;
      setAutoScroll(!nextState.userPaused && nextState.atBottom);
      syncScrollAnchoring();
    },
    [syncScrollAnchoring],
  );

  const clearProgrammaticRelease = useCallback(() => {
    const frame = programmaticReleaseRef.current;
    if (frame === null) return;

    cancelFrame(frame);
    programmaticReleaseRef.current = null;
  }, []);

  const clearSmoothScrollLifecycle = useCallback(() => {
    const cleanup = smoothScrollCleanupRef.current;
    if (!cleanup) return;

    cleanup();
  }, []);

  const syncAtBottom = useCallback(
    (container: HTMLDivElement) => {
      const controller = scrollControllerRef.current;
      if (!controller) return;

      syncControllerState(controller.handleScroll(distanceFromBottom(container)));
    },
    [syncControllerState],
  );

  const startSmoothScrollLifecycle = useCallback(() => {
    clearSmoothScrollLifecycle();

    const container = containerRef.current;
    const controller = scrollControllerRef.current;
    if (!controller) return;

    if (!container) {
      syncControllerState(controller.finishProgrammaticScroll(0));
      return;
    }

    let cleanup: (() => void) | null = null;
    const monitor = startSmoothScrollMonitor({
      requestFrame: scheduleFrame,
      cancelFrame,
      setDeadline: (callback, delayMs) => window.setTimeout(callback, delayMs),
      clearDeadline: (deadline) => window.clearTimeout(deadline),
      subscribeScrollEnd: (callback) => {
        container.addEventListener('scrollend', callback);
        return () => container.removeEventListener('scrollend', callback);
      },
      readDistance: () => distanceFromBottom(container),
      onFinish: (distance) => {
        if (cleanup && smoothScrollCleanupRef.current === cleanup) {
          smoothScrollCleanupRef.current = null;
        }
        syncControllerState(controller.finishProgrammaticScroll(distance));
      },
    });

    cleanup = () => {
      monitor.cancel();
      if (smoothScrollCleanupRef.current === cleanup) {
        smoothScrollCleanupRef.current = null;
      }
    };
    smoothScrollCleanupRef.current = cleanup;
  }, [clearSmoothScrollLifecycle, syncControllerState]);

  const scrollToBottom = useCallback(
    (behavior: ScrollBehavior = 'auto') => {
      const container = containerRef.current;
      const end = bottomRef.current;
      const controller = scrollControllerRef.current;
      if ((!container && !end) || !controller) return;

      clearSmoothScrollLifecycle();
      clearProgrammaticRelease();
      syncControllerState(controller.beginProgrammaticScroll(behavior));

      if (behavior === 'auto') {
        // Force layout before the final scroll so a newly streamed message cannot
        // leave the viewport one layout pass behind the actual content height.
        if (end) {
          void end.getBoundingClientRect();
          void end.offsetTop;
        }

        if (container) {
          container.scrollTop = container.scrollHeight;
        }
        if (end) {
          try {
            end.scrollIntoView({ block: 'end', behavior: 'auto' });
          } catch {
            try {
              end.scrollIntoView(false);
            } catch {
              // The container scroll above is sufficient in older webviews.
            }
          }
        }
      } else {
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
            try {
              end.scrollIntoView(false);
            } catch {
              // The container scroll above is sufficient in older webviews.
            }
          }
        }
      }

      if (behavior === 'smooth') {
        startSmoothScrollLifecycle();
        return;
      }

      programmaticReleaseRef.current = scheduleFrame(() => {
        programmaticReleaseRef.current = null;
        const currentContainer = containerRef.current;
        const distance = currentContainer ? distanceFromBottom(currentContainer) : 0;
        syncControllerState(controller.finishProgrammaticScroll(distance));
      });
    },
    [
      clearProgrammaticRelease,
      clearSmoothScrollLifecycle,
      startSmoothScrollLifecycle,
      syncControllerState,
    ],
  );

  const scheduleScrollToBottom = useCallback(() => {
    const controller = scrollControllerRef.current;
    if (!controller) return;

    controller.scheduleAutoScroll(() => {
      scrollToBottom('auto');
    });
  }, [scrollToBottom]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let scrollFrame: number | null = null;
    const handleScroll = () => {
      const controller = scrollControllerRef.current;
      if (!controller) return;

      // Read the user's scroll intent immediately. The state update remains
      // frame-coalesced, but a queued content scroll must not win a race with
      // a scrollbar drag, keyboard scroll, search jump, or message anchor.
      syncControllerState(controller.handleScroll(distanceFromBottom(container)));

      if (scrollFrame !== null) return;

      const update = () => {
        scrollFrame = null;
        syncAtBottom(container);
      };

      scrollFrame = scheduleFrame(update);
    };

    let wheelFrame: number | null = null;
    const handleWheel = (event: WheelEvent) => {
      const controller = scrollControllerRef.current;
      if (!controller) return;

      if (event.deltaY < 0) {
        clearSmoothScrollLifecycle();
        clearProgrammaticRelease();
        syncControllerState(
          controller.handleWheel(event.deltaY, distanceFromBottom(container)),
        );
        return;
      }

      if (event.deltaY > 0) {
        controller.handleWheel(event.deltaY, distanceFromBottom(container));
        if (wheelFrame !== null) return;

        const update = () => {
          wheelFrame = null;
          syncAtBottom(container);
        };

        wheelFrame = scheduleFrame(update);
      }
    };

    container.addEventListener('scroll', handleScroll, { passive: true });
    container.addEventListener('wheel', handleWheel, { passive: true });
    syncAtBottom(container);

    return () => {
      container.removeEventListener('scroll', handleScroll);
      container.removeEventListener('wheel', handleWheel);
      if (scrollFrame !== null) {
        cancelFrame(scrollFrame);
      }
      if (wheelFrame !== null) {
        cancelFrame(wheelFrame);
      }
    };
  }, [
    clearProgrammaticRelease,
    clearSmoothScrollLifecycle,
    syncAtBottom,
    syncControllerState,
  ]);

  useLayoutEffect(() => {
    const controller = scrollControllerRef.current;
    if (!controller) return;

    // Message text and the content observer can both update during one turn.
    // Coalesce them so there is at most one automatic scroll per frame, and
    // discard a stale streaming frame when the turn has completed.
    controller.scheduleContentScroll(streamingActive, () => scrollToBottom('auto'));
  }, [contentVersion, scrollToBottom, streamingActive]);

  useEffect(() => {
    const container = containerRef.current;
    const content = container?.firstElementChild;
    if (!container || !content || typeof ResizeObserver === 'undefined') return;

    const observer = new ResizeObserver(() => {
      const controller = scrollControllerRef.current;
      if (!controller) return;

      const state = controller.state;
      if (state.userPaused || state.autoScrolling) {
        syncScrollAnchoring();
      } else if (state.atBottom) {
        scheduleScrollToBottom();
      } else {
        syncAtBottom(container);
      }
    });

    observer.observe(content);
    return () => observer.disconnect();
  }, [scheduleScrollToBottom, syncAtBottom, syncScrollAnchoring]);

  useEffect(() => {
    return () => {
      clearSmoothScrollLifecycle();
      clearProgrammaticRelease();
      scrollSchedulerRef.current?.cancel();
    };
  }, [clearProgrammaticRelease, clearSmoothScrollLifecycle]);

  return { containerRef, bottomRef, autoScroll, scrollToBottom };
}

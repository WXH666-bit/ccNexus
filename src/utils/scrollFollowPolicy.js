export const BOTTOM_THRESHOLD_PX = 100;
export const TRUE_BOTTOM_THRESHOLD_PX = 1;

export function createFrameScheduler({ requestFrame, cancelFrame }) {
  let pendingId = null;

  return {
    schedule(callback) {
      if (pendingId !== null) return false;

      pendingId = requestFrame(() => {
        pendingId = null;
        callback();
      });
      return true;
    },

    cancel() {
      if (pendingId === null) return false;

      cancelFrame(pendingId);
      pendingId = null;
      return true;
    },

    get pending() {
      return pendingId !== null;
    },
  };
}

export function getScrollIntent(distanceFromBottom, threshold = BOTTOM_THRESHOLD_PX) {
  const atBottom = distanceFromBottom < threshold;
  return {
    atBottom,
    shouldCancelPendingAutoScroll: !atBottom,
  };
}

export function startSmoothScrollMonitor({
  requestFrame,
  cancelFrame,
  setDeadline,
  clearDeadline,
  subscribeScrollEnd,
  readDistance,
  onFinish,
  deadlineMs = 1200,
  targetThreshold = TRUE_BOTTOM_THRESHOLD_PX,
}) {
  let active = true;
  let frameId = null;
  let deadlineId = null;
  let unsubscribeScrollEnd = () => {};

  const cancel = () => {
    if (!active) return false;
    active = false;

    if (frameId !== null) {
      cancelFrame(frameId);
      frameId = null;
    }
    if (deadlineId !== null) {
      clearDeadline(deadlineId);
      deadlineId = null;
    }

    unsubscribeScrollEnd();
    unsubscribeScrollEnd = () => {};
    return true;
  };

  const finish = () => {
    if (!active) return false;

    const distanceFromBottom = readDistance();
    cancel();
    onFinish(distanceFromBottom);
    return true;
  };

  const poll = () => {
    if (!active) return;
    frameId = null;

    if (getScrollIntent(readDistance(), targetThreshold).atBottom) {
      finish();
      return;
    }

    frameId = requestFrame(poll);
  };

  unsubscribeScrollEnd = subscribeScrollEnd(finish) ?? (() => {});
  frameId = requestFrame(poll);
  deadlineId = setDeadline(() => {
    deadlineId = null;
    finish();
  }, deadlineMs);

  return {
    cancel,
    get active() {
      return active;
    },
  };
}

export function createScrollController({
  scheduler,
  bottomThreshold = BOTTOM_THRESHOLD_PX,
  resumeThreshold = TRUE_BOTTOM_THRESHOLD_PX,
}) {
  let userPaused = false;
  let atBottom = true;
  let autoScrolling = false;
  let programmaticScrollBehavior = 'auto';
  let waitingForUserScroll = false;

  const snapshot = () => ({ userPaused, atBottom, autoScrolling });
  const isAtTrueBottom = (distanceFromBottom) =>
    getScrollIntent(distanceFromBottom, resumeThreshold).atBottom;

  const scheduleAutoScroll = (scroll) => {
    return scheduler.schedule(() => {
      if (userPaused || !atBottom || autoScrolling) return;
      scroll();
    });
  };

  const cancelAutoScroll = () => scheduler.cancel();

  return {
    get state() {
      return snapshot();
    },

    scheduleAutoScroll,
    cancelAutoScroll,

    scheduleContentScroll(streamingActive, scroll) {
      if (streamingActive) {
        return scheduleAutoScroll(scroll);
      }

      cancelAutoScroll();
      const smoothScrollRunning = autoScrolling && programmaticScrollBehavior === 'smooth';
      if (userPaused || !atBottom || smoothScrollRunning) return false;

      scroll();
      return true;
    },

    beginProgrammaticScroll(behavior = 'auto') {
      cancelAutoScroll();
      userPaused = false;
      atBottom = true;
      autoScrolling = true;
      programmaticScrollBehavior = behavior;
      waitingForUserScroll = false;
      return snapshot();
    },

    finishProgrammaticScroll(distanceFromBottom = 0) {
      autoScrolling = false;
      const intent = getScrollIntent(distanceFromBottom, bottomThreshold);
      atBottom = intent.atBottom;
      if (intent.shouldCancelPendingAutoScroll) cancelAutoScroll();
      return snapshot();
    },

    handleWheel(deltaY, distanceFromBottom = 0) {
      if (autoScrolling && deltaY >= 0) return snapshot();

      if (deltaY < 0) {
        autoScrolling = false;
        userPaused = true;
        atBottom = false;
        waitingForUserScroll = isAtTrueBottom(distanceFromBottom);
        cancelAutoScroll();
      }

      return snapshot();
    },

    handleScroll(distanceFromBottom) {
      if (autoScrolling) return snapshot();

      if (userPaused) {
        // A wheel event can arrive before the browser emits the corresponding
        // scroll event. Do not mistake that first unchanged position for an
        // explicit return to the true bottom.
        if (waitingForUserScroll) {
          if (!isAtTrueBottom(distanceFromBottom)) {
            waitingForUserScroll = false;
          }
          return snapshot();
        }

        if (isAtTrueBottom(distanceFromBottom)) {
          userPaused = false;
          atBottom = true;
        }
        return snapshot();
      }

      const intent = getScrollIntent(distanceFromBottom, bottomThreshold);
      atBottom = intent.atBottom;
      if (intent.shouldCancelPendingAutoScroll) cancelAutoScroll();
      return snapshot();
    },
  };
}

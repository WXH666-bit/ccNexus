export const BOTTOM_THRESHOLD_PX: number;
export const TRUE_BOTTOM_THRESHOLD_PX: number;

export interface FrameSchedulerAdapter {
  requestFrame(callback: () => void): number;
  cancelFrame(id: number): void;
}

export interface FrameScheduler {
  schedule(callback: () => void): boolean;
  cancel(): boolean;
  readonly pending: boolean;
}

export declare function createFrameScheduler(adapter: FrameSchedulerAdapter): FrameScheduler;

export interface ScrollIntent {
  atBottom: boolean;
  shouldCancelPendingAutoScroll: boolean;
}

export declare function getScrollIntent(distanceFromBottom: number, threshold?: number): ScrollIntent;

export interface SmoothScrollMonitor {
  cancel(): boolean;
  readonly active: boolean;
}

export interface SmoothScrollMonitorOptions {
  requestFrame(callback: () => void): number;
  cancelFrame(id: number): void;
  setDeadline(callback: () => void, delayMs: number): number;
  clearDeadline(id: number): void;
  subscribeScrollEnd(callback: () => void): void | (() => void);
  readDistance(): number;
  onFinish(distanceFromBottom: number): void;
  deadlineMs?: number;
  targetThreshold?: number;
}

export declare function startSmoothScrollMonitor(
  options: SmoothScrollMonitorOptions,
): SmoothScrollMonitor;

export interface ScrollControllerState {
  userPaused: boolean;
  atBottom: boolean;
  autoScrolling: boolean;
}

export interface ScrollController {
  readonly state: ScrollControllerState;
  scheduleAutoScroll(scroll: () => void): boolean;
  cancelAutoScroll(): boolean;
  scheduleContentScroll(streamingActive: boolean, scroll: () => void): boolean;
  beginProgrammaticScroll(behavior?: ScrollBehavior): ScrollControllerState;
  finishProgrammaticScroll(distanceFromBottom?: number): ScrollControllerState;
  handleWheel(deltaY: number, distanceFromBottom?: number): ScrollControllerState;
  handleScroll(distanceFromBottom: number): ScrollControllerState;
}

export interface ScrollControllerOptions {
  scheduler: FrameScheduler;
  bottomThreshold?: number;
  resumeThreshold?: number;
}

export declare function createScrollController(options: ScrollControllerOptions): ScrollController;

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import * as scrollPolicy from '../src/utils/scrollFollowPolicy.js';
import {
  BOTTOM_THRESHOLD_PX,
  TRUE_BOTTOM_THRESHOLD_PX,
  createFrameScheduler,
  createScrollController,
  getScrollIntent,
} from '../src/utils/scrollFollowPolicy.js';

const root = path.resolve(process.cwd());
const read = (relativePath) => readFileSync(path.join(root, relativePath), 'utf8').replaceAll('\r\n', '\n');

function createManualFrameQueue() {
  const callbacks = new Map();
  let nextId = 1;

  return {
    requestFrame(callback) {
      const id = nextId++;
      callbacks.set(id, callback);
      return id;
    },
    cancelFrame(id) {
      callbacks.delete(id);
    },
    flush() {
      const pending = [...callbacks.values()];
      callbacks.clear();
      pending.forEach((callback) => callback());
    },
    get size() {
      return callbacks.size;
    },
  };
}

test('message streaming uses instant scroll and explicit scroll anchoring', () => {
  const styles = read('src/index.css');
  const messageListRule = styles.match(/\.message-list\s*\{[\s\S]*?\n\}/)?.[0] || '';
  const anchorRule = styles.match(/\.message-list\.scroll-anchor-enabled\s*\{[\s\S]*?\n\}/)?.[0] || '';

  assert.doesNotMatch(messageListRule, /scroll-behavior\s*:\s*smooth/);
  assert.match(messageListRule, /overflow-anchor\s*:\s*none/);
  assert.match(anchorRule, /overflow-anchor\s*:\s*auto/);
});

test('automatic scroll requests are coalesced into one frame', () => {
  const frames = createManualFrameQueue();
  const scheduler = createFrameScheduler(frames);
  const controller = createScrollController({ scheduler });
  let scrollCount = 0;

  controller.scheduleAutoScroll(() => { scrollCount += 1; });
  controller.scheduleAutoScroll(() => { scrollCount += 1; });

  assert.equal(frames.size, 1);
  frames.flush();
  assert.equal(scrollCount, 1);
});

test('leaving the bottom cancels a queued automatic scroll', () => {
  const frames = createManualFrameQueue();
  const scheduler = createFrameScheduler(frames);
  const controller = createScrollController({ scheduler });
  let scrollCount = 0;

  controller.scheduleAutoScroll(() => { scrollCount += 1; });
  const state = controller.handleScroll(BOTTOM_THRESHOLD_PX + 1);

  frames.flush();
  assert.equal(state.atBottom, false);
  assert.equal(scrollCount, 0);
});

test('returning within the bottom threshold does not cancel follow mode', () => {
  const intent = getScrollIntent(BOTTOM_THRESHOLD_PX - 1);

  assert.equal(intent.atBottom, true);
  assert.equal(intent.shouldCancelPendingAutoScroll, false);
});

test('ending streaming cancels the queued frame before the final immediate scroll', () => {
  const frames = createManualFrameQueue();
  const scheduler = createFrameScheduler(frames);
  const controller = createScrollController({ scheduler });
  let scrollCount = 0;

  controller.scheduleContentScroll(true, () => { scrollCount += 1; });
  controller.scheduleContentScroll(false, () => { scrollCount += 1; });

  frames.flush();
  assert.equal(scrollCount, 1);
});

test('ending streaming does not replace an active smooth scroll with an instant jump', () => {
  const frames = createManualFrameQueue();
  const controller = createScrollController({ scheduler: createFrameScheduler(frames) });
  let scrollCount = 0;

  controller.beginProgrammaticScroll('smooth');
  const accepted = controller.scheduleContentScroll(false, () => { scrollCount += 1; });

  assert.equal(accepted, false);
  assert.equal(scrollCount, 0);
  assert.equal(controller.state.autoScrolling, true);
});

test('ending streaming still performs the final scroll while an instant scroll is active', () => {
  const frames = createManualFrameQueue();
  const controller = createScrollController({ scheduler: createFrameScheduler(frames) });
  let scrollCount = 0;

  controller.beginProgrammaticScroll('auto');
  const accepted = controller.scheduleContentScroll(false, () => { scrollCount += 1; });

  assert.equal(accepted, true);
  assert.equal(scrollCount, 1);
});

test('wheel pause is not cleared by the first near-bottom scroll event', () => {
  const frames = createManualFrameQueue();
  const controller = createScrollController({ scheduler: createFrameScheduler(frames) });

  controller.handleWheel(-40, 0);
  const state = controller.handleScroll(0);

  assert.equal(state.userPaused, true);
  assert.equal(state.atBottom, false);
});

test('wheel pause resumes after a later true-bottom scroll', () => {
  const frames = createManualFrameQueue();
  const controller = createScrollController({ scheduler: createFrameScheduler(frames) });

  controller.handleWheel(-40, 0);
  controller.handleScroll(TRUE_BOTTOM_THRESHOLD_PX + 10);
  const state = controller.handleScroll(0);

  assert.equal(state.userPaused, false);
  assert.equal(state.atBottom, true);
});

test('an End jump resumes follow when wheel-up happened away from the bottom', () => {
  const frames = createManualFrameQueue();
  const controller = createScrollController({ scheduler: createFrameScheduler(frames) });

  controller.handleWheel(-40, BOTTOM_THRESHOLD_PX + 200);
  const state = controller.handleScroll(0);

  assert.equal(state.userPaused, false);
  assert.equal(state.atBottom, true);
});

test('programmatic smooth scrolling ignores intermediate scroll positions', () => {
  const frames = createManualFrameQueue();
  const controller = createScrollController({ scheduler: createFrameScheduler(frames) });

  controller.beginProgrammaticScroll('smooth');
  const duringScroll = controller.handleScroll(BOTTOM_THRESHOLD_PX + 200);

  assert.equal(duringScroll.autoScrolling, true);
  assert.equal(duringScroll.atBottom, true);

  const afterScroll = controller.finishProgrammaticScroll(BOTTOM_THRESHOLD_PX + 200);
  assert.equal(afterScroll.autoScrolling, false);
  assert.equal(afterScroll.atBottom, false);
});

test('wheel-up interrupts programmatic smooth scrolling and pauses follow', () => {
  const frames = createManualFrameQueue();
  const controller = createScrollController({ scheduler: createFrameScheduler(frames) });

  controller.beginProgrammaticScroll('smooth');
  const state = controller.handleWheel(-40, 120);

  assert.equal(state.autoScrolling, false);
  assert.equal(state.userPaused, true);
});

test('smooth scrollend completes once and releases fallback resources', () => {
  assert.equal(typeof scrollPolicy.startSmoothScrollMonitor, 'function');

  const frames = createManualFrameQueue();
  let scrollEnd = null;
  let deadlineCallback = null;
  let deadlineCleared = false;
  let unsubscribed = false;
  const completedDistances = [];

  const monitor = scrollPolicy.startSmoothScrollMonitor({
    requestFrame: (callback) => frames.requestFrame(callback),
    cancelFrame: (frame) => frames.cancelFrame(frame),
    setDeadline(callback) {
      deadlineCallback = callback;
      return 7;
    },
    clearDeadline(deadline) {
      assert.equal(deadline, 7);
      deadlineCleared = true;
      deadlineCallback = null;
    },
    subscribeScrollEnd(callback) {
      scrollEnd = callback;
      return () => { unsubscribed = true; };
    },
    readDistance: () => 42,
    onFinish: (distance) => completedDistances.push(distance),
  });

  assert.equal(frames.size, 1);
  assert.equal(typeof deadlineCallback, 'function');
  scrollEnd();
  scrollEnd();

  assert.deepEqual(completedDistances, [42]);
  assert.equal(monitor.active, false);
  assert.equal(frames.size, 0);
  assert.equal(deadlineCleared, true);
  assert.equal(unsubscribed, true);
});

test('smooth scroll polling finishes when the true bottom is reached', () => {
  const frames = createManualFrameQueue();
  let distance = 250;
  let deadlineCallback = null;
  let deadlineCleared = false;
  let unsubscribed = false;
  const completedDistances = [];

  const monitor = scrollPolicy.startSmoothScrollMonitor({
    requestFrame: (callback) => frames.requestFrame(callback),
    cancelFrame: (frame) => frames.cancelFrame(frame),
    setDeadline(callback) {
      deadlineCallback = callback;
      return 9;
    },
    clearDeadline(deadline) {
      assert.equal(deadline, 9);
      deadlineCleared = true;
      deadlineCallback = null;
    },
    subscribeScrollEnd: () => () => { unsubscribed = true; },
    readDistance: () => distance,
    onFinish: (finishedDistance) => completedDistances.push(finishedDistance),
  });

  frames.flush();
  assert.deepEqual(completedDistances, []);
  assert.equal(frames.size, 1);

  distance = 0;
  frames.flush();

  assert.deepEqual(completedDistances, [0]);
  assert.equal(monitor.active, false);
  assert.equal(frames.size, 0);
  assert.equal(deadlineCallback, null);
  assert.equal(deadlineCleared, true);
  assert.equal(unsubscribed, true);
});

test('cancelling a smooth scroll monitor prevents every late completion path', () => {
  const frames = createManualFrameQueue();
  let scrollEnd = null;
  let deadlineCallback = null;
  const completedDistances = [];

  const monitor = scrollPolicy.startSmoothScrollMonitor({
    requestFrame: (callback) => frames.requestFrame(callback),
    cancelFrame: (frame) => frames.cancelFrame(frame),
    setDeadline(callback) {
      deadlineCallback = callback;
      return 11;
    },
    clearDeadline: () => {},
    subscribeScrollEnd(callback) {
      scrollEnd = callback;
      return () => {};
    },
    readDistance: () => 0,
    onFinish: (distance) => completedDistances.push(distance),
  });

  const staleScrollEnd = scrollEnd;
  const staleDeadline = deadlineCallback;
  assert.equal(monitor.cancel(), true);
  assert.equal(monitor.cancel(), false);

  frames.flush();
  staleScrollEnd();
  staleDeadline();

  assert.deepEqual(completedDistances, []);
  assert.equal(monitor.active, false);
  assert.equal(frames.size, 0);
});

test('manual scroll-to-bottom keeps the smooth interaction', () => {
  const messageList = read('src/components/MessageList.tsx');

  assert.match(messageList, /scrollToBottom\('smooth'\)/);
});

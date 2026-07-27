export interface StreamDeltaNormalizerState {
  textBlockContentByIndex?: Map<number, string>;
  thinkingBlockContentByIndex?: Map<number, string>;
  blockStreamModeByKey?: Map<string, string>;
}

export function normalizeStreamDelta(
  turnState: StreamDeltaNormalizerState,
  kind: 'text' | 'thinking',
  index: number | string,
  incoming: string,
  origin?: 'stream' | 'snapshot',
): string;

export function resolveSnapshotDelta(
  turnState: StreamDeltaNormalizerState,
  kind: 'text' | 'thinking',
  index: number | string,
  snapshot: string,
): { delta: string; hadPrevious: boolean };

export function resetTurnBlockState(turnState: StreamDeltaNormalizerState): void;

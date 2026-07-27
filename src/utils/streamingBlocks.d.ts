import type { ContentBlock } from '../types';

export interface StreamingBlockState {
  blocks: ContentBlock[];
  activeBlockByIndex: Map<number, number>;
  partialToolInputs: Map<number, string>;
  textBlockContentByIndex: Map<number, string>;
  thinkingBlockContentByIndex: Map<number, string>;
  blockStreamModeByKey: Map<string, string>;
}

export function createStreamingBlockState(): StreamingBlockState;
export function resetStreamingBlockState(state: StreamingBlockState): void;
export function appendToolResultBlock(state: StreamingBlockState, block: ContentBlock): ContentBlock[];
export function applyStreamEventToBlocks(
  state: StreamingBlockState,
  event: Record<string, unknown>,
): ContentBlock[];

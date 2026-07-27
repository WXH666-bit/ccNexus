function getBlockMap(turnState, key) {
  if (!(turnState[key] instanceof Map)) {
    turnState[key] = new Map();
  }
  return turnState[key];
}

function getBlockIndex(index) {
  const numericIndex = typeof index === 'string' ? Number(index) : index;
  return Number.isInteger(numericIndex) && numericIndex >= 0 ? numericIndex : 0;
}

function getModeMap(turnState) {
  if (!(turnState.blockStreamModeByKey instanceof Map)) {
    turnState.blockStreamModeByKey = new Map();
  }
  return turnState.blockStreamModeByKey;
}

function modeKey(kind, blockIndex) {
  return `${kind}:${blockIndex}`;
}

function computeNovelDelta(previous, incoming, mode, origin) {
  if (!incoming) return { novel: '', next: previous, mode };
  if (!previous) return { novel: incoming, next: incoming, mode };

  if (incoming.startsWith(previous)) {
    const novel = incoming.slice(previous.length);
    if (!novel) {
      if (origin === 'snapshot' || mode === 'snapshot' || mode === 'incremental') {
        return { novel: '', next: previous, mode };
      }
      return { novel: incoming, next: previous + incoming, mode };
    }
    return { novel, next: incoming, mode: 'snapshot' };
  }

  if (mode === 'snapshot' && (previous.startsWith(incoming) || previous.endsWith(incoming))) {
    return { novel: '', next: previous, mode };
  }

  if (mode === 'snapshot') {
    return { novel: '', next: incoming, mode };
  }

  return { novel: incoming, next: previous + incoming, mode: 'incremental' };
}

export function normalizeStreamDelta(turnState, kind, index, incoming, origin = 'stream') {
  const text = typeof incoming === 'string' ? incoming : '';
  const key = kind === 'thinking' ? 'thinkingBlockContentByIndex' : 'textBlockContentByIndex';
  const blockMap = getBlockMap(turnState, key);
  const blockIndex = getBlockIndex(index);
  const previous = blockMap.get(blockIndex) || '';

  const modeMap = getModeMap(turnState);
  const mKey = modeKey(kind, blockIndex);
  const mode = modeMap.get(mKey);

  const result = computeNovelDelta(previous, text, mode, origin);
  blockMap.set(blockIndex, result.next);
  if (result.mode && result.mode !== mode) {
    modeMap.set(mKey, result.mode);
  }
  return result.novel;
}

export function resolveSnapshotDelta(turnState, kind, index, snapshot) {
  const key = kind === 'thinking' ? 'thinkingBlockContentByIndex' : 'textBlockContentByIndex';
  const blockMap = getBlockMap(turnState, key);
  const blockIndex = getBlockIndex(index);
  const hadPrevious = (blockMap.get(blockIndex) || '').length > 0;
  const delta = normalizeStreamDelta(turnState, kind, blockIndex, snapshot, 'snapshot');
  return { delta, hadPrevious };
}

export function resetTurnBlockState(turnState) {
  turnState.textBlockContentByIndex = new Map();
  turnState.thinkingBlockContentByIndex = new Map();
  turnState.blockStreamModeByKey = new Map();
}

export const CLAUDE_MODELS = [
  {
    id: 'claude-opus-4-8',
    label: 'Opus 4.8',
    subtitle: 'Opus 4.8 · 最新最强大的模型',
    mappingKey: 'opus',
  },
  {
    id: 'claude-opus-4-6',
    label: 'Opus 4.7',
    subtitle: 'Opus 4.7 · 上一个旗舰模型',
    mappingKey: 'opus',
  },
  {
    id: 'claude-fable-5',
    label: 'Fable 5',
    subtitle: 'Fable 5 · 最强大 · Mythos 级',
    mappingKey: undefined,
  },
  {
    id: 'claude-sonnet-4-6',
    label: 'Sonnet 4.6',
    subtitle: 'Sonnet 4.6 · 默认推荐模型',
    mappingKey: 'sonnet',
  },
  {
    id: 'claude-haiku-4-5',
    label: 'Haiku',
    subtitle: 'Haiku 速度最快，适合快速答复',
    mappingKey: 'haiku',
  },
];

const MODEL_BY_ID = new Map(CLAUDE_MODELS.map(model => [model.id, model]));

function clean(value) {
  return typeof value === 'string' ? value.trim() : '';
}

const MODEL_MAPPING_ENV_KEYS = {
  opus: 'ANTHROPIC_DEFAULT_OPUS_MODEL',
  sonnet: 'ANTHROPIC_DEFAULT_SONNET_MODEL',
  haiku: 'ANTHROPIC_DEFAULT_HAIKU_MODEL',
};

function resolveMappedModelName(mappingKey, env = {}) {
  if (!mappingKey) return clean(env.ANTHROPIC_MODEL) || undefined;
  return clean(env[MODEL_MAPPING_ENV_KEYS[mappingKey]]) || clean(env.ANTHROPIC_MODEL) || undefined;
}

function applyRequestedLongContextSuffix(mappedModelId, requestedModelId) {
  const cleaned = clean(mappedModelId);
  if (!cleaned) return '';
  const base = stripLongContextSuffix(cleaned);
  return /\[1m\]$/i.test(clean(requestedModelId)) ? `${base}[1m]` : base;
}

export function stripLongContextSuffix(modelId) {
  return clean(modelId).replace(/\[1m\]$/i, '');
}

export function modelSupportsLongContext(modelId) {
  const stripped = stripLongContextSuffix(modelId);
  return stripped !== '' && stripped !== 'default' && !stripped.toLowerCase().includes('haiku');
}

export function applyLongContextSuffix(modelId, enabled) {
  const stripped = stripLongContextSuffix(modelId);
  if (!enabled || !modelSupportsLongContext(stripped)) {
    return stripped;
  }
  return `${stripped}[1m]`;
}

export function resolveBackendModel(modelId, env = {}) {
  const requestedModelId = clean(modelId);
  const stripped = stripLongContextSuffix(modelId);

  const model = MODEL_BY_ID.get(stripped);
  if (!model) {
    return applyRequestedLongContextSuffix(requestedModelId, requestedModelId) || 'default';
  }

  const mapped = resolveMappedModelName(model.mappingKey, env);
  return mapped
    ? applyRequestedLongContextSuffix(mapped, requestedModelId)
    : applyRequestedLongContextSuffix(stripped, requestedModelId);
}

export function resolveModelDisplay(modelId, env = {}) {
  const stripped = stripLongContextSuffix(modelId);
  const model = MODEL_BY_ID.get(stripped);

  if (!model) {
    const resolvedId = resolveBackendModel(modelId, env);
    return {
      modelId: stripped || 'default',
      label: resolvedId || 'default',
      subtitle: stripped && stripped !== resolvedId ? stripped : undefined,
      resolvedId,
    };
  }

  const resolvedId = resolveMappedModelName(model.mappingKey, env) || stripped;

  return {
    modelId: model.id,
    label: resolvedId === model.id ? model.label : resolvedId,
    subtitle: model.subtitle,
    resolvedId,
  };
}

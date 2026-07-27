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
    mappingKey: 'sonnet',
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
  const stripped = stripLongContextSuffix(modelId);

  if (clean(env.ANTHROPIC_MODEL)) {
    return clean(env.ANTHROPIC_MODEL);
  }

  const model = MODEL_BY_ID.get(stripped);
  if (!model) {
    return stripped || 'default';
  }

  const mapped = {
    opus: env.ANTHROPIC_DEFAULT_OPUS_MODEL,
    sonnet: env.ANTHROPIC_DEFAULT_SONNET_MODEL,
    haiku: env.ANTHROPIC_DEFAULT_HAIKU_MODEL,
  }[model.mappingKey];

  return clean(mapped) || stripped;
}

export function resolveModelDisplay(modelId, env = {}) {
  const stripped = stripLongContextSuffix(modelId);
  const model = MODEL_BY_ID.get(stripped);
  const resolvedId = resolveBackendModel(stripped, env);

  if (!model) {
    return {
      modelId: stripped || 'default',
      label: resolvedId || 'default',
      subtitle: stripped && stripped !== resolvedId ? stripped : undefined,
      resolvedId,
    };
  }

  return {
    modelId: model.id,
    label: resolvedId === model.id ? model.label : resolvedId,
    subtitle: model.subtitle,
    resolvedId,
  };
}

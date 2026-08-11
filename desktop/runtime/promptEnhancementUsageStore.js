import { promises as fs } from 'node:fs';
import path from 'node:path';

const USAGE_DIRECTORY = '.ccnexus';
const USAGE_FILENAME = 'prompt-enhancement-usage.jsonl';

function tokenValue(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function normalizeUsage(usage) {
  if (!usage || typeof usage !== 'object') return null;
  const input_tokens = tokenValue(usage.input_tokens);
  const output_tokens = tokenValue(usage.output_tokens);
  const cache_creation_input_tokens = tokenValue(
    usage.cache_creation_input_tokens === undefined ? 0 : usage.cache_creation_input_tokens,
  );
  const cache_read_input_tokens = tokenValue(
    usage.cache_read_input_tokens === undefined ? 0 : usage.cache_read_input_tokens,
  );
  if (
    input_tokens === null
    || output_tokens === null
    || cache_creation_input_tokens === null
    || cache_read_input_tokens === null
  ) {
    return null;
  }
  if (input_tokens + output_tokens + cache_creation_input_tokens + cache_read_input_tokens === 0) return null;
  return {
    input_tokens,
    output_tokens,
    cache_creation_input_tokens,
    cache_read_input_tokens,
  };
}

function normalizeRecord(record) {
  if (!record || typeof record !== 'object') return null;
  const id = typeof record.id === 'string' ? record.id.trim() : '';
  const cwd = typeof record.cwd === 'string' ? record.cwd.trim() : '';
  const model = typeof record.model === 'string' ? record.model.trim() : '';
  const timestamp = typeof record.timestamp === 'number'
    ? record.timestamp
    : Date.parse(record.timestamp || '');
  const usage = normalizeUsage(record.usage);
  if (!id || !cwd || !model || !Number.isFinite(timestamp) || !usage) return null;
  return {
    id,
    timestamp,
    cwd: path.resolve(cwd),
    model,
    usage,
  };
}

export function createPromptEnhancementUsageStore({ homeDir } = {}) {
  if (typeof homeDir !== 'string' || !homeDir.trim()) {
    throw new Error('Prompt enhancement usage store requires a homeDir');
  }

  const usageFile = path.join(homeDir, USAGE_DIRECTORY, USAGE_FILENAME);

  return {
    async append(record) {
      const normalized = normalizeRecord(record);
      if (!normalized) throw new Error('Invalid prompt enhancement usage record');
      await fs.mkdir(path.dirname(usageFile), { recursive: true });
      await fs.appendFile(usageFile, `${JSON.stringify(normalized)}\n`, 'utf8');
      return normalized;
    },

    async list() {
      let raw = '';
      try {
        raw = await fs.readFile(usageFile, 'utf8');
      } catch (error) {
        if (error.code === 'ENOENT') return [];
        throw error;
      }

      const records = [];
      for (const line of raw.split(/\r?\n/)) {
        if (!line.trim()) continue;
        try {
          const normalized = normalizeRecord(JSON.parse(line));
          if (normalized) records.push(normalized);
        } catch {
          // Ignore malformed or partial JSONL lines.
        }
      }
      return records;
    },
  };
}

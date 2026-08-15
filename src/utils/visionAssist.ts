export interface VisionAssistConfig {
  enabled: boolean;
  baseUrl: string;
  apiKey: string;
  model: string;
  prompt: string;
}

const STORAGE_KEY = 'visionAssistConfig';

export const DEFAULT_VISION_CONFIG: VisionAssistConfig = {
  enabled: false,
  baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  apiKey: '',
  model: 'qwen3.6-plus',
  prompt: '请详细描述这张图片的内容，包括界面元素、文字、布局等关键信息',
};

export function loadVisionConfig(): VisionAssistConfig {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return { ...DEFAULT_VISION_CONFIG };
    return { ...DEFAULT_VISION_CONFIG, ...JSON.parse(saved) };
  } catch {
    return { ...DEFAULT_VISION_CONFIG };
  }
}

export function saveVisionConfig(config: VisionAssistConfig) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}

export function isVisionActive(config: VisionAssistConfig): boolean {
  return config.enabled && Boolean(config.baseUrl.trim()) && Boolean(config.apiKey.trim()) && Boolean(config.model.trim());
}

interface DescribeOptions {
  signal?: AbortSignal;
}

const VISION_MAX_IMAGE_DIMENSION = 1024;

/** 用 canvas 把大图最长边缩到 VISION_MAX_IMAGE_DIMENSION 内并转 JPEG，减小上传体积与推理耗时。 */
function downscaleImageDataUrl(dataUrl: string): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const width = img.naturalWidth;
        const height = img.naturalHeight;
        if (!width || !height) {
          resolve(dataUrl);
          return;
        }
        const scale = Math.min(1, VISION_MAX_IMAGE_DIMENSION / Math.max(width, height));
        if (scale >= 1) {
          resolve(dataUrl);
          return;
        }
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(width * scale);
        canvas.height = Math.round(height * scale);
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(dataUrl);
          return;
        }
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.85));
      } catch {
        resolve(dataUrl);
      }
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

/** 调用 OpenAI 兼容视觉接口返回文字描述；大图会先降采样到 1024px 内再发送。 */
export async function describeImage(config: VisionAssistConfig, dataUrl: string, options: DescribeOptions = {}): Promise<string> {
  // 发送前降采样，避免大图 base64 拖慢上传与推理导致超时。
  const imageUrl = await downscaleImageDataUrl(dataUrl);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);
  options.signal?.addEventListener('abort', () => controller.abort());
  try {
    const base = config.baseUrl.trim().replace(/\/+$/, '');
    const response = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey.trim()}`,
      },
      body: JSON.stringify({
        model: config.model.trim(),
        messages: [{
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: imageUrl } },
            { type: 'text', text: config.prompt || DEFAULT_VISION_CONFIG.prompt },
          ],
        }],
        max_tokens: 2048,
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      if (response.status === 401) throw new Error('API Key 无效（401）');
      if (response.status === 404) throw new Error('端点路径或模型名不存在（404）');
      throw new Error(`视觉模型返回 ${response.status}${body ? `：${body.slice(0, 120)}` : ''}`);
    }
    const data = await response.json();
    const text = data?.choices?.[0]?.message?.content;
    if (!text || typeof text !== 'string') throw new Error('视觉模型返回了空内容');
    return text.trim();
  } catch (error) {
    if ((error as Error)?.name === 'AbortError') throw new Error('视觉模型响应超时（60 秒）');
    throw error instanceof Error ? error : new Error(String(error));
  } finally {
    clearTimeout(timeout);
  }
}

/** 测试连接：用 1x1 PNG 发一次最小请求 */
export async function testVisionConnection(config: VisionAssistConfig): Promise<void> {
  // 用一张 64x64 的纯色 PNG 做连通性测试（1x1 会被部分视觉模型以「尺寸不满足最小边长」拒绝）。
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAAl0lEQVR4nO3QMREAIBDAsNeGNxyzg4wMdMje66x97s9GB2gN0AFaA3SA1gAdoDVAB2gN0AFaA3SA1gAdoDVAB2gN0AFaA3SA1gAdoDVAB2gN0AFaA3SA1gAdoDVAB2gN0AFaA3SA1gAdoDVAB2gN0AFaA3SA1gAdoDVAB2gN0AFaA3SA1gAdoDVAB2gN0AFaA3SA1gAdoD0xn6KG7fvLKAAAAABJRU5ErkJggg==';
  await describeImage({ ...config, prompt: '这是一个连通性测试，请直接回复 ok' }, png);
}

// 段头格式 `[图片 N · name]` 被 server/claudeHistory.js 的
// DESCRIBED_IMAGE_BLOCK_HEADER_REGEX 依赖，修改格式需两侧同步。
/** 把多张图的描述拼成附加文本块 */
export function buildDescriptionBlock(names: string[], descriptions: string[]): string {
  return names.map((name, i) => `[图片 ${i + 1}${name ? ` · ${name}` : ''}]\n${descriptions[i]}`).join('\n\n');
}

import { useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import {
  loadVisionConfig,
  saveVisionConfig,
  testVisionConnection,
  type VisionAssistConfig,
} from '../../utils/visionAssist';

export default function VisionAssistSection() {
  const [config, setConfig] = useState<VisionAssistConfig>(() => loadVisionConfig());
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  const update = (patch: Partial<VisionAssistConfig>) => {
    const next = { ...config, ...patch };
    setConfig(next);
    saveVisionConfig(next);
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      await testVisionConnection(config);
      setTestResult({ ok: true, message: '✓ 连接成功' });
    } catch (error) {
      setTestResult({ ok: false, message: error instanceof Error ? error.message : String(error) });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="settings-section-content">
      <h3>视觉辅助</h3>
      <p className="settings-desc">
        为无视觉能力的模型（如 DeepSeek 等纯文本端点）自动转述图片。发送带图消息时，图片会先交由你配置的视觉模型生成文字描述，主模型收到的是描述文字而非原图。
      </p>

      <div className="setting-group">
        <label className="prompt-enhancer-toggle-row" htmlFor="vision-assist-enabled">
          <span className="prompt-enhancer-toggle-copy">
            <span className="prompt-enhancer-toggle-title">启用视觉辅助</span>
            <span className="setting-help">关闭时发图行为与之前一致</span>
          </span>
          <span className="toggle">
            <input
              id="vision-assist-enabled"
              type="checkbox"
              checked={config.enabled}
              onChange={(e) => update({ enabled: e.target.checked })}
            />
            <span className="toggle-slider"></span>
          </span>
        </label>
      </div>

      <div className="setting-group">
        <p className="setting-help">
          ⚠️ 开启后，你发送的图片将以 base64 形式直接发送至你配置的视觉模型端点。API Key 仅保存在本机 localStorage，不会上传到任何 ccNexus 服务器。
        </p>
      </div>

      {config.enabled && (
        <>
          <div className="setting-group">
            <label htmlFor="vision-base-url">端点 Base URL</label>
            <input
              id="vision-base-url"
              type="text"
              value={config.baseUrl}
              onChange={(e) => update({ baseUrl: e.target.value })}
              placeholder="DashScope compatible-mode 地址"
            />
          </div>

          <div className="setting-group">
            <label htmlFor="vision-api-key">API Key</label>
            <input
              id="vision-api-key"
              type="password"
              value={config.apiKey}
              onChange={(e) => update({ apiKey: e.target.value })}
              placeholder="sk-..."
              autoComplete="off"
            />
          </div>

          <div className="setting-group">
            <label htmlFor="vision-model">视觉模型</label>
            <input
              id="vision-model"
              type="text"
              value={config.model}
              onChange={(e) => update({ model: e.target.value })}
              placeholder="qwen3.6-plus"
            />
            <p className="setting-help">可选 qwen3.6-plus / qwen3.6-flash / qwen3.7-plus 或任意 OpenAI 兼容视觉模型</p>
          </div>

          <div className="setting-group">
            <label htmlFor="vision-prompt">转述提示词</label>
            <textarea
              id="vision-prompt"
              rows={3}
              value={config.prompt}
              onChange={(e) => update({ prompt: e.target.value })}
            />
          </div>

          <div className="setting-group">
            <button type="button" className="provider-secondary-button" onClick={() => void handleTest()} disabled={testing}>
              {testing && <LoaderCircle size={14} className="spin" />}
              {testing ? '测试中…' : '测试连接'}
            </button>
            {testResult && (
              <p className={`setting-help ${testResult.ok ? 'vision-test-ok' : 'vision-test-error'}`}>{testResult.message}</p>
            )}
          </div>

          <div className="setting-group">
            <p className="setting-help">
              💡 视觉转述仅在本机进行，不会重建对话查询，也不影响缓存前缀稳定性；带图消息文本更长，该轮缓存命中率可能略降，属正常现象。
            </p>
          </div>
        </>
      )}
    </div>
  );
}

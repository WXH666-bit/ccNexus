import { useState, useRef, useEffect } from 'react';
import { Brain } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface ReasoningLevel {
  value: string;
  label: string;
  icon: string;
  desc: string;
}

interface ReasoningSelectProps {
  value: string;
  onChange: (value: string) => void;
  currentModel: string;
  effortSupportedModels: Set<string>;
  xhighEffortModels: Set<string>;
  maxEffortModels: Set<string>;
  disabled?: boolean;
}

export default function ReasoningSelect({
  value,
  onChange,
  currentModel,
  effortSupportedModels,
  xhighEffortModels,
  maxEffortModels,
  disabled = false,
}: ReasoningSelectProps) {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // 档位定义：label 固定为英文，desc 使用 i18n 翻译
  const ALL_LEVELS: ReasoningLevel[] = [
    { value: 'low', label: 'Low', icon: '', desc: t('chat.reasoning.lowDesc') },
    { value: 'medium', label: 'Medium', icon: '', desc: t('chat.reasoning.mediumDesc') },
    { value: 'high', label: 'High', icon: '', desc: t('chat.reasoning.highDesc') },
    { value: 'xhigh', label: 'XHigh', icon: '', desc: t('chat.reasoning.xhighDesc') },
    { value: 'max', label: 'Max', icon: '', desc: t('chat.reasoning.maxDesc') },
  ];

  // 检查是否应该显示选择器
  // 当模型为 default（未指定）或为空时，显示选择器且 5 档全部可选
  // 当明确选中一个具体模型时，只有该模型在 effortSupportedModels 集合中才显示
  const isDefaultOrEmpty = !currentModel || currentModel === 'default';
  const isSupported = isDefaultOrEmpty || effortSupportedModels.has(currentModel);

  // 根据模型过滤可用的档位
  const availableLevels = ALL_LEVELS.filter(level => {
    // 对于 default 或空模型，5 档全部可选
    if (isDefaultOrEmpty) return true;
    // 对于具体模型，根据集合过滤
    if (level.value === 'max' && !maxEffortModels.has(currentModel)) return false;
    if (level.value === 'xhigh' && !xhighEffortModels.has(currentModel)) return false;
    return true;
  });

  // 点击外部关闭下拉
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // 如果不支持 effort，不渲染
  if (!isSupported) return null;

  const currentLevel = ALL_LEVELS.find(l => l.value === value) || ALL_LEVELS[2]; // 默认 high

  return (
    <div className="reasoning-select" ref={dropdownRef}>
      <button
        className={`reasoning-select-trigger ${disabled ? 'disabled' : ''}`}
        onClick={() => {
          if (!disabled) setIsOpen(!isOpen);
        }}
        disabled={disabled}
        title={t('chat.reasoning.title')}
      >
        <Brain size={14} />
        <span>{currentLevel.label}</span>
      </button>
      
      {isOpen && (
        <div className="reasoning-select-dropdown">
          {availableLevels.map(level => (
            <div
              key={level.value}
              className={`reasoning-select-option ${value === level.value ? 'active' : ''}`}
              onClick={() => {
                onChange(level.value);
                setIsOpen(false);
              }}
            >
              <div className="reasoning-option-content">
                <div className="reasoning-option-label">{level.label}</div>
                <div className="reasoning-option-desc">{level.desc}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

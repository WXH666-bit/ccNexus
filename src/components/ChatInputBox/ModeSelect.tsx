import { Check, ChevronDown, ChevronUp, MessageSquare, Pencil, ScrollText, Zap } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

interface ModeInfo {
  id: string;
  label: string;
  description: string;
  title: string;
  icon: typeof MessageSquare;
  auto?: boolean;
}

interface Props {
  value: string;
  onChange: (value: string) => void;
}

const MODES: ModeInfo[] = [
  {
    id: 'default',
    label: '默认模式',
    description: '每次操作前按默认权限确认',
    title: '默认模式',
    icon: MessageSquare,
  },
  {
    id: 'plan',
    label: '计划模式',
    description: '只读分析，先生成计划',
    title: '计划模式',
    icon: ScrollText,
  },
  {
    id: 'acceptEdits',
    label: '编辑',
    description: '自动接受文件创建和编辑',
    title: '编辑模式',
    icon: Pencil,
  },
  {
    id: 'bypassPermissions',
    label: '自动模式',
    description: '跳过权限确认，谨慎使用',
    title: '自动模式',
    icon: Zap,
    auto: true,
  },
];

export default function ModeSelect({ value, onChange }: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const currentMode = MODES.find(mode => mode.id === value) || MODES[0];
  const CurrentIcon = currentMode.icon;

  const handleToggle = useCallback((event: React.MouseEvent) => {
    event.stopPropagation();
    setIsOpen(open => !open);
  }, []);

  useEffect(() => {
    if (!isOpen) return;

    const timer = window.setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);
    }, 0);

    function handleClickOutside(event: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  return (
    <div className="mode-select-wrap" ref={rootRef}>
      <button
        type="button"
        className={`selector-button mode-select-trigger ${currentMode.auto ? 'mode-auto-active' : ''}`}
        onClick={handleToggle}
        title={currentMode.title}
      >
        <CurrentIcon size={15} />
        <span className="selector-button-text">{currentMode.label}</span>
        {isOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
      </button>

      {isOpen && (
        <div className="selector-dropdown mode-select-dropdown">
          {MODES.map(mode => {
            const Icon = mode.icon;
            const selected = mode.id === currentMode.id;

            return (
              <button
                key={mode.id}
                type="button"
                className={`selector-option mode-select-option ${selected ? 'selected' : ''}`}
                onClick={event => {
                  event.stopPropagation();
                  onChange(mode.id);
                  setIsOpen(false);
                }}
                title={mode.title}
              >
                <Icon size={16} className={mode.auto ? 'mode-auto-icon' : undefined} />
                <span className="mode-option-info">
                  <span className="mode-option-label">{mode.label}</span>
                  <span className="mode-option-description">{mode.description}</span>
                </span>
                {selected && <Check size={16} className="mode-option-check" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

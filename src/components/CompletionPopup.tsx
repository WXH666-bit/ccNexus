import { useState, useEffect, useRef, useCallback } from 'react';
import { FileText, Terminal, Sparkles, Command } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface CompletionItem {
  label: string;
  description?: string;
  icon?: 'file' | 'command' | 'dollar' | 'prompt';
  insertText: string;
}

interface CompletionPopupProps {
  visible: boolean;
  items: CompletionItem[];
  selectedIndex: number;
  onSelect: (item: CompletionItem) => void;
  position: { top: number; left: number };
}

export function CompletionPopup({ visible, items, selectedIndex, onSelect, position }: CompletionPopupProps) {
  if (!visible || items.length === 0) return null;

  return (
    <div
      className="completion-popup"
      style={{ top: position.top, left: position.left }}
    >
      {items.map((item, index) => (
        <div
          key={index}
          className={`completion-item ${index === selectedIndex ? 'selected' : ''}`}
          onClick={() => onSelect(item)}
        >
          <div className="completion-item-icon">
            {item.icon === 'file' && <FileText size={14} />}
            {item.icon === 'command' && <Command size={14} />}
            {item.icon === 'dollar' && <Terminal size={14} />}
            {item.icon === 'prompt' && <Sparkles size={14} />}
          </div>
          <div className="completion-item-content">
            <div className="completion-item-label">{item.label}</div>
            {item.description && (
              <div className="completion-item-desc">{item.description}</div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// Hook for managing completion triggers
export function useCompletionTriggers() {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(false);
  const [items, setItems] = useState<CompletionItem[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const [triggerType, setTriggerType] = useState<'file' | 'command' | 'dollar' | 'prompt' | null>(null);
  const [triggerQuery, setTriggerQuery] = useState('');
  const abortControllerRef = useRef<AbortController | null>(null);

  const fetchFiles = useCallback(async (query: string) => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();

    try {
      const res = await fetch(`/api/files/scan?q=${encodeURIComponent(query)}&limit=20`, {
        signal: abortControllerRef.current.signal,
      });
      const data = await res.json();
      return data.files || [];
    } catch (err: any) {
      if (err?.name !== 'AbortError') {
        console.error('Failed to fetch files:', err);
      }
      return [];
    }
  }, []);

  const fetchCommands = useCallback(async () => {
    try {
      const res = await fetch('/api/commands');
      const data = await res.json();
      return data.commands || [];
    } catch (err) {
      console.error('Failed to fetch commands:', err);
      return [];
    }
  }, []);

  const fetchPrompts = useCallback(async () => {
    try {
      const res = await fetch('/api/prompts');
      const data = await res.json();
      return data.prompts || [];
    } catch (err) {
      console.error('Failed to fetch prompts:', err);
      return [];
    }
  }, []);

  const checkTrigger = useCallback(async (text: string, cursorPosition: number, textareaRect: DOMRect) => {
    const textBeforeCursor = text.slice(0, cursorPosition);
    
    // Check for @ (file reference)
    const atMatch = textBeforeCursor.match(/@(\S*)$/);
    if (atMatch) {
      const query = atMatch[1];
      setTriggerType('file');
      setTriggerQuery(query);
      
      const files = await fetchFiles(query);
      const completionItems: CompletionItem[] = files.map((f: string) => ({
        label: f,
        description: t('completion.file'),
        icon: 'file',
        insertText: f,
      }));
      
      setItems(completionItems);
      setSelectedIndex(0);
      setVisible(completionItems.length > 0);
      setPosition({
        top: textareaRect.bottom + 4,
        left: textareaRect.left,
      });
      return;
    }

    // Check for / (slash command)
    const slashMatch = textBeforeCursor.match(/^\/(\w*)$/);
    if (slashMatch) {
      const query = slashMatch[1].toLowerCase();
      setTriggerType('command');
      setTriggerQuery(query);
      
      const commands = await fetchCommands();
      const completionItems: CompletionItem[] = commands
        .filter((c: any) => !query || c.name.toLowerCase().includes(query))
        .map((c: any) => ({
          label: `/${c.name}`,
          description: c.description,
          icon: 'command',
          insertText: `/${c.name}${c.args ? ' ' + c.args : ''}`,
        }));
      
      setItems(completionItems);
      setSelectedIndex(0);
      setVisible(completionItems.length > 0);
      setPosition({
        top: textareaRect.bottom + 4,
        left: textareaRect.left,
      });
      return;
    }

    // Check for $ (dollar command)
    const dollarMatch = textBeforeCursor.match(/\$(\S*)$/);
    if (dollarMatch) {
      const query = dollarMatch[1];
      setTriggerType('dollar');
      setTriggerQuery(query);
      
      // Common bash commands
      const commonCommands = [
        { name: 'ls', description: t('completion.ls') },
        { name: 'cd', description: t('completion.cd') },
        { name: 'pwd', description: t('completion.pwd') },
        { name: 'cat', description: t('completion.cat') },
        { name: 'grep', description: t('completion.grep') },
        { name: 'find', description: t('completion.find') },
        { name: 'echo', description: t('completion.echo') },
        { name: 'mkdir', description: t('completion.mkdir') },
        { name: 'rm', description: t('completion.rm') },
        { name: 'cp', description: t('completion.cp') },
      ];
      
      const completionItems: CompletionItem[] = commonCommands
        .filter(c => !query || c.name.toLowerCase().includes(query.toLowerCase()))
        .map(c => ({
          label: `$${c.name}`,
          description: c.description,
          icon: 'dollar',
          insertText: c.name,
        }));
      
      setItems(completionItems);
      setSelectedIndex(0);
      setVisible(completionItems.length > 0);
      setPosition({
        top: textareaRect.bottom + 4,
        left: textareaRect.left,
      });
      return;
    }

    // Check for > (prompt)
    const promptMatch = textBeforeCursor.match(/^>(\w*)$/);
    if (promptMatch) {
      const query = promptMatch[1].toLowerCase();
      setTriggerType('prompt');
      setTriggerQuery(query);
      
      const prompts = await fetchPrompts();
      const completionItems: CompletionItem[] = prompts
        .filter((p: any) => !query || p.name.toLowerCase().includes(query))
        .map((p: any) => ({
          label: `>${p.name}`,
          description: t('completion.prompt'),
          icon: 'prompt',
          insertText: p.content,
        }));
      
      setItems(completionItems);
      setSelectedIndex(0);
      setVisible(completionItems.length > 0);
      setPosition({
        top: textareaRect.bottom + 4,
        left: textareaRect.left,
      });
      return;
    }

    // No trigger found
    setVisible(false);
    setItems([]);
    setTriggerType(null);
  }, [t, fetchFiles, fetchCommands, fetchPrompts]);

  const onSelect = useCallback((item: CompletionItem) => {
    setVisible(false);
    setItems([]);
    setTriggerType(null);
    // Return the item to be handled by the caller
    return item;
  }, []);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (!visible) return false;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(prev => (prev + 1) % items.length);
      return true;
    }

    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(prev => (prev - 1 + items.length) % items.length);
      return true;
    }

    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      if (items[selectedIndex]) {
        onSelect(items[selectedIndex]);
      }
      return true;
    }

    if (e.key === 'Escape') {
      e.preventDefault();
      setVisible(false);
      return true;
    }

    return false;
  }, [visible, items, selectedIndex, onSelect]);

  return {
    visible,
    items,
    selectedIndex,
    position,
    triggerType,
    checkTrigger,
    handleKeyDown,
    onSelect,
    hide: () => setVisible(false),
  };
}

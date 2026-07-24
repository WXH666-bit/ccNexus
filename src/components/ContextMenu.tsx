import { useEffect, useRef } from 'react';
import { Copy, FileText } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface ContextMenuProps {
  x: number;
  y: number;
  content: string;
  onClose: () => void;
}

export default function ContextMenu({ x, y, content, onClose }: ContextMenuProps) {
  const { t } = useTranslation();
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEsc);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEsc);
    };
  }, [onClose]);

  // Prevent menu from going off-screen
  useEffect(() => {
    if (menuRef.current) {
      const rect = menuRef.current.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      let newX = x;
      let newY = y;

      if (x + rect.width > viewportWidth) {
        newX = viewportWidth - rect.width - 10;
      }
      if (y + rect.height > viewportHeight) {
        newY = viewportHeight - rect.height - 10;
      }

      if (newX !== x || newY !== y) {
        menuRef.current.style.left = `${newX}px`;
        menuRef.current.style.top = `${newY}px`;
      }
    }
  }, [x, y]);

  const handleCopyText = () => {
    navigator.clipboard.writeText(content);
    onClose();
  };

  const handleCopyMarkdown = () => {
    // Convert to markdown format
    const markdown = content;
    navigator.clipboard.writeText(markdown);
    onClose();
  };

  return (
    <div
      ref={menuRef}
      className="context-menu"
      style={{ left: x, top: y }}
    >
      <div className="context-menu-item" onClick={handleCopyText}>
        <Copy size={14} />
        <span>{t('contextMenu.copyText', 'Copy Text')}</span>
      </div>
      <div className="context-menu-item" onClick={handleCopyMarkdown}>
        <FileText size={14} />
        <span>{t('contextMenu.copyMarkdown', 'Copy as Markdown')}</span>
      </div>
    </div>
  );
}

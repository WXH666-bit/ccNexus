import { useCallback, useEffect, useRef, type RefObject } from 'react';
import {
  appendInputHistory,
  INVISIBLE_INPUT_CHARS_RE,
  loadInputHistory,
  saveInputHistory,
} from '../../utils/inputHistory.js';

type EditableRef = RefObject<HTMLDivElement | null>;

type KeyEventLike = {
  key: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  preventDefault: () => void;
  stopPropagation: () => void;
};

interface UseInputHistoryOptions {
  editableRef: EditableRef;
  getTextContent: () => string;
  handleInput: () => void;
}

export function useInputHistory({
  editableRef,
  getTextContent,
  handleInput,
}: UseInputHistoryOptions) {
  const historyRef = useRef<string[]>([]);
  const historyIndexRef = useRef(-1);
  const draftRef = useRef('');

  useEffect(() => {
    historyRef.current = loadInputHistory();
  }, []);

  const setText = useCallback((nextText: string) => {
    const element = editableRef.current;
    if (!element) return;

    try {
      element.innerText = nextText;
      const range = document.createRange();
      const selection = window.getSelection();
      if (selection) {
        range.selectNodeContents(element);
        range.collapse(false);
        selection.removeAllRanges();
        selection.addRange(range);
      }
    } catch {
      // Chromium/IME selection APIs can fail while the editor is re-rendering.
    } finally {
      handleInput();
    }
  }, [editableRef, handleInput]);

  const record = useCallback((text: string) => {
    const nextHistory = appendInputHistory(historyRef.current, text);
    historyRef.current = saveInputHistory(nextHistory);
    historyIndexRef.current = -1;
    draftRef.current = '';
  }, []);

  const handleKeyDown = useCallback((event: KeyEventLike) => {
    const { key } = event;

    if (historyIndexRef.current !== -1 && key !== 'ArrowUp' && key !== 'ArrowDown') {
      historyIndexRef.current = -1;
      draftRef.current = '';
      return false;
    }

    if (key !== 'ArrowUp' && key !== 'ArrowDown') return false;
    if (event.metaKey || event.ctrlKey || event.altKey) return false;

    const items = historyRef.current;
    if (items.length === 0) return false;

    const currentText = getTextContent();
    const cleanCurrent = currentText.replace(INVISIBLE_INPUT_CHARS_RE, '').trim();
    const isNavigating = historyIndexRef.current !== -1;
    if (!isNavigating && cleanCurrent) return false;
    if (!isNavigating && key === 'ArrowDown') return false;

    event.preventDefault();
    event.stopPropagation();

    if (!isNavigating) draftRef.current = currentText;

    if (key === 'ArrowUp') {
      const nextIndex = isNavigating
        ? Math.max(0, historyIndexRef.current - 1)
        : items.length - 1;
      historyIndexRef.current = nextIndex;
      setText(items[nextIndex]);
      return true;
    }

    if (historyIndexRef.current < items.length - 1) {
      historyIndexRef.current += 1;
      setText(items[historyIndexRef.current]);
      return true;
    }

    historyIndexRef.current = -1;
    setText(draftRef.current);
    draftRef.current = '';
    return true;
  }, [getTextContent, setText]);

  return { record, handleKeyDown };
}

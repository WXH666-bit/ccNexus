import { useEffect, useRef, useState, type RefObject } from 'react';

interface Props {
  value: string;
  placeholder: string;
  disabled?: boolean;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onPasteImage: (file: File) => void;
  onDropFiles: (files: FileList) => void;
  editorRef?: RefObject<HTMLDivElement | null>;
  onHistoryKeyDown?: (event: React.KeyboardEvent<HTMLDivElement>) => boolean;
}

export default function InputEditable({
  value,
  placeholder,
  disabled = false,
  onChange,
  onSubmit,
  onPasteImage,
  onDropFiles,
  editorRef,
  onHistoryKeyDown,
}: Props) {
  const editableRef = useRef<HTMLDivElement>(null);
  const inputRef = editorRef || editableRef;
  const isComposingRef = useRef(false);
  const [completionSuffix] = useState('');

  useEffect(() => {
    const el = inputRef.current;
    if (!el || el.innerText === value) return;
    el.innerText = value;
  }, [inputRef, value]);

  const syncText = () => {
    onChange(inputRef.current?.innerText ?? '');
  };

  return (
    <div className="input-editable-wrapper">
      <div
        ref={inputRef}
        className="input-editable"
        contentEditable={!disabled}
        spellCheck={false}
        data-placeholder={placeholder}
        data-completion-suffix={completionSuffix}
        onInput={syncText}
        onKeyDown={event => {
          if (onHistoryKeyDown?.(event)) return;
          if (event.key === 'Enter' && !event.shiftKey && !isComposingRef.current) {
            event.preventDefault();
            onSubmit();
          }
        }}
        onBeforeInput={event => {
          const inputType = 'inputType' in event.nativeEvent
            ? (event.nativeEvent as InputEvent).inputType
            : undefined;
          if (inputType === 'insertParagraph' && !isComposingRef.current) {
            event.preventDefault();
            onSubmit();
          }
        }}
        onCompositionStart={() => {
          isComposingRef.current = true;
        }}
        onCompositionEnd={() => {
          isComposingRef.current = false;
          syncText();
        }}
        onPaste={event => {
          const items = event.clipboardData.items;
          for (const item of Array.from(items)) {
            if (!item.type.startsWith('image/')) continue;
            const file = item.getAsFile();
            if (file) {
              event.preventDefault();
              onPasteImage(file);
            }
          }
        }}
        onDrop={event => {
          event.preventDefault();
          if (event.dataTransfer.files.length > 0) {
            onDropFiles(event.dataTransfer.files);
          }
        }}
        onDragOver={event => event.preventDefault()}
        onContextMenu={event => {
          if (event.shiftKey) return;
          event.stopPropagation();
        }}
        suppressContentEditableWarning
      />
    </div>
  );
}

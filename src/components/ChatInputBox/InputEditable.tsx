import { useEffect, useRef, useState } from 'react';

interface Props {
  value: string;
  placeholder: string;
  disabled?: boolean;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onPasteImage: (file: File) => void;
}

export default function InputEditable({
  value,
  placeholder,
  disabled = false,
  onChange,
  onSubmit,
  onPasteImage,
}: Props) {
  const editableRef = useRef<HTMLDivElement>(null);
  const isComposingRef = useRef(false);
  const [completionSuffix] = useState('');

  useEffect(() => {
    const el = editableRef.current;
    if (!el || el.innerText === value) return;
    el.innerText = value;
  }, [value]);

  const syncText = () => {
    onChange(editableRef.current?.innerText ?? '');
  };

  return (
    <div className="input-editable-wrapper">
      <div
        ref={editableRef}
        className="input-editable"
        contentEditable={!disabled}
        spellCheck={false}
        data-placeholder={placeholder}
        data-completion-suffix={completionSuffix}
        onInput={syncText}
        onKeyDown={event => {
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
          const files = Array.from(event.dataTransfer.files);
          files.forEach(file => {
            if (file.type.startsWith('image/')) onPasteImage(file);
          });
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

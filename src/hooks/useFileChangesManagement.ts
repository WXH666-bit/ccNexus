import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import {
  cleanupFileChangeState,
  readKeepAllBase,
  readProcessedFiles,
  writeKeepAllBase,
  writeProcessedFiles,
} from '../utils/fileChangeState.js';

export interface FileChangeManagementOptions {
  currentSessionId: string | null;
  currentSessionIdRef: RefObject<string | null>;
  messages: unknown[];
}

export type FileChangeReference = string | { path?: string; filePath?: string };

function filePathOf(change: FileChangeReference) {
  if (typeof change === 'string') return change;
  return change.filePath || change.path || '';
}

/** Mirrors ccgui's session-scoped Keep All and processed-file state. */
export function useFileChangesManagement({
  currentSessionId,
  currentSessionIdRef,
  messages,
}: FileChangeManagementOptions) {
  const [processedFiles, setProcessedFiles] = useState<string[]>([]);
  const [baseMessageIndex, setBaseMessageIndex] = useState(0);
  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  const resolveSessionId = useCallback(
    () => currentSessionId || currentSessionIdRef.current,
    [currentSessionId, currentSessionIdRef],
  );

  const persistProcessedFiles = useCallback((filePaths: string[]) => {
    writeProcessedFiles(resolveSessionId(), filePaths);
  }, [resolveSessionId]);

  const handleUndoFile = useCallback((filePath: string) => {
    const normalizedPath = filePath.trim();
    if (!normalizedPath) return;
    setProcessedFiles(previous => {
      if (previous.includes(normalizedPath)) return previous;
      const next = [...previous, normalizedPath];
      persistProcessedFiles(next);
      return next;
    });
  }, [persistProcessedFiles]);

  const handleDiscardAll = useCallback((changes: FileChangeReference[]) => {
    const paths = changes.map(filePathOf).map(path => path.trim()).filter(Boolean);
    if (paths.length === 0) return;
    setProcessedFiles(previous => {
      const next = Array.from(new Set([...previous, ...paths]));
      persistProcessedFiles(next);
      return next;
    });
  }, [persistProcessedFiles]);

  // Keep All establishes a new baseline instead of only hiding the current list.
  const handleKeepAll = useCallback(() => {
    const newBaseIndex = messagesRef.current.length;
    setBaseMessageIndex(newBaseIndex);
    setProcessedFiles([]);
    const sessionId = resolveSessionId();
    writeKeepAllBase(sessionId, newBaseIndex);
    writeProcessedFiles(sessionId, []);
  }, [resolveSessionId]);

  useEffect(() => {
    setProcessedFiles([]);
    if (!currentSessionId) {
      setBaseMessageIndex(0);
      return;
    }

    cleanupFileChangeState();
    setProcessedFiles(readProcessedFiles(currentSessionId));
    setBaseMessageIndex(readKeepAllBase(currentSessionId));
  }, [currentSessionId]);

  return {
    processedFiles,
    baseMessageIndex,
    handleUndoFile,
    handleDiscardAll,
    handleKeepAll,
  };
}

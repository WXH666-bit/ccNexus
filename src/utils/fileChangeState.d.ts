export function readKeepAllBase(sessionId: string | null | undefined, storage?: Storage | null): number;
export function writeKeepAllBase(sessionId: string | null | undefined, messageIndex: number, storage?: Storage | null): void;
export function readProcessedFiles(sessionId: string | null | undefined, storage?: Storage | null): string[];
export function writeProcessedFiles(sessionId: string | null | undefined, filePaths: string[], storage?: Storage | null): void;
export function cleanupFileChangeState(storage?: Storage | null, maxStoredSessions?: number): void;

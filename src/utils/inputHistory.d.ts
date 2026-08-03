export const INPUT_HISTORY_STORAGE_KEY: string;
export const MAX_INPUT_HISTORY_ITEMS: number;
export const INVISIBLE_INPUT_CHARS_RE: RegExp;

export function splitInputHistoryFragments(text: string): string[];
export function loadInputHistory(storage?: Storage | null): string[];
export function saveInputHistory(items: string[], storage?: Storage | null): string[];
export function appendInputHistory(items: string[], text: string): string[];

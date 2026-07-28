export function normalizeToolInput<T extends Record<string, unknown> | undefined>(
  name: string | undefined,
  input: T,
): T extends undefined ? undefined : Record<string, unknown>;

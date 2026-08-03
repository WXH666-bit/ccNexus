export type DesktopChatEventLike = Record<string, unknown>;

export function normalizeDesktopChatEvent(input: DesktopChatEventLike): DesktopChatEventLike;
export function getDesktopEventSessionId(event: DesktopChatEventLike): string | undefined;
export function isDesktopEventForSession(event: DesktopChatEventLike, sessionId: string | null | undefined): boolean;

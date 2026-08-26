export type WebResearchRecency = 'day' | 'week' | 'month' | 'year';

export interface WebResearchResult {
  title: string;
  url: string;
  snippet: string;
  provider?: string;
  publishedAt?: string;
  contentId?: string;
}

export interface WebResearchSearchResponse {
  responseId: string;
  query: string;
  provider: string;
  answer: string;
  results: WebResearchResult[];
  cacheHit?: boolean;
  errors?: Array<{ provider: string; error: string }>;
}

export interface WebResearchContentResponse {
  responseId: string;
  url: string;
  title?: string;
  content: string;
  contentType?: string;
  wordCount?: number;
  cacheHit?: boolean;
  truncated?: boolean;
}

export interface WebResearchActivityEntry {
  id: string;
  type: 'api' | 'fetch';
  label?: string;
  query?: string;
  url?: string;
  provider?: string;
  startTime: number;
  endTime?: number;
  status: number | null;
  error?: string;
  cacheHit?: boolean;
}

export interface WebResearchProvider {
  id: string;
  label: string;
  available: boolean;
  configured?: boolean;
  description?: string;
}

export interface WebResearchState {
  providers: WebResearchProvider[];
  activity: WebResearchActivityEntry[];
  cache?: { entries: number; bytes: number; maxEntries: number; maxBytes: number; ttlMs: number };
}

function desktopApi() {
  const api = window.ccNexusDesktop;
  if (!api) throw new Error('ccNexus desktop bridge is unavailable');
  return api;
}

export async function searchWeb(args: {
  requestId: string;
  query: string;
  provider?: string;
  numResults?: number;
  recencyFilter?: WebResearchRecency;
  domainFilter?: string[];
}) {
  return desktopApi().searchWeb(args) as Promise<WebResearchSearchResponse>;
}

export async function fetchWebContent(args: {
  requestId: string;
  url: string;
  mode?: 'readable' | 'raw';
}) {
  return desktopApi().fetchWebContent(args) as Promise<WebResearchContentResponse>;
}

export async function getWebResearchContent(args: {
  responseId: string;
  offset?: number;
  limit?: number;
  findText?: string;
}) {
  return desktopApi().getWebResearchContent(args) as Promise<WebResearchContentResponse>;
}

export async function getWebResearchState() {
  return desktopApi().getWebResearchState() as Promise<WebResearchState>;
}

export async function cancelWebResearch(requestId: string) {
  return desktopApi().cancelWebResearch(requestId);
}

export async function setResearchPanelOpen(open: boolean) {
  return desktopApi().setResearchPanelOpen(open);
}

export async function openWebSource(url: string) {
  return desktopApi().openExternal(url);
}

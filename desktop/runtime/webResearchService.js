import * as nodeDns from 'node:dns/promises';

const SEARCH_PROVIDERS = ['auto', 'duckduckgo', 'brave', 'tavily', 'searxng'];
const KEYLESS_PROVIDER = 'duckduckgo';
const DEFAULT_SEARCH_RESULTS = 10;
const MAX_SEARCH_RESULTS = 20;
const DEFAULT_CACHE_TTL_MS = 60 * 60 * 1000;
const DEFAULT_CACHE_ENTRIES = 128;
const DEFAULT_CACHE_BYTES = 128 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 30 * 1000;
const DEFAULT_CONTENT_BYTES = 5 * 1024 * 1024;
const DEFAULT_SEARXNG_ENDPOINT = 'http://127.0.0.1:8080/search';

const PROVIDER_ALIASES = new Map([
  ['ddg', KEYLESS_PROVIDER],
  ['duckduckgo', KEYLESS_PROVIDER],
  ['duck-duck-go', KEYLESS_PROVIDER],
  ['brave', 'brave'],
  ['tavily', 'tavily'],
  ['searx', 'searxng'],
  ['searxng', 'searxng'],
  ['auto', 'auto'],
]);

const RECENCY_ALIASES = new Map([
  ['d', 'day'],
  ['day', 'day'],
  ['1d', 'day'],
  ['24h', 'day'],
  ['today', 'day'],
  ['w', 'week'],
  ['week', 'week'],
  ['1w', 'week'],
  ['7d', 'week'],
  ['m', 'month'],
  ['month', 'month'],
  ['1m', 'month'],
  ['30d', 'month'],
  ['y', 'year'],
  ['year', 'year'],
  ['1y', 'year'],
  ['365d', 'year'],
]);

function asTrimmedString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeProvider(value) {
  const key = asTrimmedString(value || 'auto').toLowerCase();
  const normalized = PROVIDER_ALIASES.get(key);
  if (!normalized) {
    throw new Error(`Unsupported web research provider: ${value}`);
  }
  return normalized;
}

function normalizeRecency(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value > 0 ? `${Math.max(1, Math.round(value))}d` : null;
  }
  if (typeof value === 'object') {
    if (Number.isFinite(value.days)) {
      return value.days > 0 ? `${Math.max(1, Math.round(value.days))}d` : null;
    }
    if (typeof value.value === 'string') return normalizeRecency(value.value);
  }
  const text = asTrimmedString(value).toLowerCase();
  if (!text) return null;
  return RECENCY_ALIASES.get(text) || text;
}

function normalizeDomainName(value) {
  let domain = asTrimmedString(value).toLowerCase();
  if (!domain) return '';
  domain = domain.replace(/^https?:\/\//, '').split('/')[0].split(':')[0];
  domain = domain.replace(/^\.+|\.+$/g, '');
  if (domain.startsWith('site:')) domain = domain.slice(5);
  if (!domain || domain.includes(' ') || domain.includes('@')) return '';
  // A domain filter is used to compare host names.  Do not accept path or
  // wildcard syntax here; callers can still pass a parent domain normally.
  if (!/^[a-z0-9._-]+$/.test(domain)) return '';
  return domain;
}

export function normalizeDomainFilter(value) {
  let values = value;
  if (values && typeof values === 'object' && !Array.isArray(values)) {
    values = [
      ...(Array.isArray(values.include) ? values.include : []),
      ...(Array.isArray(values.exclude)
        ? values.exclude.map((entry) => `-${entry}`)
        : []),
    ];
  } else if (typeof values === 'string') {
    values = values.split(/[\s,]+/u);
  }
  if (!Array.isArray(values)) values = [];

  const normalized = [];
  for (const valueEntry of values) {
    let entry = asTrimmedString(valueEntry);
    if (!entry) continue;
    const excluded = entry.startsWith('-');
    if (excluded) entry = entry.slice(1).trim();
    const domain = normalizeDomainName(entry);
    if (!domain) continue;
    normalized.push(`${excluded ? '-' : ''}${domain}`);
  }
  return [...new Set(normalized)];
}

export function normalizeSearchOptions(input = {}) {
  if (!input || typeof input !== 'object') {
    throw new Error('Web research search options must be an object');
  }
  const query = asTrimmedString(input.query);
  if (!query) throw new Error('Web research query is required');

  const provider = normalizeProvider(input.provider ?? input.engine ?? 'auto');
  const candidate = Number(input.numResults ?? input.maxResults ?? DEFAULT_SEARCH_RESULTS);
  const numResults = Number.isFinite(candidate)
    ? Math.min(MAX_SEARCH_RESULTS, Math.max(1, Math.round(candidate)))
    : DEFAULT_SEARCH_RESULTS;

  return {
    query,
    provider,
    numResults,
    recencyFilter: normalizeRecency(input.recencyFilter ?? input.recency),
    domainFilter: normalizeDomainFilter(input.domainFilter ?? input.domains),
  };
}

function splitDomains(domainFilter) {
  const include = [];
  const exclude = [];
  for (const entry of domainFilter || []) {
    if (entry.startsWith('-')) exclude.push(entry.slice(1));
    else include.push(entry);
  }
  return { include, exclude };
}

function recencyDays(value) {
  if (!value) return null;
  if (/^\d+d$/u.test(value)) return Number.parseInt(value, 10);
  return { day: 1, week: 7, month: 30, year: 365 }[value] || null;
}

function providerRecency(value, provider) {
  if (!value) return null;
  if (/^\d+d$/u.test(value)) {
    const days = Number.parseInt(value, 10);
    if (provider === 'tavily') return days;
    if (provider === 'brave') return `${days}d`;
    return value;
  }
  if (provider === 'brave') return { day: 'pd', week: 'pw', month: 'pm', year: 'py' }[value] || value;
  return value;
}

function byteLength(value) {
  if (value === undefined || value === null) return 0;
  if (value instanceof Uint8Array) return value.byteLength;
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(value)) return value.byteLength;
  return new TextEncoder().encode(String(value)).byteLength;
}

function stringifyError(error) {
  if (!error) return 'Unknown web research error';
  if (typeof error === 'string') return error;
  return error.message || String(error);
}

function createAbortError(message = 'Web research request cancelled') {
  const error = new Error(message);
  error.name = 'AbortError';
  return error;
}

function createResponseId(clock, sequence) {
  const timestamp = Number(clock()) || 0;
  return `web-${timestamp.toString(36)}-${sequence.toString(36)}`;
}

function hashString(value) {
  // FNV-1a is sufficient for an opaque in-process content id and avoids a
  // crypto dependency in the desktop runtime.
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function headerValue(headers, name) {
  if (!headers) return '';
  if (typeof headers.get === 'function') return headers.get(name) || '';
  const lower = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lower) return String(value ?? '');
  }
  return '';
}

function responseStatus(response) {
  const status = Number(response?.status);
  return Number.isFinite(status) && status > 0 ? status : 200;
}

function isRedirect(status) {
  return status >= 300 && status < 400;
}

function responseOk(response) {
  const status = responseStatus(response);
  return response?.ok === false || status >= 400 ? false : true;
}

function stripHtml(value) {
  let text = String(value ?? '');
  text = text
    .replace(/<!--[\s\S]*?-->/gu, ' ')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/giu, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/giu, ' ')
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/giu, ' ')
    .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/giu, ' ')
    .replace(/<br\s*\/?>/giu, '\n')
    .replace(/<\/(?:p|div|section|article|li|h[1-6]|tr|td|th|blockquote)>/giu, '\n')
    .replace(/<[^>]+>/gu, ' ')
    .replace(/&nbsp;/giu, ' ')
    .replace(/&amp;/giu, '&')
    .replace(/&lt;/giu, '<')
    .replace(/&gt;/giu, '>')
    .replace(/&quot;/giu, '"')
    .replace(/&#39;|&apos;/giu, "'")
    .replace(/&#(\d+);/gu, (_, code) => {
      const number = Number(code);
      return Number.isFinite(number) ? String.fromCodePoint(Math.min(number, 0x10ffff)) : '';
    })
    .replace(/&#x([\da-f]+);/giu, (_, code) => {
      const number = Number.parseInt(code, 16);
      return Number.isFinite(number) ? String.fromCodePoint(Math.min(number, 0x10ffff)) : '';
    });
  return text
    .replace(/[ \t\f\v]+/gu, ' ')
    .replace(/\n[ \t]+/gu, '\n')
    .replace(/[ \t]+\n/gu, '\n')
    .replace(/\n{3,}/gu, '\n\n')
    .trim();
}

const HTML_ENTITY_NAMES = {
  amp: '&',
  apos: "'",
  gt: '>',
  lt: '<',
  nbsp: ' ',
  quot: '"',
};

function decodeHtmlEntities(value) {
  let decoded = String(value ?? '');
  for (let pass = 0; pass < 2; pass += 1) {
    const next = decoded.replace(/&(#x[\da-f]+|#\d+|[a-z][\da-z]+);/giu, (entity, name) => {
      const lowerName = name.toLowerCase();
      if (lowerName.startsWith('#x')) {
        const code = Number.parseInt(lowerName.slice(2), 16);
        return Number.isFinite(code) ? String.fromCodePoint(Math.min(code, 0x10ffff)) : entity;
      }
      if (lowerName.startsWith('#')) {
        const code = Number.parseInt(lowerName.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(Math.min(code, 0x10ffff)) : entity;
      }
      return HTML_ENTITY_NAMES[lowerName] || entity;
    });
    if (next === decoded) break;
    decoded = next;
  }
  return decoded;
}

function decodeUriComponentSafely(value) {
  let decoded = String(value ?? '');
  for (let pass = 0; pass < 2; pass += 1) {
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    } catch {
      break;
    }
  }
  return decoded;
}

function readHtmlAttribute(attributes, name) {
  const pattern = new RegExp(`${name}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, 'iu');
  return attributes.match(pattern)?.[2] || '';
}

function hasHtmlClass(attributes, className) {
  const classes = readHtmlAttribute(attributes, 'class').split(/\s+/u).filter(Boolean);
  return classes.includes(className);
}

function decodeDuckDuckGoResultUrl(value) {
  const href = decodeHtmlEntities(value).trim();
  if (!href) return '';
  let parsed;
  try {
    parsed = new URL(href, 'https://duckduckgo.com/');
  } catch {
    return '';
  }

  const isDuckDuckGoRedirect = (
    /(^|\.)duckduckgo\.com$/iu.test(parsed.hostname) && parsed.pathname === '/l/'
  );
  if (isDuckDuckGoRedirect) {
    const target = parsed.searchParams.get('uddg');
    if (!target) return '';
    const decodedTarget = decodeHtmlEntities(decodeUriComponentSafely(target)).trim();
    try {
      parsed = new URL(decodedTarget, 'https://duckduckgo.com/');
    } catch {
      return '';
    }
  }
  return /^https?:$/iu.test(parsed.protocol) ? parsed.toString() : '';
}

function parseDuckDuckGoHtml(html, provider = KEYLESS_PROVIDER) {
  const source = String(html ?? '');
  const anchors = [];
  const anchorPattern = /<a\b([^>]*)>([\s\S]*?)<\/a\s*>/giu;
  for (const match of source.matchAll(anchorPattern)) {
    if (!hasHtmlClass(match[1], 'result__a')) continue;
    anchors.push({
      index: match.index ?? 0,
      end: (match.index ?? 0) + match[0].length,
      attributes: match[1],
      title: match[2],
    });
  }

  const results = [];
  for (let index = 0; index < anchors.length; index += 1) {
    const anchor = anchors[index];
    const nextAnchorIndex = anchors[index + 1]?.index ?? source.length;
    const segment = source.slice(anchor.end, nextAnchorIndex);
    const snippetMatch = segment.match(/<[^>]*\bclass\s*=\s*(["'])[^"']*\bresult__snippet\b[^"']*\1[^>]*>([\s\S]*?)<\/[^>]+>/iu);
    const normalized = normalizeResult({
      url: decodeDuckDuckGoResultUrl(readHtmlAttribute(anchor.attributes, 'href')),
      title: stripHtml(decodeHtmlEntities(anchor.title)).replace(/\s+/gu, ' ').trim(),
      snippet: snippetMatch ? stripHtml(decodeHtmlEntities(snippetMatch[2])) : '',
    }, provider);
    if (normalized) results.push(normalized);
  }
  return { results, answer: '' };
}

export function parseDuckDuckGoResponse(payload, provider = KEYLESS_PROVIDER) {
  if (typeof payload === 'string') {
    const text = payload.trim();
    if (text.startsWith('<')) return parseDuckDuckGoHtml(payload, provider);
    try {
      return parseDuckDuckGo(JSON.parse(text), provider);
    } catch {
      return parseDuckDuckGoHtml(payload, provider);
    }
  }
  return parseDuckDuckGo(payload, provider);
}

function parseUrlHost(url) {
  const host = String(url.hostname || '').toLowerCase();
  return host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
}

function parseIpv4(value) {
  const parts = String(value).split('.');
  if (parts.length !== 4 || parts.some((part) => !/^\d+$/u.test(part))) return null;
  const numbers = parts.map((part) => Number(part));
  if (numbers.some((part) => part < 0 || part > 255)) return null;
  return numbers;
}

function isBlockedIpv4(value) {
  const parts = parseIpv4(value);
  if (!parts) return false;
  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a >= 224)
  );
}

function parseIpv6(value) {
  let input = String(value).toLowerCase();
  if (input.startsWith('[') && input.endsWith(']')) input = input.slice(1, -1);
  if (input.includes('%')) input = input.slice(0, input.indexOf('%'));
  if (!input.includes(':')) return null;

  const mappedMatch = input.match(/^::ffff:(?:0:)?(\d+\.\d+\.\d+\.\d+)$/u);
  if (mappedMatch) {
    const mappedIpv4 = parseIpv4(mappedMatch[1]);
    return mappedIpv4 ? { mappedIpv4 } : null;
  }

  // IPv4-mapped IPv6 addresses are handled as IPv4 below.
  const lastColon = input.lastIndexOf(':');
  const possibleIpv4 = input.slice(lastColon + 1);
  if (possibleIpv4.includes('.')) {
    const ipv4 = parseIpv4(possibleIpv4);
    if (!ipv4) return null;
    input = `${input.slice(0, lastColon + 1)}${ipv4.map((part) => Math.floor(part / 16).toString(16).padStart(2, '0')).join('')}`;
    // The compact conversion above is only used for classification.  IPv4
    // mapped values have the last 32 bits, so retain a direct marker too.
    if (input.startsWith('::ffff:') || input.startsWith('::ffff:0:')) return { mappedIpv4: ipv4 };
  }

  const pieces = input.split('::');
  if (pieces.length > 2) return null;
  const left = pieces[0] ? pieces[0].split(':') : [];
  const right = pieces.length === 2 && pieces[1] ? pieces[1].split(':') : [];
  if (left.concat(right).some((part) => !/^[\da-f]{1,4}$/u.test(part))) return null;
  const total = left.length + right.length;
  if (pieces.length === 1 && total !== 8) return null;
  if (pieces.length === 2 && total >= 8) return null;
  const words = [...left, ...Array(8 - total).fill('0'), ...right].map((part) => Number.parseInt(part || '0', 16));
  if (words.length !== 8) return null;
  if (words.slice(0, 5).every((part) => part === 0) && words[5] === 0xffff) {
    return {
      mappedIpv4: [
        (words[6] >> 8) & 0xff,
        words[6] & 0xff,
        (words[7] >> 8) & 0xff,
        words[7] & 0xff,
      ],
    };
  }
  return words;
}

function isBlockedIp(value) {
  if (isBlockedIpv4(value)) return true;
  const parsed = parseIpv6(value);
  if (!parsed) return false;
  if (parsed.mappedIpv4) return isBlockedIpv4(parsed.mappedIpv4.join('.'));
  const first = parsed[0];
  const second = parsed[1];
  return (
    parsed.every((part) => part === 0) ||
    (parsed.slice(0, 7).every((part) => part === 0) && parsed[7] === 1) ||
    (first & 0xfe00) === 0xfc00 || // ULA fc00::/7
    (first & 0xffc0) === 0xfe80 || // link-local fe80::/10
    (first & 0xff00) === 0xff00 || // multicast ff00::/8
    (first === 0x2001 && second === 0x0db8) // documentation range, never a fetch target
  );
}

function isBlockedHostname(hostname) {
  const host = String(hostname).toLowerCase().replace(/\.$/u, '');
  return (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host === 'localhost.localdomain' ||
    host === 'metadata' ||
    host === 'metadata.google.internal' ||
    host.endsWith('.metadata.google.internal') ||
    host === 'instance-data' ||
    host === 'instance-data.ec2.internal'
  );
}

function normalizeDnsAddresses(value) {
  if (value === undefined || value === null) return [];
  const values = Array.isArray(value) ? value : [value];
  const addresses = [];
  for (const entry of values) {
    if (typeof entry === 'string') addresses.push(entry);
    else if (entry && typeof entry.address === 'string') addresses.push(entry.address);
    else if (entry && typeof entry.host === 'string') addresses.push(entry.host);
  }
  return addresses;
}

function domainMatches(hostname, domain) {
  const host = String(hostname).toLowerCase().replace(/\.$/u, '');
  const expected = String(domain).toLowerCase().replace(/^\.+|\.+$/gu, '');
  return host === expected || host.endsWith(`.${expected}`);
}

function filterResults(results, domainFilter) {
  const { include, exclude } = splitDomains(domainFilter);
  return results.filter((result) => {
    let hostname = '';
    try {
      hostname = new URL(result.url).hostname;
    } catch {
      return false;
    }
    if (exclude.some((domain) => domainMatches(hostname, domain))) return false;
    return include.length === 0 || include.some((domain) => domainMatches(hostname, domain));
  });
}

function normalizeResult(result, provider) {
  if (!result || typeof result !== 'object') return null;
  const url = asTrimmedString(result.url || result.link || result.firstURL || result.FirstURL);
  if (!url || !/^https?:\/\//iu.test(url)) return null;
  const title = asTrimmedString(result.title || result.name || result.heading || result.Text || result.text) || url;
  const snippet = asTrimmedString(
    result.snippet || result.description || result.content || result.body || result.AbstractText || result.abstract,
  );
  return {
    title,
    url,
    snippet,
    provider,
  };
}

function parseDuckDuckGo(payload, provider = KEYLESS_PROVIDER) {
  const results = [];
  const walk = (entry) => {
    if (!entry || typeof entry !== 'object') return;
    if (Array.isArray(entry.Topics)) {
      for (const child of entry.Topics) walk(child);
      return;
    }
    const normalized = normalizeResult({
      url: entry.FirstURL || entry.FirstUrl || entry.URL,
      title: entry.Text || entry.Name,
      snippet: entry.Text,
    }, provider);
    if (normalized) results.push(normalized);
  };

  for (const result of Array.isArray(payload?.Results) ? payload.Results : []) {
    const normalized = normalizeResult(result, provider);
    if (normalized) results.push(normalized);
  }
  for (const topic of Array.isArray(payload?.RelatedTopics) ? payload.RelatedTopics : []) walk(topic);
  if (results.length === 0 && (payload?.AbstractURL || payload?.AbstractText)) {
    const normalized = normalizeResult({
      url: payload.AbstractURL,
      title: payload.Heading,
      snippet: payload.AbstractText,
    }, provider);
    if (normalized) results.push(normalized);
  }
  return {
    results,
    answer: asTrimmedString(payload?.Answer || payload?.AbstractText || payload?.Definition),
  };
}

function parseBrave(payload, provider = 'brave') {
  const results = (Array.isArray(payload?.web?.results) ? payload.web.results : [])
    .map((result) => normalizeResult(result, provider))
    .filter(Boolean);
  return {
    results,
    answer: asTrimmedString(payload?.answer || payload?.summarizer?.text),
  };
}

function parseTavily(payload, provider = 'tavily') {
  const results = (Array.isArray(payload?.results) ? payload.results : [])
    .map((result) => normalizeResult(result, provider))
    .filter(Boolean);
  return { results, answer: asTrimmedString(payload?.answer) };
}

function parseSearxng(payload, provider = 'searxng') {
  const results = (Array.isArray(payload?.results) ? payload.results : [])
    .map((result) => normalizeResult(result, provider))
    .filter(Boolean);
  const answer = Array.isArray(payload?.answers)
    ? payload.answers.map((entry) => asTrimmedString(entry)).filter(Boolean).join('\n')
    : asTrimmedString(payload?.answer);
  return { results, answer };
}

async function parseResponseJson(response) {
  if (typeof response?.json === 'function') return response.json();
  if (typeof response?.text === 'function') {
    const text = await response.text();
    try {
      return JSON.parse(text);
    } catch {
      throw new Error('Search provider returned invalid JSON');
    }
  }
  if (response && typeof response.body === 'object') return response.body;
  throw new Error('Search provider returned an unreadable response');
}

async function readBodyBytes(response, maxBytes, signal) {
  const declaredLength = Number.parseInt(headerValue(response?.headers, 'content-length'), 10);
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new Error(`Web content exceeds the ${maxBytes}-byte limit`);
  }
  if (signal?.aborted) throw createAbortError();

  const chunks = [];
  let total = 0;
  const append = (chunk) => {
    const bytes = typeof chunk === 'string' ? new TextEncoder().encode(chunk) : new Uint8Array(chunk);
    total += bytes.byteLength;
    if (total > maxBytes) throw new Error(`Web content exceeds the ${maxBytes}-byte limit`);
    chunks.push(bytes);
  };

  const body = response?.body;
  if (body && typeof body.getReader === 'function') {
    const reader = body.getReader();
    try {
      while (true) {
        if (signal?.aborted) throw createAbortError();
        const { done, value } = await reader.read();
        if (done) break;
        append(value);
      }
    } finally {
      if (signal?.aborted && typeof reader.cancel === 'function') {
        await reader.cancel().catch(() => {});
      }
    }
  } else if (body && typeof body[Symbol.asyncIterator] === 'function') {
    for await (const chunk of body) {
      if (signal?.aborted) throw createAbortError();
      append(chunk);
    }
  } else if (typeof response?.arrayBuffer === 'function') {
    append(new Uint8Array(await response.arrayBuffer()));
  } else if (typeof response?.text === 'function') {
    append(await response.text());
  } else if (response?.body !== undefined) {
    append(response.body);
  }

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged;
}

function decodeBytes(bytes) {
  return new TextDecoder().decode(bytes);
}

function normalizeEndpoint(endpoint, fallback) {
  const text = asTrimmedString(endpoint) || fallback;
  let url;
  try {
    url = new URL(text);
  } catch {
    throw new Error(`Invalid web research endpoint: ${text}`);
  }
  if (!/^https?:$/iu.test(url.protocol)) {
    throw new Error(`Web research endpoint must use http or https: ${text}`);
  }
  return url;
}

function providerError(provider, error) {
  const item = { provider, message: stringifyError(error) };
  const status = Number(error?.status);
  if (Number.isFinite(status)) item.status = status;
  return item;
}

export class WebResearchService {
  constructor(options = {}) {
    this.fetch = options.fetch || options.fetchImpl || globalThis.fetch?.bind(globalThis);
    if (typeof this.fetch !== 'function') throw new Error('WebResearchService requires fetch');
    this.dns = options.dns || nodeDns;
    this.fs = options.fs || null;
    this.clock = typeof options.clock === 'function' ? options.clock : options.clock?.now || Date.now;
    this.setTimer = options.clock?.setTimeout || options.setTimeout || globalThis.setTimeout;
    this.clearTimer = options.clock?.clearTimeout || options.clearTimeout || globalThis.clearTimeout;
    this.timeoutMs = Number.isFinite(options.timeoutMs) ? Math.max(1, options.timeoutMs) : DEFAULT_TIMEOUT_MS;
    this.maxContentBytes = Number.isFinite(options.maxContentBytes)
      ? Math.max(1, Math.floor(options.maxContentBytes))
      : DEFAULT_CONTENT_BYTES;
    this.cacheTtlMs = Number.isFinite(options.cacheTtlMs)
      ? Math.max(0, options.cacheTtlMs)
      : DEFAULT_CACHE_TTL_MS;
    this.cacheMaxEntries = Number.isFinite(options.cacheMaxEntries)
      ? Math.max(1, Math.floor(options.cacheMaxEntries))
      : DEFAULT_CACHE_ENTRIES;
    this.cacheMaxBytes = Number.isFinite(options.cacheMaxBytes)
      ? Math.max(1, Math.floor(options.cacheMaxBytes))
      : DEFAULT_CACHE_BYTES;
    this.env = options.env || (typeof process !== 'undefined' ? process.env : {});
    this.apiKeys = options.apiKeys || {};
    this.rawOptions = options;
    this.providers = options.providers || options.providerConfig || {};
    this.endpoints = options.endpoints || {};
    this.providerOrder = Array.isArray(options.providerOrder) && options.providerOrder.length > 0
      ? options.providerOrder.map(normalizeProvider).filter((provider) => provider !== 'auto' && provider !== KEYLESS_PROVIDER)
      : ['tavily', 'brave', 'searxng'];

    this.cache = new Map();
    this.cacheBytes = 0;
    this.responseContentIds = new Map();
    this.activeRequests = new Map();
    this.activities = [];
    this.sequence = 0;
    this.disposed = false;
  }

  now() {
    const value = Number(this.clock());
    return Number.isFinite(value) ? value : Date.now();
  }

  createRequestId() {
    this.sequence += 1;
    return `request-${this.sequence.toString(36)}`;
  }

  beginRequest({ requestId, operation, label, signal } = {}) {
    if (this.disposed) throw new Error('WebResearchService is disposed');
    const normalizedId = asTrimmedString(requestId) || this.createRequestId();
    if (this.activeRequests.has(normalizedId)) {
      throw new Error(`Web research requestId is already active: ${normalizedId}`);
    }
    const controller = new AbortController();
    const active = {
      requestId: normalizedId,
      operation,
      controller,
      cancelled: false,
      timedOut: false,
      timer: null,
      removeExternalAbort: null,
      activity: {
        requestId: normalizedId,
        operation,
        label: label || '',
        startedAt: this.now(),
        finishedAt: null,
        status: 'running',
      },
    };
    if (signal) {
      if (signal.aborted) {
        active.cancelled = true;
        controller.abort();
      } else if (typeof signal.addEventListener === 'function') {
        const onAbort = () => {
          active.cancelled = true;
          controller.abort();
        };
        signal.addEventListener('abort', onAbort, { once: true });
        active.removeExternalAbort = () => signal.removeEventListener?.('abort', onAbort);
      }
    }
    active.timer = this.setTimer(() => {
      if (this.activeRequests.get(normalizedId) !== active) return;
      active.timedOut = true;
      controller.abort();
    }, this.timeoutMs);
    this.activeRequests.set(normalizedId, active);
    this.activities.unshift(active.activity);
    this.activities = this.activities.slice(0, 10);
    return active;
  }

  finishRequest(active, { status = 'success', error, ...details } = {}) {
    if (!active) return;
    if (active.timer !== null) this.clearTimer(active.timer);
    active.removeExternalAbort?.();
    if (this.activeRequests.get(active.requestId) === active) this.activeRequests.delete(active.requestId);
    active.activity.finishedAt = this.now();
    active.activity.status = status;
    if (error) active.activity.error = stringifyError(error);
    Object.assign(active.activity, details);
  }

  ensureNotAborted(active) {
    if (active?.cancelled) throw createAbortError();
    if (active?.timedOut) throw new Error(`Web research request timed out after ${this.timeoutMs}ms`);
    if (active?.controller.signal.aborted) throw createAbortError();
  }

  async cancel(requestId) {
    const normalizedId = asTrimmedString(requestId);
    const active = this.activeRequests.get(normalizedId);
    if (!active) return false;
    active.cancelled = true;
    active.controller.abort();
    return true;
  }

  async cancelRequest(requestId) {
    return this.cancel(requestId);
  }

  getActivities(limit = 10) {
    const count = Math.max(0, Math.min(10, Number.isFinite(Number(limit)) ? Math.floor(Number(limit)) : 10));
    return this.activities.slice(0, count).map((activity) => ({ ...activity }));
  }

  getActivity(limit = 10) {
    return this.getActivities(limit);
  }

  getActivityLog(limit = 10) {
    return this.getActivities(limit);
  }

  getState() {
    const providerLabels = {
      auto: 'Auto',
      duckduckgo: 'DuckDuckGo',
      brave: 'Brave',
      tavily: 'Tavily',
      searxng: 'SearXNG',
    };
    return {
      providers: SEARCH_PROVIDERS.map((provider) => ({
        id: provider,
        label: providerLabels[provider] || provider,
        available: provider === 'auto' || provider === KEYLESS_PROVIDER || this.providerConfig(provider).available,
        configured: provider === 'auto' || provider === KEYLESS_PROVIDER || this.providerConfig(provider).available,
      })),
      activity: this.getActivities(10),
      cache: {
        entries: this.cache.size,
        bytes: this.cacheBytes,
        maxEntries: this.cacheMaxEntries,
        maxBytes: this.cacheMaxBytes,
        ttlMs: this.cacheTtlMs,
      },
    };
  }

  getProviders() {
    return this.getState().providers;
  }

  providerConfig(provider) {
    const configured = this.providers?.[provider];
    const option = configured && typeof configured === 'object' ? configured : {};
    const env = this.env || {};
    const apiKeys = this.apiKeys || {};
    const directKey = provider === 'brave'
      ? (this.rawOptions.braveApiKey || this.rawOptions.braveKey || this.rawOptions.braveToken)
      : provider === 'tavily'
        ? (this.rawOptions.tavilyApiKey || this.rawOptions.tavilyKey)
        : provider === 'searxng'
          ? (this.rawOptions.searxngApiKey || this.rawOptions.searxngKey)
          : '';
    const key = (typeof configured === 'string' ? configured : '')
      || option.apiKey || option.key || option.token || option.subscriptionToken || directKey || apiKeys[provider]
      || (provider === 'brave' ? (env.BRAVE_SEARCH_API_KEY || env.BRAVE_API_KEY) : '')
      || (provider === 'tavily' ? (env.TAVILY_API_KEY || env.TAVILY_KEY) : '')
      || (provider === 'searxng' ? (env.SEARXNG_API_KEY || env.SEARXNG_KEY) : '');
    const directEndpoint = provider === 'brave'
      ? (this.rawOptions.braveEndpoint || this.rawOptions.braveUrl)
      : provider === 'tavily'
        ? (this.rawOptions.tavilyEndpoint || this.rawOptions.tavilyUrl)
        : provider === 'searxng'
          ? (this.rawOptions.searxngEndpoint || this.rawOptions.searxngUrl)
          : '';
    const configuredEndpoint = typeof configured === 'string' && /^https?:\/\//iu.test(configured) ? configured : '';
    const endpoint = option.endpoint || option.baseUrl || option.url || configuredEndpoint || directEndpoint || this.endpoints[provider]
      || (provider === 'brave' ? env.BRAVE_SEARCH_ENDPOINT : '')
      || (provider === 'tavily' ? env.TAVILY_ENDPOINT : '')
      || (provider === 'searxng' ? (env.SEARXNG_URL || env.SEARXNG_ENDPOINT) : '');
    const configuredByObject = Object.prototype.hasOwnProperty.call(this.providers || {}, provider);
    const available = provider === 'searxng' ? Boolean(endpoint || configuredByObject) : Boolean(key);
    return { ...option, apiKey: key, endpoint, available };
  }

  configuredProviders() {
    return this.providerOrder.filter((provider) => this.providerConfig(provider).available);
  }

  buildSearchUrl(provider, options) {
    const { include, exclude } = splitDomains(options.domainFilter);
    if (provider === KEYLESS_PROVIDER) {
      const endpoint = normalizeEndpoint(
        this.providerConfig(provider).endpoint || this.endpoints.duckduckgo,
        'https://html.duckduckgo.com/html/',
      );
      const queryParts = [options.query];
      for (const domain of include) queryParts.push(`site:${domain}`);
      for (const domain of exclude) queryParts.push(`-site:${domain}`);
      endpoint.searchParams.set('q', queryParts.join(' '));
      const usesInstantAnswerApi = /(^|\.)api\.duckduckgo\.com$/iu.test(endpoint.hostname)
        || endpoint.searchParams.get('format') === 'json';
      if (usesInstantAnswerApi) {
        endpoint.searchParams.set('format', 'json');
        endpoint.searchParams.set('no_html', '1');
        endpoint.searchParams.set('no_redirect', '1');
      }
      const recency = providerRecency(options.recencyFilter, provider);
      if (recency && ['day', 'week', 'month', 'year'].includes(recency)) {
        endpoint.searchParams.set('df', { day: 'd', week: 'w', month: 'm', year: 'y' }[recency]);
      }
      return endpoint;
    }
    if (provider === 'brave') {
      const config = this.providerConfig(provider);
      const endpoint = normalizeEndpoint(config.endpoint, 'https://api.search.brave.com/res/v1/web/search');
      endpoint.searchParams.set('q', options.query);
      endpoint.searchParams.set('count', String(options.numResults));
      const freshness = providerRecency(options.recencyFilter, provider);
      if (freshness) endpoint.searchParams.set('freshness', String(freshness));
      if (include.length) endpoint.searchParams.set('domains', include.join(','));
      if (exclude.length) endpoint.searchParams.set('exclude_domains', exclude.join(','));
      return endpoint;
    }
    const config = this.providerConfig(provider);
    let endpoint = normalizeEndpoint(
      config.endpoint,
      provider === 'tavily' ? 'https://api.tavily.com/search' : DEFAULT_SEARXNG_ENDPOINT,
    );
    if (provider === 'searxng' && !endpoint.pathname.endsWith('/search')) {
      endpoint = new URL(`${endpoint.toString().replace(/\/+$/u, '')}/search`);
    }
    if (provider === 'searxng') {
      endpoint.searchParams.set('q', options.query);
      endpoint.searchParams.set('format', 'json');
      endpoint.searchParams.set('number_of_results', String(options.numResults));
      const range = providerRecency(options.recencyFilter, provider);
      if (range && ['day', 'week', 'month', 'year'].includes(range)) endpoint.searchParams.set('time_range', range);
      if (include.length) endpoint.searchParams.set('site', include.join(','));
      return endpoint;
    }
    return endpoint;
  }

  async callProvider(provider, options, active) {
    this.ensureNotAborted(active);
    const config = this.providerConfig(provider);
    if (provider !== KEYLESS_PROVIDER && !config.available) {
      throw new Error(`Web research provider is not configured: ${provider}`);
    }

    const endpoint = this.buildSearchUrl(provider, options);
    const headers = {
      Accept: provider === KEYLESS_PROVIDER ? 'text/html, application/json;q=0.9' : 'application/json',
    };
    if (provider === KEYLESS_PROVIDER) headers['User-Agent'] = 'ccNexus/2.4.4 (WebResearchService)';
    let request;
    if (provider === 'tavily') {
      const { include, exclude } = splitDomains(options.domainFilter);
      const body = {
        api_key: config.apiKey,
        query: options.query,
        max_results: options.numResults,
        include_answer: true,
      };
      const days = recencyDays(options.recencyFilter);
      if (days) body.days = days;
      if (include.length) body.include_domains = include;
      if (exclude.length) body.exclude_domains = exclude;
      headers['Content-Type'] = 'application/json';
      request = { method: 'POST', headers, body: JSON.stringify(body), redirect: 'manual', signal: active.controller.signal };
    } else {
      if (provider === 'brave') headers['X-Subscription-Token'] = config.apiKey;
      request = { method: 'GET', headers, redirect: 'manual', signal: active.controller.signal };
    }
    const response = await this.fetch(endpoint.toString(), request);
    this.ensureNotAborted(active);
    if (!responseOk(response)) {
      const error = new Error(`Web research provider ${provider} returned HTTP ${responseStatus(response)}`);
      error.status = responseStatus(response);
      throw error;
    }
    let payload;
    let isDuckDuckGoHtmlResponse = false;
    if (provider === KEYLESS_PROVIDER) {
      const contentType = headerValue(response?.headers, 'content-type').toLowerCase();
      if (contentType.includes('html') && typeof response?.text === 'function') {
        isDuckDuckGoHtmlResponse = true;
        payload = await response.text();
      } else if (contentType.includes('json') && typeof response?.json === 'function') {
        payload = await response.json();
      } else if (typeof response?.text === 'function') {
        const text = await response.text();
        const trimmed = text.trim();
        if (trimmed.startsWith('<')) {
          isDuckDuckGoHtmlResponse = true;
          payload = text;
        } else {
          try {
            payload = JSON.parse(text);
          } catch {
            payload = text;
          }
        }
      } else if (typeof response?.json === 'function') {
        payload = await response.json();
      } else {
        payload = response?.body;
      }
    } else {
      payload = await parseResponseJson(response);
    }
    this.ensureNotAborted(active);
    if (provider === KEYLESS_PROVIDER) {
      if (!isDuckDuckGoHtmlResponse && typeof payload === 'string' && payload.trim().startsWith('<')) {
        isDuckDuckGoHtmlResponse = true;
      }
      const parsed = parseDuckDuckGoResponse(payload, provider);
      if (isDuckDuckGoHtmlResponse && parsed.results.length === 0) {
        const error = new Error('DuckDuckGo returned no parseable results/invalid response');
        error.code = 'DDG_INVALID_RESPONSE';
        throw error;
      }
      return parsed;
    }
    if (provider === 'brave') return parseBrave(payload, provider);
    if (provider === 'tavily') return parseTavily(payload, provider);
    return parseSearxng(payload, provider);
  }

  cacheGet(key) {
    const item = this.cache.get(key);
    if (!item) return null;
    if (this.now() - item.createdAt >= this.cacheTtlMs) {
      this.cache.delete(key);
      this.cacheBytes -= item.size;
      return null;
    }
    item.lastAccessAt = this.now();
    this.cache.delete(key);
    this.cache.set(key, item);
    return item.value;
  }

  cacheSet(key, value, size = byteLength(JSON.stringify(value))) {
    if (size > this.cacheMaxBytes) return false;
    const previous = this.cache.get(key);
    if (previous) this.cacheBytes -= previous.size;
    this.cache.delete(key);
    const item = { value, size, createdAt: this.now(), lastAccessAt: this.now() };
    this.cache.set(key, item);
    this.cacheBytes += size;
    while (this.cache.size > this.cacheMaxEntries || this.cacheBytes > this.cacheMaxBytes) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey === undefined) break;
      const oldest = this.cache.get(oldestKey);
      this.cache.delete(oldestKey);
      this.cacheBytes -= oldest?.size || 0;
    }
    return true;
  }

  makeSearchCacheKey(options) {
    return `search:${JSON.stringify(options)}`;
  }

  async search(input = {}) {
    const options = normalizeSearchOptions(input);
    const active = this.beginRequest({
      requestId: input.requestId,
      signal: input.signal,
      operation: 'search',
      label: options.query,
    });
    const responseId = createResponseId(() => this.now(), ++this.sequence);
    const cacheKey = this.makeSearchCacheKey(options);
    try {
      this.ensureNotAborted(active);
      const cached = this.cacheGet(cacheKey);
      if (cached) {
        active.activity.cacheHit = true;
        active.activity.provider = cached.provider;
        active.activity.responseId = responseId;
        this.finishRequest(active, { status: 'success', cacheHit: true });
        return { ...cached, responseId, cacheHit: true };
      }

      const candidates = options.provider === 'auto'
        ? [...this.configuredProviders(), KEYLESS_PROVIDER]
        : [options.provider];
      const errors = [];
      let successful = null;
      let selectedProvider = candidates.at(-1) || KEYLESS_PROVIDER;
      for (const provider of candidates) {
        selectedProvider = provider;
        try {
          const result = await this.callProvider(provider, options, active);
          successful = { provider, result };
          break;
        } catch (error) {
          if (active.cancelled || active.controller.signal.aborted) throw error;
          if (error?.code === 'DDG_INVALID_RESPONSE') throw error;
          errors.push(providerError(provider, error));
        }
      }
      this.ensureNotAborted(active);
      const parsed = successful?.result || { results: [], answer: '' };
      const results = filterResults(parsed.results || [], options.domainFilter).slice(0, options.numResults);
      const response = {
        responseId,
        provider: successful?.provider || selectedProvider,
        results,
        answer: asTrimmedString(parsed.answer),
        cacheHit: false,
        errors,
      };
      active.activity.provider = response.provider;
      active.activity.responseId = responseId;
      active.activity.cacheHit = false;
      active.activity.errors = errors;
      if (successful) this.cacheSet(cacheKey, { ...response, responseId: undefined, errors: [] });
      this.finishRequest(active, { status: errors.length && !successful ? 'error' : 'success' });
      return response;
    } catch (error) {
      const cancelled = active.cancelled || (active.timedOut ? false : active.controller.signal.aborted);
      const finalError = active.timedOut
        ? new Error(`Web research request timed out after ${this.timeoutMs}ms`)
        : cancelled
          ? createAbortError()
          : error;
      this.finishRequest(active, { status: active.timedOut ? 'timeout' : cancelled ? 'cancelled' : 'error', error: finalError });
      throw finalError;
    }
  }

  async searchWeb(input = {}) {
    return this.search(input);
  }

  async research(input = {}) {
    return this.search(input);
  }

  canonicalizeUrl(value) {
    let url;
    try {
      url = new URL(asTrimmedString(value));
    } catch {
      throw new Error('Web content URL is invalid');
    }
    if (!/^https?:$/iu.test(url.protocol)) throw new Error('Web content URL must use http or https');
    url.hash = '';
    return url;
  }

  async resolveAndValidateUrl(url, active) {
    this.ensureNotAborted(active);
    const host = parseUrlHost(url);
    if (!host || isBlockedHostname(host) || isBlockedIp(host)) {
      throw new Error(`Web content host is not allowed: ${host || '(empty)'}`);
    }
    if (parseIpv4(host) || parseIpv6(host)) return url;

    let addresses;
    const resolver = this.dns;
    try {
      if (typeof resolver === 'function') {
        addresses = normalizeDnsAddresses(await resolver(host));
      } else if (typeof resolver.lookup === 'function') {
        addresses = normalizeDnsAddresses(await resolver.lookup(host, { all: true }));
      } else if (typeof resolver.resolve === 'function') {
        addresses = normalizeDnsAddresses(await resolver.resolve(host));
      } else if (typeof resolver.resolve4 === 'function' || typeof resolver.resolve6 === 'function') {
        const values = [];
        if (typeof resolver.resolve4 === 'function') values.push(...normalizeDnsAddresses(await resolver.resolve4(host)));
        if (typeof resolver.resolve6 === 'function') values.push(...normalizeDnsAddresses(await resolver.resolve6(host)));
        addresses = values;
      } else {
        throw new Error('No DNS resolver is available');
      }
    } catch (error) {
      throw new Error(`DNS lookup failed for ${host}: ${stringifyError(error)}`);
    }
    if (addresses.length === 0) throw new Error(`DNS lookup returned no addresses for ${host}`);
    if (addresses.some(isBlockedIp)) throw new Error(`Web content host resolves to a blocked address: ${host}`);
    return url;
  }

  async fetchWithSafeRedirects(initialUrl, active, requestInit = {}) {
    let current = initialUrl;
    for (let redirects = 0; redirects <= 5; redirects += 1) {
      await this.resolveAndValidateUrl(current, active);
      const response = await this.fetch(current.toString(), {
        ...requestInit,
        redirect: 'manual',
        signal: active.controller.signal,
      });
      this.ensureNotAborted(active);
      const status = responseStatus(response);
      if (!isRedirect(status)) return { response, finalUrl: current };
      const location = headerValue(response?.headers, 'location');
      if (!location) throw new Error('Web content redirect did not provide a location');
      if (redirects >= 5) throw new Error('Web content exceeded the 5-redirect limit');
      try {
        current = this.canonicalizeUrl(new URL(location, current).toString());
      } catch (error) {
        throw new Error(`Web content redirect is invalid: ${stringifyError(error)}`);
      }
    }
    throw new Error('Web content exceeded the 5-redirect limit');
  }

  contentCacheKey(url, mode) {
    return `content:${mode}:${url.toString()}`;
  }

  makeContentResult(cached, { cacheHit = false, responseId } = {}) {
    return {
      contentId: cached.contentId,
      url: cached.url,
      finalUrl: cached.finalUrl,
      mode: cached.mode,
      contentType: cached.contentType,
      content: cached.content,
      text: cached.content,
      bytes: cached.bytes,
      cacheHit,
      responseId,
    };
  }

  async fetchContent(input = {}, maybeOptions = {}) {
    const params = typeof input === 'string' ? { ...maybeOptions, url: input } : (input || {});
    const initialUrl = this.canonicalizeUrl(params.url);
    const mode = asTrimmedString(params.mode || params.format || 'readable').toLowerCase();
    if (!['readable', 'raw'].includes(mode)) throw new Error('Web content mode must be readable or raw');
    const active = this.beginRequest({
      requestId: params.requestId,
      signal: params.signal,
      operation: 'fetchContent',
      label: initialUrl.toString(),
    });
    const responseId = createResponseId(() => this.now(), ++this.sequence);
    const cacheKey = this.contentCacheKey(initialUrl, mode);
    try {
      const cached = this.cacheGet(cacheKey);
      if (cached) {
        this.responseContentIds.set(responseId, cached.contentId);
        active.activity.cacheHit = true;
        active.activity.responseId = responseId;
        active.activity.url = initialUrl.toString();
        this.finishRequest(active, { status: 'success', cacheHit: true });
        return this.makeContentResult(cached, { cacheHit: true, responseId });
      }
      const { response, finalUrl } = await this.fetchWithSafeRedirects(initialUrl, active, {
        method: 'GET',
        headers: { Accept: 'text/html, application/json, text/plain;q=0.9, */*;q=0.8' },
      });
      if (!responseOk(response)) {
        const error = new Error(`Web content returned HTTP ${responseStatus(response)}`);
        error.status = responseStatus(response);
        throw error;
      }
      const bytes = await readBodyBytes(response, this.maxContentBytes, active.controller.signal);
      this.ensureNotAborted(active);
      const raw = decodeBytes(bytes);
      const contentType = headerValue(response?.headers, 'content-type').split(';')[0].trim().toLowerCase()
        || (/^\s*</u.test(raw) ? 'text/html' : 'text/plain');
      const content = mode === 'readable' && (contentType.includes('html') || /^\s*</u.test(raw))
        ? stripHtml(raw)
        : raw;
      const contentId = `content-${hashString(`${initialUrl.toString()}|${mode}`)}`;
      const stored = {
        contentId,
        url: initialUrl.toString(),
        finalUrl: finalUrl.toString(),
        mode,
        contentType,
        content,
        bytes: bytes.byteLength,
      };
      this.cacheSet(cacheKey, stored, byteLength(content) + 512);
      this.responseContentIds.set(responseId, stored.contentId);
      active.activity.cacheHit = false;
      active.activity.responseId = responseId;
      active.activity.url = initialUrl.toString();
      this.finishRequest(active, { status: 'success', cacheHit: false });
      return this.makeContentResult(stored, { cacheHit: false, responseId });
    } catch (error) {
      const cancelled = active.cancelled || (active.timedOut ? false : active.controller.signal.aborted);
      const finalError = active.timedOut
        ? new Error(`Web research request timed out after ${this.timeoutMs}ms`)
        : cancelled
          ? createAbortError()
          : error;
      this.finishRequest(active, { status: active.timedOut ? 'timeout' : cancelled ? 'cancelled' : 'error', error: finalError });
      throw finalError;
    }
  }

  findText(content, query) {
    const needle = asTrimmedString(query);
    if (!needle) return [];
    const haystack = String(content);
    const lowerHaystack = haystack.toLocaleLowerCase();
    const lowerNeedle = needle.toLocaleLowerCase();
    const matches = [];
    let from = 0;
    while (from <= lowerHaystack.length - lowerNeedle.length) {
      const index = lowerHaystack.indexOf(lowerNeedle, from);
      if (index < 0) break;
      matches.push({ index, length: needle.length, text: haystack.slice(index, index + needle.length) });
      from = index + Math.max(needle.length, 1);
    }
    return matches;
  }

  async getContent(input = {}, maybeOptions = {}) {
    const params = typeof input === 'string' ? { ...maybeOptions, contentId: input } : (input || {});
    const requestedId = asTrimmedString(params.contentId || params.responseId || params.id);
    if (!requestedId) throw new Error('contentId or responseId is required');
    const contentId = this.responseContentIds.get(requestedId) || requestedId;
    let stored = null;
    for (const item of this.cache.values()) {
      if (item.value?.contentId === contentId) {
        stored = this.cacheGet([...this.cache.entries()].find(([, candidate]) => candidate === item)?.[0]);
        break;
      }
    }
    if (!stored) throw new Error(`Web content is no longer cached: ${contentId}`);
    const content = String(stored.content ?? '');
    const findText = params.findText ?? params.find;
    const matches = findText ? this.findText(content, findText) : [];
    const requestedPageSize = params.pageSize ?? params.limit ?? 4000;
    const pageSize = Math.max(1, Math.min(this.maxContentBytes, Number.isFinite(Number(requestedPageSize)) ? Math.floor(Number(requestedPageSize)) : 4000));
    const requestedOffset = params.offset !== undefined
      ? Number(params.offset)
      : params.page !== undefined
        ? Number(params.page) * pageSize
        : 0;
    const offset = Math.max(0, Math.min(content.length, Number.isFinite(requestedOffset) ? Math.floor(requestedOffset) : 0));
    const text = content.slice(offset, offset + pageSize);
    return {
      contentId,
      responseId: params.responseId || (params.contentId ? params.contentId : undefined),
      url: stored.url,
      finalUrl: stored.finalUrl,
      mode: stored.mode,
      contentType: stored.contentType,
      text,
      content: text,
      offset,
      limit: pageSize,
      totalLength: content.length,
      hasMore: offset + text.length < content.length,
      nextOffset: offset + text.length < content.length ? offset + text.length : null,
      matches,
    };
  }

  async dispose() {
    this.disposed = true;
    for (const active of this.activeRequests.values()) {
      active.cancelled = true;
      active.controller.abort();
      if (active.timer !== null) this.clearTimer(active.timer);
    }
    this.activeRequests.clear();
    this.cache.clear();
    this.cacheBytes = 0;
  }
}

export function createWebResearchService(options = {}) {
  return new WebResearchService(options);
}

export const parseDuckDuckGoHtmlResponse = parseDuckDuckGoHtml;
export const isBlockedAddress = isBlockedIp;

export default WebResearchService;

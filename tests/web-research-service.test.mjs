import test from 'node:test';
import assert from 'node:assert/strict';
import {
  WebResearchService,
  createWebResearchService,
  normalizeSearchOptions,
} from '../desktop/runtime/webResearchService.js';

function jsonResponse(value, { status = 200, headers = {} } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get(name) {
        const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === name.toLowerCase());
        return entry ? entry[1] : null;
      },
    },
    async json() {
      return value;
    },
  };
}

function textResponse(value, { status = 200, headers = {} } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get(name) {
        const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === name.toLowerCase());
        return entry ? entry[1] : null;
      },
    },
    async text() {
      return value;
    },
  };
}

test('normalizes query, provider, result bounds, recency and domain filters', () => {
  assert.deepEqual(normalizeSearchOptions({
    query: '  electron security  ',
    provider: 'ddg',
    numResults: 99,
    recencyFilter: '7d',
    domainFilter: ' MDN.org, -spam.example ',
  }), {
    query: 'electron security',
    provider: 'duckduckgo',
    numResults: 20,
    recencyFilter: 'week',
    domainFilter: ['mdn.org', '-spam.example'],
  });
  assert.equal(normalizeSearchOptions({ query: 'x', numResults: 0 }).numResults, 1);
});

test('parses nested DuckDuckGo topics and applies include/exclude domains', async () => {
  const calls = [];
  const service = createWebResearchService({
    env: {},
    fetch: async (url) => {
      calls.push(url);
      return jsonResponse({
        Heading: 'Search',
        RelatedTopics: [
          { Text: 'Allowed result', FirstURL: 'https://docs.example.com/allowed' },
          { Text: 'Excluded result', FirstURL: 'https://spam.example.com/nope' },
          { Topics: [{ Text: 'Nested allowed', FirstURL: 'https://example.com/nested' }] },
        ],
      });
    },
  });

  const result = await service.search({
    query: 'test',
    provider: 'duckduckgo',
    numResults: 20,
    domainFilter: ['example.com', '-spam.example.com'],
  });

  assert.equal(result.provider, 'duckduckgo');
  assert.equal(result.results.length, 2);
  assert.deepEqual(result.results.map((entry) => entry.url), [
    'https://docs.example.com/allowed',
    'https://example.com/nested',
  ]);
  assert.match(calls[0], /site%3Aexample\.com/);
  assert.match(calls[0], /-site%3Aspam\.example\.com/);
});

test('uses the DuckDuckGo HTML endpoint and decodes result links, entities and snippets', async () => {
  const calls = [];
  const service = createWebResearchService({
    env: {},
    fetch: async (url, init) => {
      calls.push({ url, init });
      return textResponse(`
        <div class="result results_links">
          <h2 class="result__title">
            <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fdocs.example.com%2Fguide%3Fa%3D1%26b%3D2&amp;rut=tracking">A &amp;amp; B</a>
          </h2>
          <a class="result__snippet" href="https://docs.example.com/guide">Snippet &amp;amp; <b>details</b></a>
        </div>
      `, { headers: { 'content-type': 'text/html; charset=UTF-8' } });
    },
  });

  const result = await service.search({ query: 'html result', provider: 'duckduckgo' });

  assert.match(calls[0].url, /^https:\/\/html\.duckduckgo\.com\/html\//);
  assert.equal(calls[0].init.headers.Accept, 'text/html, application/json;q=0.9');
  assert.match(calls[0].init.headers['User-Agent'], /ccNexus/i);
  assert.equal(result.results.length, 1);
  assert.deepEqual(result.results[0], {
    title: 'A & B',
    url: 'https://docs.example.com/guide?a=1&b=2',
    snippet: 'Snippet & details',
    provider: 'duckduckgo',
  });
});

test('does not treat a DDG HTML challenge page with no result__a as a successful empty search', async () => {
  let calls = 0;
  const service = createWebResearchService({
    env: {},
    fetch: async () => {
      calls += 1;
      return textResponse('<html><title>Checking your browser</title><form class="captcha"></form></html>', {
        headers: { 'content-type': 'text/html; charset=UTF-8' },
      });
    },
  });

  await assert.rejects(
    service.search({ query: 'challenge', provider: 'duckduckgo' }),
    /no parseable results\/invalid response/i,
  );
  await assert.rejects(
    service.search({ query: 'challenge', provider: 'duckduckgo' }),
    /no parseable results\/invalid response/i,
  );
  assert.equal(calls, 2);
});

test('auto selects a configured provider and falls back to keyless DuckDuckGo', async () => {
  const calls = [];
  const service = new WebResearchService({
    env: {},
    providers: { brave: { apiKey: 'brave-key', endpoint: 'https://brave.test/search' } },
    providerOrder: ['brave'],
    fetch: async (url) => {
      calls.push(url);
      if (url.startsWith('https://brave.test')) throw new Error('Brave unavailable');
      return jsonResponse({ RelatedTopics: [{ Text: 'DDG', FirstURL: 'https://example.com/ddg' }] });
    },
  });
  const result = await service.search({ query: 'fallback', provider: 'auto' });
  assert.equal(result.provider, 'duckduckgo');
  assert.equal(result.results[0].title, 'DDG');
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].provider, 'brave');
  assert.equal(calls.length, 2);
});

test('rejects private, localhost, metadata and DNS-resolved private content targets', async () => {
  const dnsCalls = [];
  const service = createWebResearchService({
    fetch: async () => textResponse('should not fetch'),
    dns: {
      async lookup(host) {
        dnsCalls.push(host);
        return [{ address: '192.168.1.10', family: 4 }];
      },
    },
  });
  await assert.rejects(service.fetchContent({ url: 'http://127.0.0.1/' }), /not allowed/i);
  await assert.rejects(service.fetchContent({ url: 'http://metadata.google.internal/' }), /not allowed/i);
  await assert.rejects(service.fetchContent({ url: 'http://private.example/' }), /blocked address/i);
  assert.deepEqual(dnsCalls, ['private.example']);
});

test('validates every redirect and enforces readable extraction and pagination', async () => {
  const seen = [];
  const service = createWebResearchService({
    dns: { async lookup() { return [{ address: '93.184.216.34', family: 4 }]; } },
    fetch: async (url) => {
      seen.push(url);
      if (seen.length === 1) return textResponse('', { status: 302, headers: { location: 'https://example.com/final' } });
      return textResponse('<html><script>ignore()</script><h1>Hello</h1><p>World &amp; friends</p></html>', {
        headers: { 'content-type': 'text/html; charset=utf-8' },
      });
    },
  });
  const result = await service.fetchContent({ url: 'https://example.com/start', mode: 'readable' });
  assert.equal(result.content, 'Hello\nWorld & friends');
  assert.equal(seen.length, 2);
  const page = await service.getContent({ contentId: result.contentId, offset: 0, limit: 5, findText: 'world' });
  assert.equal(page.text, 'Hello');
  assert.deepEqual(page.matches.map((match) => match.index), [6]);
  assert.equal(page.hasMore, true);
});

test('an HTTP 403 content response remains a source-level failure and is never cached', async () => {
  const service = createWebResearchService({
    dns: { async lookup() { return [{ address: '93.184.216.34', family: 4 }]; } },
    fetch: async () => textResponse('Forbidden', {
      status: 403,
      headers: { 'content-type': 'text/plain' },
    }),
  });

  await assert.rejects(
    service.fetchContent({ url: 'https://example.com/protected', mode: 'readable' }),
    error => {
      assert.equal(error.status, 403);
      assert.match(error.message, /Web content returned HTTP 403/);
      return true;
    },
  );
  assert.equal(service.getState().cache.entries, 0);
  const activity = service.getActivities(1)[0];
  assert.equal(activity.status, 'error');
  assert.match(activity.error, /HTTP 403/);
});

test('returns cache hits and keeps the cache bounded', async () => {
  let calls = 0;
  let now = 1000;
  const service = createWebResearchService({
    clock: { now: () => now, setTimeout, clearTimeout },
    fetch: async () => {
      calls += 1;
      return jsonResponse({ RelatedTopics: [{ Text: 'cached', FirstURL: 'https://example.com/cached' }] });
    },
  });
  const first = await service.search({ query: 'same', provider: 'duckduckgo' });
  const second = await service.search({ query: 'same', provider: 'duckduckgo' });
  assert.equal(first.cacheHit, false);
  assert.equal(second.cacheHit, true);
  assert.equal(calls, 1);
  now += 60 * 60 * 1000 + 1;
  await service.search({ query: 'same', provider: 'duckduckgo' });
  assert.equal(calls, 2);
});

test('cancel aborts an active request and records it in the activity log', async () => {
  let capturedSignal;
  let release;
  const blocked = new Promise((resolve) => { release = resolve; });
  const service = createWebResearchService({
    fetch: async (_url, init) => {
      capturedSignal = init.signal;
      await blocked;
      return jsonResponse({ RelatedTopics: [] });
    },
  });
  const pending = service.search({ requestId: 'cancel-me', query: 'cancel', provider: 'duckduckgo' });
  while (!capturedSignal) await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(await service.cancel('cancel-me'), true);
  assert.equal(capturedSignal.aborted, true);
  release();
  await assert.rejects(pending, /cancelled|aborted/i);
  const activity = service.getActivities(1)[0];
  assert.equal(activity.requestId, 'cancel-me');
  assert.equal(activity.status, 'cancelled');
});

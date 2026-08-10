const PROXY_ENV_KEYS = [
  'HTTPS_PROXY',
  'https_proxy',
  'HTTP_PROXY',
  'http_proxy',
  'ALL_PROXY',
  'all_proxy',
];

const SUPPORTED_PROXY_PROTOCOLS = new Set(['http:', 'https:', 'socks4:', 'socks5:']);

function normalizeProxy(value) {
  const candidate = typeof value === 'string' ? value.trim() : '';
  if (!candidate) return null;

  try {
    const parsed = new URL(candidate.includes('://') ? candidate : `http://${candidate}`);
    return SUPPORTED_PROXY_PROTOCOLS.has(parsed.protocol) ? candidate : null;
  } catch {
    return null;
  }
}

export function getUpdaterProxy(env = process.env) {
  for (const key of PROXY_ENV_KEYS) {
    const proxy = normalizeProxy(env?.[key]);
    if (proxy) return proxy;
  }
  return null;
}

function errorMessage(error) {
  if (error && typeof error.message === 'string' && error.message) return error.message;
  return String(error || 'Unable to configure updater network');
}

export async function configureUpdaterNetwork({ updaterSession, env = process.env } = {}) {
  if (!updaterSession || typeof updaterSession.setProxy !== 'function') {
    return { configured: false, proxy: null };
  }

  const proxy = getUpdaterProxy(env);
  const proxyConfig = proxy
    ? { proxyRules: proxy, proxyBypassRules: '<local>' }
    : { mode: 'system' };

  try {
    await updaterSession.setProxy(proxyConfig);
    return { configured: true, proxy };
  } catch (error) {
    return { configured: false, proxy, error: errorMessage(error) };
  }
}

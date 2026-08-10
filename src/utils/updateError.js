const NETWORK_ERROR_PATTERN = /ERR_CONNECTION_CLOSED|ERR_CONNECTION_RESET|ECONNRESET|ETIMEDOUT|ENETUNREACH|ERR_INTERNET_DISCONNECTED/i;

export function formatUpdateError(error, translate = message => message) {
  const raw = error instanceof Error && error.message
    ? error.message
    : String(error || 'Update failed');
  const code = error?.code ? String(error.code) : '';

  if (NETWORK_ERROR_PATTERN.test(`${code} ${raw}`)) {
    const translated = translate('settings.update.networkError');
    return typeof translated === 'string' && translated ? translated : raw;
  }

  return raw;
}

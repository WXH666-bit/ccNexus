function connectionText(config = {}) {
  if (typeof config.url === 'string' && config.url) return config.url;
  const command = typeof config.command === 'string' ? config.command : '';
  const args = Array.isArray(config.args) ? config.args.filter(item => typeof item === 'string').join(' ') : '';
  return `${command}${args ? ` ${args}` : ''}`.trim();
}

function statusFor(statusMap, item) {
  return statusMap.get(`${item.id}:${item.scope}`) || statusMap.get(item.id) || null;
}

export function buildMcpViewModel(state = {}, statuses = [], filters = {}) {
  const statusMap = new Map((Array.isArray(statuses) ? statuses : []).map(status => [
    `${status.id}:${status.scope || 'global'}`,
    status,
  ]));
  const items = [];
  for (const server of Array.isArray(state.servers) ? state.servers : []) {
    const status = statusFor(statusMap, server);
    items.push({
      ...server,
      kind: 'server',
      enabled: true,
      status: status?.status || 'pending',
      statusKey: status?.status || 'pending',
      error: status?.error || '',
      connection: connectionText(server.config),
    });
  }
  for (const server of Array.isArray(state.disabled) ? state.disabled : []) {
    const status = statusFor(statusMap, server);
    items.push({
      ...server,
      kind: 'disabled',
      enabled: false,
      status: status?.status || 'failed',
      statusKey: 'disabled',
      error: status?.error || server.reason || 'Server is disabled',
      connection: '',
    });
  }
  for (const server of Array.isArray(state.invalid) ? state.invalid : []) {
    const status = statusFor(statusMap, server);
    items.push({
      ...server,
      kind: 'invalid',
      enabled: false,
      status: status?.status || 'failed',
      statusKey: 'invalid',
      error: status?.error || server.reason || 'Invalid MCP server config',
      connection: connectionText(server.config),
    });
  }

  const counts = {
    all: items.length,
    connected: items.filter(item => item.statusKey === 'connected').length,
    pending: items.filter(item => item.statusKey === 'pending').length,
    failed: items.filter(item => item.statusKey === 'failed').length,
    disabled: items.filter(item => item.statusKey === 'disabled').length,
    invalid: items.filter(item => item.statusKey === 'invalid').length,
  };
  const query = String(filters.search || '').trim().toLowerCase();
  const visibleItems = items
    .filter(item => !filters.scope || filters.scope === 'all' || item.scope === filters.scope)
    .filter(item => !filters.status || filters.status === 'all' || item.statusKey === filters.status)
    .filter(item => {
      if (!query) return true;
      return [item.id, item.name, item.connection, item.error]
        .filter(Boolean)
        .some(value => String(value).toLowerCase().includes(query));
    })
    .sort((left, right) => Number(right.enabled) - Number(left.enabled));

  return { state, statuses, items: visibleItems, allItems: items, counts };
}

export { connectionText as getMcpConnectionText };

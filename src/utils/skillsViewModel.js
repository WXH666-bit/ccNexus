export function buildSkillsViewModel(state = {}, filters = {}) {
  const byId = new Map();
  for (const scope of ['global', 'local']) {
    for (const skill of Object.values(state[scope] || {})) {
      if (!skill || !skill.id || byId.has(skill.id)) continue;
      byId.set(skill.id, { ...skill, statusKey: skill.enabled ? 'enabled' : 'disabled' });
    }
  }
  const allItems = [...byId.values()];
  const counts = {
    all: allItems.length,
    enabled: allItems.filter(skill => skill.enabled).length,
    disabled: allItems.filter(skill => !skill.enabled).length,
    global: allItems.filter(skill => skill.scope === 'global').length,
    local: allItems.filter(skill => skill.scope === 'local').length,
  };
  const query = String(filters.search || '').trim().toLowerCase();
  const items = allItems
    .filter(skill => !filters.scope || filters.scope === 'all' || skill.scope === filters.scope)
    .filter(skill => !filters.status || filters.status === 'all' || skill.statusKey === filters.status)
    .filter(skill => {
      if (!query) return true;
      return [skill.name, skill.id, skill.path, skill.description]
        .filter(Boolean)
        .some(value => String(value).toLowerCase().includes(query));
    })
    .sort((left, right) => Number(right.enabled) - Number(left.enabled));
  return { state, items, allItems, counts };
}

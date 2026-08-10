import assert from 'node:assert/strict';
import test from 'node:test';

import { buildSkillsViewModel } from '../src/utils/skillsViewModel.js';

test('Skills view model flattens ccgui global/local records and filters enabled state', () => {
  const state = {
    global: {
      'global-reviewer': { id: 'global-reviewer', name: 'Reviewer', scope: 'global', enabled: true, path: '/global/reviewer' },
      'global-old-disabled': { id: 'global-old-disabled', name: 'Old', scope: 'global', enabled: false, path: '/global/old' },
    },
    local: {
      'local-check': { id: 'local-check', name: 'Local Check', scope: 'local', enabled: true, path: '/project/check' },
    },
  };

  const model = buildSkillsViewModel(state);
  assert.equal(model.counts.all, 3);
  assert.equal(model.counts.enabled, 2);
  assert.equal(model.counts.disabled, 1);
  assert.deepEqual(model.items.map(skill => skill.id), ['global-reviewer', 'local-check', 'global-old-disabled']);
  assert.deepEqual(buildSkillsViewModel(state, { scope: 'local' }).items.map(skill => skill.id), ['local-check']);
  assert.deepEqual(buildSkillsViewModel(state, { status: 'disabled' }).items.map(skill => skill.id), ['global-old-disabled']);
  assert.deepEqual(buildSkillsViewModel(state, { search: 'CHECK' }).items.map(skill => skill.id), ['local-check']);
});

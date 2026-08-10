import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { LocalConfigService } from '../desktop/runtime/localConfigService.js';

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

test('Claude Skills management mirrors ccgui active and disabled directories', async () => {
  const homeDir = await mkdtemp(path.join(os.tmpdir(), 'ccnexus-skills-management-'));
  const cwd = path.join(homeDir, 'workspace');
  const activeGlobal = path.join(homeDir, '.claude', 'skills', 'reviewer');
  const disabledGlobal = path.join(homeDir, '.codemoss', 'skills', 'global', 'disabled-reviewer');
  const sourceSkill = path.join(homeDir, 'imports', 'release-helper');

  try {
    await mkdir(activeGlobal, { recursive: true });
    await mkdir(disabledGlobal, { recursive: true });
    await mkdir(sourceSkill, { recursive: true });
    await writeFile(path.join(activeGlobal, 'SKILL.md'), '---\nname: reviewer\ndescription: Review code\n---\nReview code.', 'utf8');
    await writeFile(path.join(disabledGlobal, 'SKILL.md'), '---\nname: disabled-reviewer\ndescription: Disabled review\n---\nDisabled.', 'utf8');
    await writeFile(path.join(sourceSkill, 'SKILL.md'), '---\nname: release-helper\ndescription: Prepare a release\n---\nRelease.', 'utf8');

    const service = new LocalConfigService({ homeDir });
    const initial = await service.listSkills(cwd);
    assert.equal(initial.global['global-reviewer'].enabled, true);
    assert.equal(initial.global['global-disabled-reviewer-disabled'].enabled, false);
    assert.equal(initial.global['global-disabled-reviewer-disabled'].description, 'Disabled review');

    const imported = await service.importSkills({ sourcePaths: [sourceSkill], scope: 'global', cwd });
    assert.equal(imported.success, true);
    assert.equal(imported.count, 1);
    assert.equal((await service.listSkills(cwd)).global['global-release-helper'].enabled, true);

    const disabled = await service.toggleSkill({ name: 'release-helper', scope: 'global', enabled: true, cwd });
    assert.equal(disabled.success, true);
    assert.equal(disabled.enabled, false);
    assert.equal(await exists(path.join(homeDir, '.claude', 'skills', 'release-helper')), false);
    assert.equal(await exists(path.join(homeDir, '.codemoss', 'skills', 'global', 'release-helper')), true);

    const enabled = await service.toggleSkill({ name: 'release-helper', scope: 'global', enabled: false, cwd });
    assert.equal(enabled.success, true);
    assert.equal(enabled.enabled, true);
    assert.equal(await exists(path.join(homeDir, '.claude', 'skills', 'release-helper')), true);
    assert.equal(await exists(path.join(homeDir, '.codemoss', 'skills', 'global', 'release-helper')), false);

    const deleted = await service.deleteSkill({ name: 'release-helper', scope: 'global', enabled: true, cwd });
    assert.equal(deleted.success, true);
    assert.equal(await exists(path.join(homeDir, '.claude', 'skills', 'release-helper')), false);

    await assert.rejects(
      () => service.toggleSkill({ name: '../outside', scope: 'global', enabled: true, cwd }),
      /Invalid skill name/,
    );
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
});

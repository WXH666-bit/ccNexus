# Windows Installer Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Configure the Windows NSIS installer to offer a selectable installation directory and a default-checked “Launch ccNexus” finish option while ensuring the installer process exits in both launch choices.

**Architecture:** Keep installer lifecycle inside electron-builder’s assisted NSIS template. The application runtime, updater service, chat controller, Claude SDK, and daemon remain unchanged; package.json supplies NSIS options and tests/desktop-packaging.test.mjs locks the configuration. A temporary NSIS build and manual finish-page checks verify the generated artifact.

**Tech Stack:** Electron 43, electron-builder 26.15.3, Windows NSIS, Node.js test runner, PowerShell, pnpm.

## Global Constraints

- oneClick: false enables the standard NSIS installer wizard.
- allowToChangeInstallationDirectory: true enables the installation directory page.
- runAfterFinish: true keeps the finish-page launch checkbox enabled and selected by default.
- The installer must launch ccNexus without waiting for the application process, then exit through the normal NSIS finish path.
- Do not modify Claude Code configuration files, provider files, credentials, MCP configuration, project .claude content, or the Claude Agent SDK version.
- Do not put installer logic in chatController, Claude runtime, or daemon code.
- Do not add a custom NSIS page or replace NSIS with another installer framework.
- Do not bump the application version in this implementation; publish the behavior later with the normal next-version release flow.

---

## File Map

- Modify: package.json — add build.nsis configuration only; leave build.win, GitHub publish settings, dependencies, and scripts unchanged.
- Modify: tests/desktop-packaging.test.mjs — assert the three required NSIS options before implementation and preserve existing packaging assertions.
- Create during verification only: %TEMP%\ccnexus-installer-flow-20260809 — disposable NSIS output directory, never committed.

## Task 1: Add and implement the assisted NSIS configuration

**Files:**
- Modify: tests/desktop-packaging.test.mjs after the existing NSIS target assertions.
- Modify: package.json inside the top-level build object, next to win.

**Interfaces:**
- Consumes: the existing parsed pkg.build object in tests/desktop-packaging.test.mjs.
- Produces: pkg.build.nsis.oneClick === false, pkg.build.nsis.allowToChangeInstallationDirectory === true, and pkg.build.nsis.runAfterFinish === true for electron-builder.

- [ ] **Step 1: Write the failing packaging test**

Add this test to tests/desktop-packaging.test.mjs:

    test('NSIS uses an assisted installer with a selectable directory and launch choice', () => {
      assert.deepEqual(pkg.build.nsis, {
        oneClick: false,
        allowToChangeInstallationDirectory: true,
        runAfterFinish: true,
      });
    });

- [ ] **Step 2: Run the focused test and verify the expected failure**

Run:

    node tests\desktop-packaging.test.mjs

Expected result before the production change: the existing packaging tests may pass, but the new test fails because pkg.build.nsis is undefined.

- [ ] **Step 3: Add the minimal production configuration**

Add this object to the top-level build object in package.json:

    "nsis": {
      "oneClick": false,
      "allowToChangeInstallationDirectory": true,
      "runAfterFinish": true
    },

Do not change the existing win.target, publish, dependencies, scripts, or application version.

- [ ] **Step 4: Run the focused test and verify it passes**

Run:

    node tests\desktop-packaging.test.mjs

Expected result: all tests in this file pass, including the new NSIS configuration test.

- [ ] **Step 5: Check the focused diff and commit the implementation**

Run:

    git diff --check
    git diff -- package.json tests/desktop-packaging.test.mjs
    git status --short

The only source files in the diff must be package.json and tests/desktop-packaging.test.mjs. Commit:

    git add package.json tests/desktop-packaging.test.mjs
    git commit -m "feat: improve Windows installer flow"

## Task 2: Build and verify the generated Windows installer

**Files:**
- Read-only verification: package.json and tests/desktop-packaging.test.mjs.
- Create temporarily: %TEMP%\ccnexus-installer-flow-20260809.
- Do not commit generated files under release/ or the temporary output directory.

**Interfaces:**
- Consumes: the three build.nsis options produced by Task 1.
- Produces: one Windows NSIS setup executable whose wizard contains the directory page and launch checkbox.

- [ ] **Step 1: Build the renderer and a disposable NSIS output**

Run the following PowerShell commands from D:\ccNexus:

    $verifyOutput = Join-Path $env:TEMP 'ccnexus-installer-flow-20260809'
    if (Test-Path -LiteralPath $verifyOutput) {
      Remove-Item -LiteralPath $verifyOutput -Recurse -Force
    }
    pnpm.cmd run build
    pnpm.cmd exec electron-builder --win nsis --publish never "--config.directories.output=$verifyOutput"

Expected result: Vite exits successfully and electron-builder creates a Windows setup .exe under $verifyOutput without publishing to GitHub.

- [ ] **Step 2: Confirm the expected installer artifact exists**

Run:

    $artifact = Get-ChildItem -LiteralPath $verifyOutput -Filter '*.exe' -File
    if ($artifact.Count -ne 1) {
      throw "Expected exactly one NSIS installer, found $($artifact.Count)."
    }
    $artifact | Select-Object FullName, Length

Expected result: exactly one setup executable is listed, with a non-zero file size.

- [ ] **Step 3: Verify the checked launch path manually**

Close any currently running ccNexus instance, start $artifact.FullName, and complete the wizard with these actions:

1. Confirm the wizard contains an installation directory page.
2. Choose a disposable test directory under %TEMP%.
3. Continue to the final page and confirm the “Launch ccNexus” checkbox is visible and selected by default.
4. Leave it selected and click Finish.
5. Confirm ccNexus starts.
6. Confirm the setup process is no longer present in Task Manager. The installer process name is the setup filename without .exe.

Expected result: the app starts and the installer exits instead of remaining in the process list.

- [ ] **Step 4: Verify the unchecked launch path manually**

Close the test ccNexus instance, run the same setup executable again, choose a second disposable test directory, clear the “Launch ccNexus” checkbox on the final page, and click Finish.

Expected result: ccNexus does not start from this installation attempt and the setup process still disappears from Task Manager.

- [ ] **Step 5: Remove only the disposable verification output**

After both manual checks, run:

    if (Test-Path -LiteralPath $verifyOutput) {
      Remove-Item -LiteralPath $verifyOutput -Recurse -Force
    }

Do not remove the existing application installation, user data, .ccnexus data, Claude history, or Claude configuration.

## Task 3: Run the project verification suite and hand off release instructions

**Files:**
- Read-only verification: all files changed by Tasks 1 and 2.
- No new source files.

**Interfaces:**
- Consumes: the committed NSIS configuration and generated installer verification results.
- Produces: fresh test, type-check, build, and repository-status evidence for the feature handoff.

- [ ] **Step 1: Run the project-required protocol tests**

Run:

    npm.cmd run test:protocol

Expected result: the full Node test suite exits with code 0 and reports zero failures.

- [ ] **Step 2: Run the type check and renderer build**

Run:

    npx.cmd tsc --noEmit
    npm.cmd run build

Expected result: both commands exit with code 0. A Vite chunk-size warning is acceptable if no build error is reported.

- [ ] **Step 3: Check the final repository diff**

Run:

    git diff --check
    git status --short --branch
    git show --stat --oneline HEAD

Expected result: the feature commit contains only the package configuration and packaging regression test, with no Claude configuration changes and no generated installer artifacts staged.

- [ ] **Step 4: Provide the release handoff**

After verification, tell the user that the current source implementation is ready for a new release. The release must use a new version and matching tag, for example:

    pnpm.cmd version 2.0.3 --no-git-tag-version
    git add package.json pnpm-lock.yaml
    git commit -m "release: v2.0.3"
    git tag -a v2.0.3 -m "Release v2.0.3"
    git push origin main --follow-tags

The user should allow the tag-triggered GitHub Actions workflow to run once and should not also click Run workflow for the same tag, avoiding duplicate Releases.

## Self-review checklist

- Spec coverage: Task 1 covers all three NSIS options and the regression test; Task 2 covers the selectable directory, default-checked launch option, both finish choices, and installer process exit; Task 3 covers project tests, type checking, build, repository hygiene, and release handoff.
- Placeholder scan: no TBD, TODO, “implement later”, or unspecified error-handling steps are present.
- Config consistency: the test reads pkg.build.nsis; the implementation writes the same build.nsis object; the build command consumes the same package.json configuration.
- Scope check: no runtime, updater, SDK, daemon, Claude configuration, or installer-framework changes are included.

export const VALID_PERMISSION_MODES = new Set([
  'default',
  'plan',
  'acceptEdits',
  'auto',
  'bypassPermissions',
]);

const PLAN_TARGET_MODES = new Set([
  'default',
  'acceptEdits',
  'auto',
]);

export function normalizePermissionMode(value, fallback = 'default') {
  return VALID_PERMISSION_MODES.has(value) ? value : fallback;
}

export function normalizePlanTargetMode(value) {
  return PLAN_TARGET_MODES.has(value) ? value : null;
}

export function normalizeAllowedPrompts(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter(item => (
      item &&
      typeof item.tool === 'string' &&
      typeof item.prompt === 'string' &&
      item.tool.trim() &&
      item.prompt.trim()
    ))
    .map(item => ({
      tool: item.tool.slice(0, 200),
      prompt: item.prompt.slice(0, 4_000),
    }));
}

function allow(updatedInput) {
  return {
    continue: true,
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'allow',
      ...(updatedInput ? { updatedInput } : {}),
    },
  };
}

function deny(reason) {
  return {
    continue: true,
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
    },
  };
}

export function createPreToolUseHook({
  modeState,
  requestPlanApproval,
  applyMode,
}) {
  return async input => {
    if (input.tool_name === 'EnterPlanMode') {
      try {
        await applyMode('plan', 'enter_plan_mode');
      } catch (error) {
        return deny(error instanceof Error ? error.message : String(error));
      }
      return allow();
    }

    if (
      input.tool_name !== 'ExitPlanMode' ||
      modeState.current !== 'plan'
    ) {
      return { continue: true };
    }

    const toolInput = input.tool_input || {};
    const plan = String(toolInput.plan || '').slice(0, 100_000);
    const allowedPrompts = normalizeAllowedPrompts(toolInput.allowedPrompts);
    let decision;
    try {
      decision = await requestPlanApproval({
        toolName: 'ExitPlanMode',
        plan,
        allowedPrompts,
      });
    } catch (error) {
      return deny(error instanceof Error ? error.message : String(error));
    }

    if (!decision?.approved) {
      return deny(decision?.feedback || 'Plan execution was not approved');
    }

    const targetMode = normalizePlanTargetMode(decision.targetMode);
    if (!targetMode) {
      return deny('Invalid execution mode selected for plan approval');
    }

    try {
      await applyMode(targetMode, 'exit_plan_mode');
    } catch (error) {
      return deny(error instanceof Error ? error.message : String(error));
    }

    return allow({
      ...toolInput,
      plan,
      allowedPrompts,
      approved: true,
      targetMode,
    });
  };
}

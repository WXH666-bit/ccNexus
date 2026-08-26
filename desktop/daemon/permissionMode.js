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

const WEB_RESEARCH_TOOLS = new Set(['WebSearch', 'WebFetch']);

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
  isolatedDenyAllTools = false,
}) {
  return async input => {
    if (isolatedDenyAllTools) {
      return deny('Prompt enhancement cannot use tools');
    }

    // Web research is executed first, then held by the PostToolUse review hook.
    // Explicitly allowing it here prevents SDK permission modes (especially
    // `auto`) from either bypassing or adding a second, pre-search prompt.
    if (WEB_RESEARCH_TOOLS.has(input.tool_name)) {
      return allow();
    }

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

export function createPostToolUseHook({ requestWebResearchReview }) {
  return async (input, toolUseID, options = {}) => {
    if (!WEB_RESEARCH_TOOLS.has(input.tool_name)) {
      return { continue: true };
    }

    let decision;
    try {
      decision = await requestWebResearchReview({
        toolName: input.tool_name,
        input: input.tool_input || {},
        toolResponse: input.tool_response,
        toolUseId: toolUseID || input.tool_use_id,
        signal: options.signal,
      });
    } catch (error) {
      decision = {
        behavior: 'deny',
        message: error instanceof Error ? error.message : String(error),
      };
    }

    if (decision?.behavior === 'allow' || decision?.behavior === 'always_allow') {
      return decision.webReviewOverride
        ? {
            continue: true,
            hookSpecificOutput: {
              hookEventName: 'PostToolUse',
              updatedToolOutput: decision.webReviewOverride,
            },
          }
        : { continue: true };
    }

    return {
      continue: true,
      hookSpecificOutput: {
        hookEventName: 'PostToolUse',
        updatedToolOutput: {
          error: decision?.message || 'Web research results were rejected by the user.',
          rejectedByUser: true,
        },
      },
    };
  };
}

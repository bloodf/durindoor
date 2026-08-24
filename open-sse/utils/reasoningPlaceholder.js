import { isString } from "../../src/shared/utils/typeChecks.js"; /**
 * Internal replay sentinel used when an upstream requires non-empty reasoning
 * content but the original reasoning summary is unavailable. It is valid request
 * scaffolding, never user-visible reasoning, so response translators must
 * suppress it before emitting client-facing reasoning/thinking events.
 *
 * Ported from OmniRoute #7912.
 */
export const NON_ANTHROPIC_THINKING_PLACEHOLDER = "(prior reasoning summary unavailable)";

export function isInternalReasoningPlaceholder(value) {
  return isString(value) && value.trim() === NON_ANTHROPIC_THINKING_PLACEHOLDER;
}
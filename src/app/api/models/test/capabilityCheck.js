// On-demand capability checks for a single model.
//
// `open-sse/providers/capabilities.js` is a DECLARATION: it records what a model
// is supposed to be able to do. A declared `tools: true` is not evidence that
// the provider accepts a tool definition — the first real tool call can still be
// refused. This module answers the narrower question one user-triggered request
// can answer honestly: when ONE normal provider operation that carries a tool
// definition is sent to the selected account, what did the provider actually do?
//
// Deliberate limits (see
// internal/docs/port-reports/1072-on-demand-model-capability-probe.md):
//   - exactly one normal provider operation per check;
//   - no scheduling, no retries, no sweeps, no persisted verdicts;
//   - the verdict is display evidence only. It never gates routing or admission.
//
// Only `tools` is measurable through the gateway today. A vision probe is NOT:
// `stripUnsupportedModalities` (open-sse/translator/concerns/modality.js) drops
// image blocks for every model whose DECLARED caps say `vision: false`, before
// translation. A gateway-level vision probe would therefore measure the
// declaration rather than the provider. Measuring vision needs a provider-direct
// contract, which is a separate work order — so it is refused here rather than
// answered with a misleading verdict.

import { getCapabilitiesForModel } from "open-sse/providers/capabilities.js";
import { parseModel } from "open-sse/services/model.js";
import { isBoolean, isString } from "../../../../shared/utils/typeChecks.js";

export const CAPABILITY_CHECK_TOOLS = "tools";

export const SUPPORTED_CAPABILITY_CHECKS = [CAPABILITY_CHECK_TOOLS];

const TOOL_NAME = "get_weather";
const TOOL_DESCRIPTION = "Get the current weather for a city";

/** Evidence values a check can report. */
export const CAPABILITY_EVIDENCE = {
  /** The provider emitted a tool_call. */
  TOOL_CALL: "tool_call",
  /** The provider refused the request that carried the tool definition. */
  REJECTED: "rejected",
  /** The provider accepted the request but did not call the tool. */
  NO_TOOL_CALL: "no_tool_call",
  /** The request failed for a reason that says nothing about the capability. */
  INCONCLUSIVE: "inconclusive",
};

/**
 * @param {unknown} name
 * @returns {boolean} whether this is a capability check the probe can run
 */
export function isSupportedCapabilityCheck(name) {
  return isString(name) && SUPPORTED_CAPABILITY_CHECKS.includes(name.trim());
}

/**
 * The one normal provider operation a tools check sends: a chat completion that
 * carries a single tool definition.
 *
 * `tool_choice: "auto"` keeps the request portable. Forcing a call
 * (`tool_choice: "required"`) is OpenAI-specific — Anthropic-compatible and
 * Gemini endpoints spell it differently — so a forced choice would produce
 * false "unsupported" verdicts on providers that do support tools.
 *
 * @param {string} model
 * @param {{maxTokens?: number}} [opts]
 * @returns {Object} request body for POST /api/v1/chat/completions
 */
export function buildCapabilityProbeRequest(model, { maxTokens = 1024 } = {}) {
  return {
    model,
    max_tokens: maxTokens,
    stream: false,
    messages: [{ role: "user", content: "What is the weather in Paris? Use the get_weather tool." }],
    tools: [
      {
        type: "function",
        function: {
          name: TOOL_NAME,
          description: TOOL_DESCRIPTION,
          parameters: {
            type: "object",
            properties: { location: { type: "string" } },
            required: ["location"],
          },
        },
      },
    ],
    tool_choice: "auto",
  };
}

/**
 * Classify what the provider actually did.
 *
 * `supported` is deliberately three-valued. `true` and `false` are evidence
 * about the model; `null` means the request told us nothing about it. A
 * credential failure, a throttled account or a timeout must never be reported
 * as "this model cannot call tools".
 *
 * @param {Object} input
 * @param {number|null|undefined} input.status - HTTP status the gateway returned
 * @param {string|null|undefined} input.error - failure text, when the request failed
 * @param {Object|null|undefined} input.parsed - parsed response body
 * @param {boolean|undefined} input.ok - whether the request succeeded
 * @returns {{evidence: string, supported: boolean|null, detail: string}}
 */
export function classifyCapabilityEvidence({ status, error, parsed, ok } = {}) {
  const toolCalls = parsed?.choices?.[0]?.message?.tool_calls;
  if (Array.isArray(toolCalls) && toolCalls.length > 0) {
    return {
      evidence: CAPABILITY_EVIDENCE.TOOL_CALL,
      supported: true,
      detail: "provider returned a tool_call",
    };
  }

  if (ok) {
    return {
      evidence: CAPABILITY_EVIDENCE.NO_TOOL_CALL,
      supported: null,
      detail: "provider accepted the tool request but returned no tool_call",
    };
  }

  // The request failed. Only a client error proves the provider refused THIS
  // request shape. Every other status describes the credential, the quota, the
  // network or the model id — none of which say anything about tool support.
  const code = Number(status) || 0;
  if (code === 400 || code === 415 || code === 422) {
    return {
      evidence: CAPABILITY_EVIDENCE.REJECTED,
      supported: false,
      detail: `provider rejected the tool request${error ? ` — ${error}` : ""}`,
    };
  }

  return {
    evidence: CAPABILITY_EVIDENCE.INCONCLUSIVE,
    supported: null,
    detail: `no capability evidence${error ? ` — ${error}` : ""}`,
  };
}

/**
 * What the local capability table declares for this model, so the caller can
 * show a declared-vs-measured contrast. `null` means "not declared".
 *
 * @param {string} model
 * @param {string} capability
 * @returns {boolean|null}
 */
export function declaredCapability(model, capability) {
  if (!isString(model) || !model.includes("/")) return null;
  const parsed = parseModel(model);
  if (!parsed?.provider || !parsed?.model) return null;
  const value = getCapabilitiesForModel(parsed.provider, parsed.model)?.[capability];
  if (isBoolean(value)) return value;
  return null;
}

/**
 * The request semantics of the check, so the caller can show what was sent.
 *
 * @param {string} capability
 * @param {number} maxTokens
 */
export function capabilityRequestSummary(capability, maxTokens) {
  const summary = {
    operation: "chat.completions",
    endpoint: "/api/v1/chat/completions",
    maxTokens,
  };
  if (capability === CAPABILITY_CHECK_TOOLS) {
    summary.tool = TOOL_NAME;
    summary.toolChoice = "auto";
  }
  return summary;
}

/** The cost semantics of the check: one real upstream request, on the selected account. */
export const CAPABILITY_CHECK_COST = {
  upstreamRequests: 1,
  note: "One real upstream chat completion request is sent to the selected account. It can consume provider quota or incur charges.",
};
